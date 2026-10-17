/**
 * The Pokémon type vocabulary and the one shape a creature's typing can take. A LEAF module on purpose:
 * no imports, no dex data. `constants/pokedex-data.ts` (generated) imports its types from here, and
 * `scripts/pokedex-source.ts` (the generator, a plain Node process) imports its validators from here, so
 * neither depends on the dex they are building. App code should import all of this from
 * `constants/pokedex.ts`, which re-exports it.
 */

/**
 * The 18 standard Pokémon types, spelled exactly as the generated data and `TYPE_HUE` spell them.
 * Declaration order only; it is NOT a display order, so a UI that wants the conventional type-chart order
 * should sort for itself. The union below is derived from this array so the two can never drift.
 */
export const POKEMON_TYPES = [
  'Normal',
  'Fire',
  'Fighting',
  'Water',
  'Flying',
  'Grass',
  'Poison',
  'Electric',
  'Ground',
  'Psychic',
  'Rock',
  'Ice',
  'Bug',
  'Dragon',
  'Ghost',
  'Steel',
  'Dark',
  'Fairy',
] as const;

export type PokemonType = (typeof POKEMON_TYPES)[number];

/**
 * A creature's typing: one or two types, never zero and never three. The tuple makes the wrong arity a
 * compile error, and `toPokemonTypes` (below) is the one runtime gate for data that arrives as strings.
 * Index 0 is the PRIMARY type (the source's slot 1 / `type`), index 1 the secondary (`type2`); the order is
 * exactly the order the data source gives, and `hue` is derived from index 0.
 */
export type PokemonTypes = readonly [PokemonType] | readonly [PokemonType, PokemonType];

const TYPE_SET: ReadonlySet<string> = new Set(POKEMON_TYPES);

export function isPokemonType(value: string): value is PokemonType {
  return TYPE_SET.has(value);
}

/**
 * Validates a list of type names that came from outside the type system (a CSV, a game master) into a
 * `PokemonTypes`. Throws, rather than coercing, on anything that is not 1 or 2 DISTINCT valid types, so a
 * bad source row fails the generator instead of becoming data. (Dual-typed with the same type twice, e.g.
 * Fire/Fire, is a data bug, never a real typing.)
 */
export function toPokemonTypes(names: readonly string[]): PokemonTypes {
  const [first, second, ...extra] = names;
  if (first === undefined || extra.length > 0) {
    throw new Error(`A Pokémon has one or two types, got ${names.length}: [${names.join(', ')}]`);
  }
  if (!isPokemonType(first)) throw new Error(`Unknown Pokémon type "${first}"`);
  if (second === undefined) return [first];
  if (!isPokemonType(second)) throw new Error(`Unknown Pokémon type "${second}"`);
  if (second === first) throw new Error(`A dual type must have two different types, got ${first}/${second}`);
  return [first, second];
}

/** `['Fire', 'Flying']` -> `'Fire / Flying'`; `['Grass']` -> `'Grass'`. For labels; never parse it back. */
export function formatTypes(types: PokemonTypes): string {
  return types.join(' / ');
}

/** Whether two typings are the same ordered pair. Order matters: primary type drives `hue`. */
export function sameTypes(a: PokemonTypes, b: PokemonTypes): boolean {
  return a.length === b.length && a.every((type, i) => type === b[i]);
}
