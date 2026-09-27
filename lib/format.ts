export function fmtDust(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1).replace(/\.0$/, '')}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1).replace(/\.0$/, '')}K`;
  return String(n);
}

/** A trade-history date as `TradeHistoryGrid` renders it, e.g. `'Aug 22, 2026'` — the one place that
 *  format is decided, so a live `completed_at` timestamp (`fetchMyTradeHistory`) and
 *  `data/publicProfile.ts`'s synthetic "N months ago" date can never drift apart in shape. */
export function formatTradeDate(date: Date): string {
  return date.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
}

