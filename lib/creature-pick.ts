/**
 * What a trainer picked in the Pokémon picker, as the `CreatureRef` the app stores: the one place a pick becomes
 * a ref, shared by every caller that stores one (`lib/api/profile.ts`'s Arsenal / Wishlist insert and
 * `CreateListingModal`'s "WANTED IN RETURN" list), plus the one rule for keeping such a list free of repeats.
 *
 * Lives apart from those two for the reason `lib/creature-list.ts` does: `profile.ts` reaches `expo-crypto` and a
 * Supabase client that throws at import time without env vars, and the modal reaches `react-native`, so neither
 * can be loaded by vitest. RELATIVE imports only (no `@/` alias), the constraint `lib/api/creature-ref.ts`'s
 * header comment explains.
 *
 * A creature's identity is `(pokemonId, formCode)` plus `shiny` (`spriteVariantKey`): two forms of one species
 * are two different creatures, so a pick that drops its `formCode` would store a different creature than the
 * trainer chose. Both functions below therefore carry it, and neither takes a species by `pokemonId` alone.
 */
import { findPokemon, formsOf, isPokemonUntradable } from '../constants/pokedex';
import type { CreatureRef } from '../data/types';
import { spriteVariantKey, spriteVariantOf, type SpriteSubject } from './sprite-url';

/**
 * THE one type for a picked creature: what the Pokémon picker hands its caller (`lib/picker-selection.ts`'s
 * `buildPick` is the only place one is made) and what every store of a pick takes (`creatureRefFromPick`,
 * `lib/api/profile.ts`'s `addToArsenal` / `addToWishlist`). Defined here, beside the code that stores it, so the
 * data layer never imports the picker; `picker-selection.ts` and `PokemonPickerModal.tsx` re-export it. Every
 * field is required, so a pick that forgot its form cannot type-check as one that chose the default.
 */
export interface PickedCreature {
  pokemonId: number;
  /** Always `false` when the picker was opened with `allowShiny: false`. */
  shiny: boolean;
  /** A form code in PokeMiners' spelling (`CreatureRef.formCode`), or `null` for the species' default form.
   *  ALWAYS `null` when the picker was opened with `allowForm: false`, and for a species with no forms. The
   *  default form is `null` even where it has a name of its own (Hero Zacian is `null`, never `'HERO'`), so
   *  one creature is never stored two ways (`defaultFormOf`). */
  formCode: string | null;
}

/** Why a pick cannot become a ref. The picker already refuses the last two, so reaching either means a caller
 *  skipped it; the check is the same belt-and-braces `handlePickForm` is, with the database as the backstop
 *  for the untradable one (`listings_tradable_guard`). */
export type PickFailure =
  /** `pokemonId` is not in the dex, so there is no name or hue to store (AGENTS.md: never hallucinate game data). */
  | 'unknown_species'
  /** The species does not come in that form (`formsOf`). A stored ref would name a creature that does not exist. */
  | 'unknown_form'
  /** The creature can never change hands in Pokémon GO (`isPokemonUntradable`, form-aware). */
  | 'untradable';

export type PickResult = { ok: true; ref: CreatureRef } | { ok: false; reason: PickFailure };

/**
 * The `CreatureRef` for a pick. `name` and `hue` are read out of the dex by `pokemonId`, never taken from the
 * caller, so a stored entry cannot drift from the one source of truth for what a Pokémon is called or how it is
 * coloured; `shiny` and `formCode` are the trainer's choices, which the dex cannot look up. A falsy `shiny` and
 * an absent / null / empty `formCode` are left OUT of the ref rather than stored as `false` / `null` (the shape
 * `parseCreatureRef` reads back and `creatureRefToJson` writes), so a default-form pick equals the same
 * creature read back from the database.
 *
 * `hue` is the species' (`PokedexEntry.hue` is its default form's primary type), not the form's: a form that
 * changes typing (Alolan Vulpix is Ice) is still tinted by its species, as a listing for it already is.
 */
export function creatureRefFromPick(pick: PickedCreature): PickResult {
  const entry = findPokemon(pick.pokemonId);
  if (!entry) return { ok: false, reason: 'unknown_species' };

  const formCode = pick.formCode || null;
  if (formCode !== null && !formsOf(entry.pokemonId).includes(formCode)) return { ok: false, reason: 'unknown_form' };
  if (isPokemonUntradable(entry.pokemonId, formCode)) return { ok: false, reason: 'untradable' };

  return {
    ok: true,
    ref: {
      name: entry.name,
      pokemonId: entry.pokemonId,
      hue: entry.hue,
      ...(pick.shiny ? { shiny: true } : {}),
      ...(formCode !== null ? { formCode } : {}),
    },
  };
}

/**
 * `list` with `candidate` added at the end, unless the list is already `max` long or already holds that exact
 * creature (same species, shiny flag, form and costume: `spriteVariantKey`). Returns `list` itself, not a copy,
 * when nothing is added, so a React state setter given this as an updater sees no change and skips the render.
 *
 * Two forms of one species, or a shiny and a regular, are different entries and may sit side by side; this is
 * what keeps "Alolan Vulpix" from being refused as a repeat of "Vulpix".
 */
export function appendDistinctCreature<T extends SpriteSubject>(list: T[], candidate: T, max: number): T[] {
  if (list.length >= max) return list;
  const candidateKey = spriteVariantKey(spriteVariantOf(candidate));
  if (list.some((existing) => spriteVariantKey(spriteVariantOf(existing)) === candidateKey)) return list;
  return [...list, candidate];
}
