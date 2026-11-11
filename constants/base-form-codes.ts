/**
 * Which form is each species' DEFAULT, for the species whose default art upstream exists only under a form
 * token. A LEAF module (no imports at all) on purpose, so two very different readers can share one table:
 *
 *   - `lib/sprite-url.ts` (re-exports it as `BASE_FORM_CODES`) and `scripts/pokeminers.ts`, to decide which
 *     source file fills a species' plain sprite key; and
 *   - `scripts/pokedex-source.ts`, the Pokédex generator, to decide which form `formCode: null` means. The
 *     Create Listing form picker offers "the default" plus every OTHER form, so "default" must be the same
 *     form the sprite shows for a listing with no form code. The game master's own first-listed form is not
 *     always that form: it lists Unown F, Vivillon Archipelago, Zygarde Ten Percent and Toxtricity Low Key
 *     first, where this table (and so the sprite pipeline) takes Unown A, Meadow, Fifty Percent and Amped.
 *
 * The generator cannot import `lib/sprite-url.ts` (that pulls in `constants/pokedex.ts`, hence the generated
 * data file the generator is about to replace), which is why this lives here and not there.
 */

/**
 * The PokeMiners form code of each species' DEFAULT form, for species whose default art upstream exists
 * only under a form token and never as a plain `pm{id}[.s].icon.png`. Without this, the plain
 * `pokemon/{id}[.s].png` key is missing from the bucket. For example, there is `888.fHERO.s.png` but no
 * `888.s.png`, so a shiny Zacian with no form code fell back to the non-shiny sprite. It is used in two places:
 * `scripts/pokeminers.ts` `planMirror` fills the missing plain key from this form's file, and
 * `spriteCandidates` below tries this form's key right after the plain one, for a bucket not yet re-mirrored.
 *
 * Every entry was checked against the live `sprites` bucket (2026-09-29): the `.f{CODE}` key exists and no plain
 * key does, or, for 487/648/877/888/889, the plain non-shiny key exists but its shiny does not. #892 has no shiny
 * upstream in any Single Strike art. #666 Vivillon (Meadow, its default pattern) is not from the original
 * issue list: it was found in the same bucket scan. #669 Flabébé already has plain keys, and is listed only
 * because RED is its default.
 */
export const BASE_FORM_CODES: Readonly<Record<number, string>> = {
  201: 'UNOWN_A', // Unown
  327: '00', // Spinda
  412: 'BURMY_PLANT', // Burmy
  413: 'WORMADAM_PLANT', // Wormadam
  421: 'OVERCAST', // Cherrim
  422: 'WEST_SEA', // Shellos
  423: 'WEST_SEA', // Gastrodon
  487: 'ALTERED', // Giratina
  550: 'RED_STRIPED', // Basculin
  555: 'STANDARD', // Darmanitan
  585: 'SPRING', // Deerling
  586: 'SPRING', // Sawsbuck
  641: 'INCARNATE', // Tornadus
  642: 'INCARNATE', // Thundurus
  645: 'INCARNATE', // Landorus
  646: 'NORMAL', // Kyurem
  647: 'ORDINARY', // Keldeo
  648: 'ARIA', // Meloetta
  649: 'NORMAL', // Genesect
  666: 'MEADOW', // Vivillon
  669: 'RED', // Flabébé
  670: 'RED', // Floette
  671: 'RED', // Florges
  676: 'NATURAL', // Furfrou
  681: 'SHIELD', // Aegislash
  718: 'FIFTY_PERCENT', // Zygarde
  741: 'BAILE', // Oricorio
  745: 'MIDDAY', // Lycanroc
  746: 'SOLO', // Wishiwashi
  778: 'DISGUISED', // Mimikyu
  849: 'AMPED', // Toxtricity
  876: 'MALE', // Indeedee
  877: 'FULL_BELLY', // Morpeko
  888: 'HERO', // Zacian
  889: 'HERO', // Zamazenta
  892: 'SINGLE_STRIKE', // Urshifu
  905: 'INCARNATE', // Enamorus
  925: 'FAMILY_OF_FOUR', // Maushold
  931: 'GREEN', // Squawkabilly
  978: 'CURLY', // Tatsugiri
};
