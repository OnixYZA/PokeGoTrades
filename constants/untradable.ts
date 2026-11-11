/**
 * Which creatures can never change hands in Pokémon GO, so must never be listed, wanted in return, or
 * formally offered. The client half of a rule the database enforces too: `public.is_creature_untradable`
 * (supabase/migrations/20260929000100_enforce_untradable_pokemon.sql, redefined by
 * 20261018000100_untradable_crowned_ultra_eternatus.sql) holds the SAME three lists, tagged
 * `-- UNTRADABLE_*`, and `constants/pokedex.test.ts` fails if the two drift apart.
 *
 * A LEAF module (no imports at all) on purpose, so two very different readers can share one rule:
 *
 *   - `constants/pokedex.ts` re-exports all of it, so app code keeps importing `isPokemonUntradable` from the
 *     dex; and
 *   - `scripts/pokedex-source.ts`, the Pokédex generator, compares these lists against the game master's
 *     `isTradable` flag at generation time (`checkTradability`). The generator cannot import
 *     `constants/pokedex.ts` (that pulls in `constants/pokedex-data.ts`, the file the generator is about to
 *     replace), the same reason `constants/base-form-codes.ts` is a leaf.
 *
 * WHERE THE RULES COME FROM. They are the project's own decision, and they agree with the pinned game master's
 * `isTradable` for every species and every form EXCEPT the one deliberate override below (Pecharunt). The
 * generator enforces that: a game master update that changes any creature's tradability fails the run until
 * these lists (and the database function) are updated or the difference is documented in
 * `TRADABILITY_OVERRIDES` (scripts/pokedex-source.ts). Do not edit a list here without the matching migration.
 *
 * Shadow Pokémon are untradable as well, but that rule has no entry here because no creature shape in the app
 * can carry "shadow" at all (`listings.bg <> 'shadow'`, and `CreatureRef`/`FormalOffer` have no shadow flag).
 */

/** Mythicals can't be traded in Pokémon GO. Meltan (808) and Melmetal (809) are the one exception and are
 *  deliberately absent. */
export const UNTRADABLE_MYTHICAL_IDS: ReadonlySet<number> = new Set([
  151, // Mew
  251, // Celebi
  385, // Jirachi
  386, // Deoxys (all forms)
  489, // Phione
  490, // Manaphy
  491, // Darkrai
  492, // Shaymin
  493, // Arceus
  494, // Victini
  647, // Keldeo
  648, // Meloetta
  649, // Genesect
  719, // Diancie
  720, // Hoopa
  721, // Volcanion
  801, // Magearna
  802, // Marshadow
  807, // Zeraora
  893, // Zarude
  // Pecharunt is the ONE place this rule deliberately departs from the game master: the pinned game master
  // marks it `isTradable: true` (on its formless template and its `PECHARUNT_NORMAL` form), but the project
  // treats it as a Mythical and keeps it untradable. That is a product decision, not a reading of the source,
  // so it is recorded as an override in `TRADABILITY_OVERRIDES` (scripts/pokedex-source.ts), which is what
  // lets the generator's tradability cross-check pass. Removing it here without removing the override fails
  // the generator, and so does a game master that stops calling it tradable.
  1025, // Pecharunt
]);

/** Species that are untradable in every form, although they are not Mythicals. */
export const UNTRADABLE_SPECIES_IDS: ReadonlySet<number> = new Set([
  718, // Zygarde (every form, the Complete forms included)
  890, // Eternatus, the whole species: Eternatus and Eternamax Eternatus (`ETERNAMAX`) alike
]);

/**
 * Untradable FORMS of a species whose other forms stay tradable, keyed by PokeMiners form code
 * (`CreatureRef.formCode`). The species itself, and its default form, can still be traded.
 *
 * Added on the project's decision (2026-10-18): the Crowned forms and Ultra Necrozma. Each one matches the
 * game master, which carries no `isTradable` on `ZACIAN_CROWNED_SWORD`, `ZAMAZENTA_CROWNED_SHIELD` or
 * `NECROZMA_ULTRA` although it does on their base forms.
 */
export const UNTRADABLE_FORM_COMBINATIONS: readonly { pokemonId: number; formCode: string }[] = [
  { pokemonId: 646, formCode: 'WHITE' }, // White Kyurem (fused). Plain Kyurem stays tradable.
  { pokemonId: 646, formCode: 'BLACK' }, // Black Kyurem (fused)
  { pokemonId: 800, formCode: 'DUSK_MANE' }, // Dusk Mane Necrozma (fused). Plain Necrozma stays tradable.
  { pokemonId: 800, formCode: 'DAWN_WINGS' }, // Dawn Wings Necrozma (fused)
  { pokemonId: 800, formCode: 'ULTRA' }, // Ultra Necrozma (Ultra Burst)
  { pokemonId: 888, formCode: 'CROWNED_SWORD' }, // Crowned Sword Zacian. Hero Zacian (the default form) stays tradable.
  { pokemonId: 889, formCode: 'CROWNED_SHIELD' }, // Crowned Shield Zamazenta. Hero Zamazenta (the default form) stays tradable.
];

/** Whether this species (and form) can never change hands in Pokémon GO, so it must never be listed,
 *  wanted in return, or formally offered. */
export function isPokemonUntradable(pokemonId: number, formCode?: string | null): boolean {
  if (UNTRADABLE_MYTHICAL_IDS.has(pokemonId) || UNTRADABLE_SPECIES_IDS.has(pokemonId)) return true;
  return formCode != null && UNTRADABLE_FORM_COMBINATIONS.some((c) => c.pokemonId === pokemonId && c.formCode === formCode);
}
