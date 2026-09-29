export function fmtDust(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1).replace(/\.0$/, '')}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1).replace(/\.0$/, '')}K`;
  return String(n);
}

/** The one place a shiny creature's display name gets its `"Shiny "` prefix — every screen that shows a
 *  creature's name to the trainer routes through this, so a shiny reads "Shiny Raboot" everywhere, not
 *  just wherever a screen happened to remember to say so (`app/(tabs)/profile.tsx`'s add-toast and
 *  `PokemonPickerModal`'s accessibility label used to each hand-roll this separately). Typed structurally
 *  rather than as `CreatureRef` so it also takes a `Listing`, a `FormalOffer`, or an ad-hoc `{ name,
 *  shiny }` literal — never mutates its argument, and never the thing to reach for when the raw species
 *  name is needed instead (a `key`, an equality check, `creature-ref.ts`'s (de)serializing, ...). */
export function creatureDisplayName(c: { name: string; shiny?: boolean | null }): string {
  return c.shiny ? `Shiny ${c.name}` : c.name;
}

/** A trade-history date as `TradeHistoryGrid` renders it, e.g. `'Aug 22, 2026'` — the one place that
 *  format is decided, so a live `completed_at` timestamp (`fetchMyTradeHistory`) and
 *  `data/publicProfile.ts`'s synthetic "N months ago" date can never drift apart in shape. */
export function formatTradeDate(date: Date): string {
  return date.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
}

