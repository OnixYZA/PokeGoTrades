/**
 * Regenerates `constants/pokedex-data.ts`: every species' English name and typing (both slots), the table
 * of forms whose typing differs from their species', and the catalog of forms a creature can be listed as
 * (`POKEDEX_FORMS`). All the logic lives in `scripts/pokedex-source.ts` (pure, unit-tested); this file only
 * downloads and writes.
 *
 * Usage (see package.json's "pokedex:generate" script):
 *   npm run pokedex:generate                # download, cross-check, rewrite constants/pokedex-data.ts
 *   npm run pokedex:generate -- --dry-run   # download, cross-check, print the report, write nothing
 *   npm run pokedex:generate -- --pinned    # use the commits recorded in the current file's header
 *
 * Sources, each pinned to the commit its `master` pointed at when the run started (and that commit is
 * recorded in the generated file's header). A plain run therefore picks up whatever upstream has moved to; to
 * reproduce the CURRENT file exactly, or to change the generator without mixing in unrelated upstream drift,
 * pass `--pinned`: it reads those three commits back out of the header and does not resolve `master` at all
 * (so a `--pinned` rerun of an unchanged generator is byte-identical):
 *   - PokeAPI/pokeapi             data/v2/csv/{pokemon_species,pokemon_species_names,pokemon,pokemon_types,types}.csv
 *   - PokeMiners/game_masters     latest/latest.json            (Pokémon GO's per-form types)
 *   - PokeMiners/pogo_assets      Images/Pokemon - 256x256/Addressable Assets   (listing only, for form spelling)
 * Banned sources (AGENTS.md): db.pokemongohub.net and Niantic's own servers are never used. This runs at
 * generation time only; the app itself never fetches game data.
 *
 * RELATIVE IMPORTS ONLY, and no `react-native` / `expo-*` (it runs under `tsx`, a plain Node process).
 *
 * The game master is ~19 MB. It is parsed in memory and never written to disk, so nothing downloaded ends
 * up in the repo. GitHub's unauthenticated API allows 60 requests/hour per IP and this makes 7 (4 with
 * `--pinned`); export GITHUB_TOKEN in your shell (public-repo read, no scopes) to raise that. It deliberately
 * does NOT load `.env.scripts.local`, which holds a service-role key and must not be read by a script that
 * needs neither.
 *
 * Exit code 1, and nothing written, when the game master and PokeAPI disagree about any species' default
 * typing, or when `constants/base-form-codes.ts` names a default form the game master does not list: the run
 * prints each one rather than choosing a side.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';

import { BASE_FORM_CODES } from '../constants/base-form-codes';
import {
  buildPokedexData,
  parseAssetFormTokens,
  parseGameMaster,
  parseGameMasterForms,
  parsePokeApiSpecies,
  parseProvenance,
  renderDataFile,
  type GameMasterTemplate,
  type PokedexData,
  type PokeApiCsv,
  type Provenance,
} from './pokedex-source';

const OUT_FILE = path.resolve(__dirname, '..', 'constants', 'pokedex-data.ts');

const POKEAPI_REPO = 'PokeAPI/pokeapi';
const GAME_MASTER_REPO = 'PokeMiners/game_masters';
const ASSETS_REPO = 'PokeMiners/pogo_assets';
const ASSET_DIR = 'Images/Pokemon - 256x256/Addressable Assets';
const BRANCH = 'master';
const DOWNLOAD_ATTEMPTS = 3;

// ================================================================================================
// GitHub
// ================================================================================================

function githubHeaders(): Record<string, string> {
  const headers: Record<string, string> = { Accept: 'application/vnd.github+json' };
  if (process.env.GITHUB_TOKEN) headers.Authorization = `Bearer ${process.env.GITHUB_TOKEN}`;
  return headers;
}

async function githubJson<T>(url: string, what: string): Promise<T> {
  const res = await fetch(url, { headers: githubHeaders() });
  if (res.ok) return (await res.json()) as T;
  if (res.status === 403 && res.headers.get('x-ratelimit-remaining') === '0') {
    const reset = new Date(Number(res.headers.get('x-ratelimit-reset')) * 1000);
    throw new Error(
      `GitHub API rate limit exhausted while ${what}; it resets at ${reset.toLocaleTimeString()}. ` +
        `Wait, or export GITHUB_TOKEN (raises the limit to 5000/hour).`,
    );
  }
  throw new Error(`GitHub responded ${res.status} ${res.statusText} while ${what}.`);
}

async function resolveCommit(repo: string): Promise<string> {
  const body = await githubJson<{ object: { sha: string } }>(
    `https://api.github.com/repos/${repo}/git/ref/heads/${BRANCH}`,
    `resolving ${repo}@${BRANCH}`,
  );
  return body.object.sha;
}

interface TreeEntry {
  path: string;
  type: string;
  sha: string;
}

async function getTree(repo: string, sha: string, what: string): Promise<TreeEntry[]> {
  const body = await githubJson<{ tree: TreeEntry[]; truncated: boolean }>(
    `https://api.github.com/repos/${repo}/git/trees/${sha}`,
    `listing ${what}`,
  );
  if (body.truncated) throw new Error(`GitHub truncated the tree listing of ${what}; cannot enumerate it safely.`);
  return body.tree;
}

/** Same non-recursive walk as `scripts/mirror-assets.ts` (a recursive listing of pogo_assets can be truncated). */
async function listAssetFiles(commitSha: string): Promise<string[]> {
  let treeSha = commitSha;
  let walked = '';
  for (const segment of ASSET_DIR.split('/')) {
    const entries = await getTree(ASSETS_REPO, treeSha, walked || 'the repo root');
    const dir = entries.find((entry) => entry.type === 'tree' && entry.path === segment);
    if (!dir) throw new Error(`"${segment}" not found under ${walked || 'the repo root'} at ${commitSha}.`);
    treeSha = dir.sha;
    walked = walked ? `${walked}/${segment}` : segment;
  }
  const files = await getTree(ASSETS_REPO, treeSha, walked);
  return files.filter((entry) => entry.type === 'blob').map((entry) => entry.path);
}

async function download(repo: string, sha: string, file: string): Promise<Response> {
  const url = `https://raw.githubusercontent.com/${repo}/${sha}/${file}`;
  let lastError = '';
  for (let attempt = 1; attempt <= DOWNLOAD_ATTEMPTS; attempt++) {
    try {
      const res = await fetch(url);
      if (res.ok) return res;
      lastError = `HTTP ${res.status}`;
    } catch (err) {
      lastError = err instanceof Error ? err.message : String(err);
    }
    await new Promise((resolve) => setTimeout(resolve, 500 * attempt));
  }
  throw new Error(`Could not download ${url}: ${lastError}`);
}

const downloadText = async (repo: string, sha: string, file: string): Promise<string> => (await download(repo, sha, file)).text();

// ================================================================================================
// Reporting
// ================================================================================================

const typesText = (types: readonly string[]): string => types.join('/');

function printReport(data: PokedexData, provenance: Provenance): void {
  const { report } = data;
  console.log('PokeGoTrades Pokédex generator');
  console.log(`  ${provenance.pokeApi}\n  ${provenance.gameMaster}\n  ${provenance.spriteAssets}\n`);

  console.log(`Species: ${report.species}; the game master has typing for ${report.gameMasterSpecies}.`);
  for (const m of report.missingFromGameMaster) console.log(`  not in the game master: #${m.pokemonId} ${m.name} (PokeAPI typing only, no form overrides)`);

  const agreed = report.gameMasterSpecies - report.disagreements.length;
  console.log(`Default-form typing, game master vs PokeAPI: ${agreed}/${report.gameMasterSpecies} agree.`);
  for (const d of report.disagreements) {
    console.log(`  DISAGREE #${d.pokemonId} ${d.name}: PokeAPI ${typesText(d.pokeApi)}, game master ${typesText(d.gameMaster)}`);
  }
  if (report.formlessDisagreements.length > 0) {
    console.log(`Formless game master template differs from PokeAPI for ${report.formlessDisagreements.length} species (their default forms agree, so this is only informational):`);
    for (const d of report.formlessDisagreements) {
      console.log(`  #${d.pokemonId} ${d.name}: PokeAPI ${typesText(d.pokeApi)}, formless template ${typesText(d.gameMaster)}`);
    }
  }
  console.log(`Default form read from the formless template for ${report.defaultFromFormless} species (no form template of their own).\n`);

  const unconfirmed = data.overrides.filter((o) => !o.confirmed);
  console.log(`Form overrides: ${data.overrides.length} (${report.overridesFromForms} from form templates, ${report.overridesFromTempEvolutions} from Mega/Primal evolutions).`);
  if (unconfirmed.length > 0) {
    console.log(`  ${unconfirmed.length} use the convention's spelling with no sprite art upstream to confirm it:`);
    console.log(`    ${unconfirmed.map((o) => `${o.pokemonId}:${o.formCode}`).join(' ')}`);
  }
  const catalog = report.formCatalog;
  const formCount = data.forms.reduce((sum, entry) => sum + entry.forms.length, 0);
  const unconfirmedForms = data.forms.flatMap((entry) => entry.forms.filter((f) => !f.confirmed).map((f) => `${entry.pokemonId}:${f.code}`));
  console.log(`Form catalog: ${formCount} selectable forms on ${data.forms.length} species (of ${catalog.speciesWithSeveralForms} species with two or more game master forms).`);
  console.log(`  default form has a name of its own on ${data.forms.filter((e) => e.defaultCode !== null).length} of them; ${catalog.defaultsFromBaseTable.length} take it from BASE_FORM_CODES instead of the first-listed form:`);
  console.log(`    ${catalog.defaultsFromBaseTable.map((d) => `${d.pokemonId}:${d.code} (game master lists ${d.gameMasterFirst} first)`).join(' ')}`);
  console.log(`  left out as event costumes (game master isCostume): ${catalog.excludedCostumes.length}; kept as forms: ${catalog.keptCostumes.map((k) => `${k.pokemonId}:${k.code}`).join(' ') || 'none'}`);
  console.log(`  left out as shadow/purified status: ${catalog.excludedStatus.length}: ${catalog.excludedStatus.map((x) => `${x.pokemonId}:${x.code}`).join(' ')}`);
  console.log(`  ${unconfirmedForms.length} use the convention's spelling with no sprite art upstream to confirm it:`);
  console.log(`    ${unconfirmedForms.join(' ')}`);
  for (const c of catalog.baseTableConflicts) {
    console.log(`  CONFLICT #${c.pokemonId}: BASE_FORM_CODES says the default is ${c.code}, but the game master lists no such form`);
  }
  console.log('');

  const gaps = report.assetFormsWithoutTypes;
  console.log(`Sprite form tokens with no game master typing (they resolve to the species default): ${gaps.length}`);
  console.log(`    ${gaps.map((g) => `${g.pokemonId}:${g.token}`).join(' ')}\n`);
}

// ================================================================================================
// Provenance: which commit of each source
// ================================================================================================

/** What `master` points at right now, for each source. */
async function resolveProvenance(): Promise<Provenance> {
  const [pokeApiSha, gameMasterSha, assetsSha] = await Promise.all([
    resolveCommit(POKEAPI_REPO),
    resolveCommit(GAME_MASTER_REPO),
    resolveCommit(ASSETS_REPO),
  ]);
  return {
    pokeApi: `${POKEAPI_REPO}@${pokeApiSha}`,
    gameMaster: `${GAME_MASTER_REPO}@${gameMasterSha}`,
    spriteAssets: `${ASSETS_REPO}@${assetsSha}`,
  };
}

/** The commits the current output file was generated from (`--pinned`). */
function pinnedProvenance(): Provenance {
  const pinned = parseProvenance(readFileSync(OUT_FILE, 'utf8'));
  if (!pinned) throw new Error(`--pinned: ${path.relative(process.cwd(), OUT_FILE)} has no "owner/repo@<sha>" lines in its header to read the commits from.`);
  return pinned;
}

// ================================================================================================
// Main
// ================================================================================================

const POKEAPI_FILES = {
  species: 'pokemon_species',
  speciesNames: 'pokemon_species_names',
  pokemon: 'pokemon',
  pokemonTypes: 'pokemon_types',
  types: 'types',
} as const satisfies Record<keyof PokeApiCsv, string>;

async function main(): Promise<void> {
  const unknown = process.argv.slice(2).filter((arg) => arg !== '--dry-run' && arg !== '--pinned');
  if (unknown.length > 0) throw new Error(`Unknown argument(s): ${unknown.join(' ')}. Only --dry-run and --pinned are supported.`);
  const dryRun = process.argv.includes('--dry-run');

  const provenance = process.argv.includes('--pinned') ? pinnedProvenance() : await resolveProvenance();
  const shaOf = (source: string): string => source.slice(source.indexOf('@') + 1);
  const [pokeApiSha, gameMasterSha, assetsSha] = [shaOf(provenance.pokeApi), shaOf(provenance.gameMaster), shaOf(provenance.spriteAssets)];

  console.log('Downloading ...');
  const csvEntries = await Promise.all(
    Object.entries(POKEAPI_FILES).map(async ([key, file]) => [key, await downloadText(POKEAPI_REPO, pokeApiSha, `data/v2/csv/${file}.csv`)] as const),
  );
  const pokeApiCsv = Object.fromEntries(csvEntries) as unknown as PokeApiCsv;
  const gameMasterRes = await download(GAME_MASTER_REPO, gameMasterSha, 'latest/latest.json');
  const gameMasterJson = (await gameMasterRes.json()) as GameMasterTemplate[];
  if (!Array.isArray(gameMasterJson)) throw new Error('latest.json is not an array of templates');
  const assetFiles = await listAssetFiles(assetsSha);

  const data = buildPokedexData({
    species: parsePokeApiSpecies(pokeApiCsv),
    gameMaster: parseGameMaster(gameMasterJson),
    gameMasterForms: parseGameMasterForms(gameMasterJson),
    assetTokens: parseAssetFormTokens(assetFiles),
    baseFormCodes: BASE_FORM_CODES,
  });
  printReport(data, provenance);

  if (data.report.disagreements.length > 0) {
    console.error(`Refusing to write ${path.relative(process.cwd(), OUT_FILE)}: the sources disagree about ${data.report.disagreements.length} species' default typing (listed above).`);
    process.exit(1);
  }
  if (data.report.formCatalog.baseTableConflicts.length > 0) {
    console.error(`Refusing to write ${path.relative(process.cwd(), OUT_FILE)}: BASE_FORM_CODES (constants/base-form-codes.ts) names ${data.report.formCatalog.baseTableConflicts.length} default form(s) the game master does not list (listed above).`);
    process.exit(1);
  }
  if (dryRun) {
    console.log('Dry run: nothing written.');
    return;
  }
  writeFileSync(OUT_FILE, renderDataFile(data, provenance));
  console.log(`Wrote ${path.relative(process.cwd(), OUT_FILE)}.`);
}

main().catch((err: unknown) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
