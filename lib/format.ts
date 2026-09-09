export function fmtDust(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1).replace(/\.0$/, '')}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1).replace(/\.0$/, '')}K`;
  return String(n);
}

export function stardustCost(base: number, multiplier: number): number {
  return Math.max(100, Math.round(base * multiplier));
}
