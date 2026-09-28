/**
 * Pure creature-ref parsing/serializing, shared by every place that reads or writes the app's
 * `CreatureRef` shape to/from Supabase jsonb (`lib/api/listings.ts`'s `looking`, `lib/api/profile.ts`'s
 * `trainer_creatures.creature`, `lib/api/chats.ts`'s `chat_messages.offer` / `FormalOffer`, and
 * `my_trade_history`'s `gave`/`got`). Each of those used to hand-roll its own copy of this parse/write
 * pair; a drift between the copies (one of them forgetting to carry `formCode` through, say) would
 * silently drop sprite form data on some paths but not others. This is now the one place.
 *
 * Type-only, RELATIVE imports only (no `@/` alias): loaded directly by vitest, the same constraint
 * `lib/sprite-url.ts`'s header comment explains for the mirror script.
 */
import type { Json } from '../database.types';
import type { CreatureRef } from '../../data/types';

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** The object member of the `Json` union (`lib/database.types.ts`) — never its array/primitive members.
 *  `creatureRefToJson` returns this instead of the full `Json` so a caller building a wider jsonb object
 *  (e.g. `chats.ts`'s `offerToJson` layering `iv`/`move` on top) can spread it directly instead of
 *  re-narrowing it first. */
type JsonObject = { [key: string]: Json | undefined };

/** A non-empty string, or `undefined` for anything else — what `formCode`/`costumeCode` must be to
 *  survive a parse; an empty string is never a real PokeMiners code. */
function nonEmptyString(value: unknown): string | undefined {
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}

/**
 * One creature-ref entry out of jsonb — a `looking` array element, a formal offer, a trainer's
 * Arsenal/Wishlist row, a trade-history `gave`/`got` — or `null` when the value isn't a valid one.
 * Defensive, not a schema re-validator: this client never re-checks everything the DB's
 * `creature_ref_is_valid` already enforces server-side, it just refuses to construct a `CreatureRef`
 * missing the three fields (`name`, `pokemonId`, `hue`) every caller assumes are always present.
 */
export function parseCreatureRef(value: Json | unknown): CreatureRef | null {
  if (!isRecord(value)) return null;
  const { name, pokemonId, hue, shiny, lucky, formCode, costumeCode } = value;
  if (typeof name !== 'string' || typeof pokemonId !== 'number' || typeof hue !== 'number') return null;

  const parsedFormCode = nonEmptyString(formCode);
  const parsedCostumeCode = nonEmptyString(costumeCode);

  return {
    name,
    pokemonId,
    hue,
    ...(shiny === true ? { shiny } : {}),
    ...(lucky === true ? { lucky } : {}),
    ...(parsedFormCode !== undefined ? { formCode: parsedFormCode } : {}),
    ...(parsedCostumeCode !== undefined ? { costumeCode: parsedCostumeCode } : {}),
  };
}

/** Every entry of a jsonb array that parses as a valid `CreatureRef`. An entry that doesn't (a
 *  malformed row, a future schema change this client hasn't caught up to) is skipped rather than
 *  failing the whole list — same defensive posture as `parseCreatureRef` itself. */
export function parseCreatureRefs(value: Json | unknown): CreatureRef[] {
  if (!Array.isArray(value)) return [];
  const refs: CreatureRef[] = [];
  for (const entry of value) {
    const ref = parseCreatureRef(entry);
    if (ref) refs.push(ref);
  }
  return refs;
}

/**
 * A `CreatureRef` as `creature_ref_is_valid` / `formal_offer_is_valid` accept it: only the allowed
 * keys, falsy `shiny`/`lucky` omitted (the DB check wants them absent, not `false`), and
 * `formCode`/`costumeCode` omitted — never sent as an explicit JSON `null` — when the ref doesn't carry
 * one, since the check constraint rejects a literal `null` for either key (see `data/types.ts`'s
 * `CreatureRef.formCode` comment).
 */
export function creatureRefToJson(ref: CreatureRef): JsonObject {
  return {
    name: ref.name,
    pokemonId: ref.pokemonId,
    hue: ref.hue,
    ...(ref.shiny ? { shiny: true } : {}),
    ...(ref.lucky ? { lucky: true } : {}),
    ...(ref.formCode != null ? { formCode: ref.formCode } : {}),
    ...(ref.costumeCode != null ? { costumeCode: ref.costumeCode } : {}),
  };
}
