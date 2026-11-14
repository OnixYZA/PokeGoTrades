/**
 * Trader reputation and anti-bail rules (pure; no React, no Supabase). The server is authoritative:
 * `confirm_trade`, `bail_and_block` and `unlock_trade` apply these same numbers in SQL (migrations
 * `20261103000400_reputation_and_anti_bail.sql`, then `20261103000500_tighten_reputation_loopholes.sql`, which
 * supersedes the bail/unlock rules), and `lib/reputation.test.ts` fails if the two drift.
 * The mock (no-backend) store uses these functions directly.
 */

export const DEFAULT_REP = 5.0;
export const MIN_REP = 0.0;
export const MAX_REP = 5.0;

export const REP_GAIN_PER_COMPLETED_TRADE = 0.1;
/**
 * Charged to the PARTNER when the caller reports `unresponsive` after the grace period, but ONLY if the caller
 * had confirmed and the partner had not (someone who never confirmed cannot pin a no-show on the other side).
 */
export const REP_PENALTY_UNRESPONSIVE_NO_SHOW = 0.3;
/**
 * Charged to the CALLER who bails (`other`) after the grace period once the partner had confirmed, and to a
 * SELLER who unlocks after the grace period once the buyer had confirmed (and the seller had not).
 */
export const REP_PENALTY_POST_GRACE_BAIL = 0.2;

export const LOCK_GRACE_PERIOD_MINUTES = 15;
export const LOCK_GRACE_PERIOD_MS = LOCK_GRACE_PERIOD_MINUTES * 60 * 1000;

/** Local mirror of `public.bail_reason` (migration …0100 enums). Kept here so the module has no app imports. */
export type BailReason = 'unresponsive' | 'unreasonable_adds' | 'spoofer' | 'other';

/** One-decimal, float-drift-free rounding (4.9 + 0.1 style sums can land on 4.9000001). */
function round1(value: number): number {
  return Math.round((value + Number.EPSILON) * 10) / 10;
}

function clampRep(value: number): number {
  return Math.min(MAX_REP, Math.max(MIN_REP, round1(value)));
}

/** Rep after one completed trade. A missing rep counts as the default. */
export function computeRepAfterTrade(rep: number | null | undefined): number {
  return clampRep((rep ?? DEFAULT_REP) + REP_GAIN_PER_COMPLETED_TRADE);
}

const MS_PER_DAY = 24 * 60 * 60 * 1000;

function utcDayNumber(ms: number): number {
  return Math.floor(ms / MS_PER_DAY);
}

/**
 * Streak (consecutive UTC calendar days with a completed trade) after a trade at `nowIso`.
 * Same day -> unchanged (min 1); the previous day -> +1; anything else (or no/invalid last trade) -> 1.
 */
export function computeStreakAfterTrade(
  streak: number | null | undefined,
  lastTradeAtIso: string | null | undefined,
  nowIso?: string,
): number {
  const current = Math.max(0, streak ?? 0);
  const last = lastTradeAtIso ? Date.parse(lastTradeAtIso) : NaN;
  const now = nowIso ? Date.parse(nowIso) : Date.now();
  if (Number.isNaN(last) || Number.isNaN(now)) return 1;
  const gap = utcDayNumber(now) - utcDayNumber(last);
  if (gap === 0) return Math.max(1, current);
  if (gap === 1) return current + 1;
  return 1;
}

export interface LockGraceStatus {
  isLocked: boolean;
  inGracePeriod: boolean;
  remainingMinutes: number;
  elapsedMinutes: number;
}

/**
 * Where a lock sits relative to the grace window. Boundary: exactly 15:00 elapsed is STILL in grace
 * (the SQL treats only `now() - locked_at > interval '15 minutes'` as past grace); 15:00.001 is past.
 * Minutes are fractional; callers format them as they like.
 */
export function getLockGraceStatus(lockedAtIso: string | null | undefined, nowMs: number = Date.now()): LockGraceStatus {
  const lockedAt = lockedAtIso ? Date.parse(lockedAtIso) : NaN;
  if (Number.isNaN(lockedAt)) {
    return { isLocked: false, inGracePeriod: true, remainingMinutes: LOCK_GRACE_PERIOD_MINUTES, elapsedMinutes: 0 };
  }
  const elapsedMs = Math.max(0, nowMs - lockedAt);
  return {
    isLocked: true,
    inGracePeriod: elapsedMs <= LOCK_GRACE_PERIOD_MS,
    remainingMinutes: Math.max(0, (LOCK_GRACE_PERIOD_MS - elapsedMs) / 60000),
    elapsedMinutes: elapsedMs / 60000,
  };
}

export type BailOutcomeKind =
  | 'unlocked'
  | 'grace_period'
  | 'partner_misconduct'
  | 'no_show_reported'
  | 'late_bail_penalty';

export interface BailOutcome {
  kind: BailOutcomeKind;
  /** Rep points taken off the partner (0 if none). */
  partnerPenalty: number;
  /** Rep points taken off the caller (0 if none). */
  callerPenalty: number;
  summary: string;
}

export interface BailOutcomeInput {
  reason: BailReason;
  lockedAtIso: string | null | undefined;
  callerConfirmed?: boolean;
  partnerConfirmed: boolean;
  nowMs?: number;
}

/**
 * `callerConfirmed` / `partnerConfirmed` are each side's confirmation on the lock. `unresponsive` past the grace
 * period penalises the partner only when the caller confirmed and the partner did not.
 */
export function evaluateBailOutcome(input: BailOutcomeInput): BailOutcome {
  const { reason, lockedAtIso, callerConfirmed = false, partnerConfirmed, nowMs = Date.now() } = input;
  const grace = getLockGraceStatus(lockedAtIso, nowMs);
  const none = (kind: BailOutcomeKind, summary: string): BailOutcome => ({
    kind,
    partnerPenalty: 0,
    callerPenalty: 0,
    summary,
  });

  if (!grace.isLocked) return none('unlocked', 'No lock was held, so nobody is penalised.');
  if (grace.inGracePeriod) {
    return none('grace_period', `Within the ${LOCK_GRACE_PERIOD_MINUTES}-minute lock grace period: no rep penalty.`);
  }
  if (reason === 'spoofer' || reason === 'unreasonable_adds') {
    return none('partner_misconduct', 'Bailing over partner misconduct carries no penalty for you.');
  }
  if (reason === 'unresponsive') {
    if (!callerConfirmed || partnerConfirmed) {
      return none(
        'grace_period',
        'You can only report an unresponsive partner after you confirmed and they did not: no rep penalty.',
      );
    }
    return {
      kind: 'no_show_reported',
      partnerPenalty: REP_PENALTY_UNRESPONSIVE_NO_SHOW,
      callerPenalty: 0,
      summary: `Partner reported unresponsive after the grace period: their rep drops ${REP_PENALTY_UNRESPONSIVE_NO_SHOW}.`,
    };
  }
  if (partnerConfirmed) {
    return {
      kind: 'late_bail_penalty',
      partnerPenalty: 0,
      callerPenalty: REP_PENALTY_POST_GRACE_BAIL,
      summary: `Bailing after the grace period on a partner who already confirmed costs you ${REP_PENALTY_POST_GRACE_BAIL} rep.`,
    };
  }
  return none('grace_period', 'The partner had not confirmed, so there is no penalty.');
}

export interface UnlockOutcome {
  /** Rep points taken off the SELLER who unlocks (0 if none). */
  sellerPenalty: number;
  kind: 'unlocked' | 'grace_period' | 'no_penalty' | 'late_unlock_penalty';
  summary: string;
}

export interface UnlockOutcomeInput {
  lockedAtIso: string | null | undefined;
  sellerConfirmed: boolean;
  buyerConfirmed: boolean;
  nowMs?: number;
}

/**
 * Rep consequence of the SELLER unlocking (only the seller can; D1). Unlocking past the grace period after the
 * buyer confirmed (and the seller had not) is a bail in all but name, so it costs the same as a late bail.
 * Mirrors `unlock_trade` in migration 20261103000500.
 */
export function evaluateUnlockOutcome(input: UnlockOutcomeInput): UnlockOutcome {
  const { lockedAtIso, sellerConfirmed, buyerConfirmed, nowMs = Date.now() } = input;
  const grace = getLockGraceStatus(lockedAtIso, nowMs);
  if (!grace.isLocked) return { sellerPenalty: 0, kind: 'unlocked', summary: 'No lock was held, so nobody is penalised.' };
  if (grace.inGracePeriod) {
    return {
      sellerPenalty: 0,
      kind: 'grace_period',
      summary: `Within the ${LOCK_GRACE_PERIOD_MINUTES}-minute lock grace period: no rep penalty.`,
    };
  }
  if (buyerConfirmed && !sellerConfirmed) {
    return {
      sellerPenalty: REP_PENALTY_POST_GRACE_BAIL,
      kind: 'late_unlock_penalty',
      summary: `Unlocking after the grace period on a buyer who already confirmed costs you ${REP_PENALTY_POST_GRACE_BAIL} rep.`,
    };
  }
  return { sellerPenalty: 0, kind: 'no_penalty', summary: 'The buyer had not confirmed, so there is no penalty.' };
}

export type RepTier = 'exemplary' | 'trusted' | 'standard' | 'caution';

export interface RepStanding {
  tier: RepTier;
  label: string;
  /** A COLORS value from constants/theme.ts (inlined as hex so this module stays import-free). */
  color: string;
}

// Hex values mirror COLORS.accentGold / accentGreen / textMuted / accentDanger in constants/theme.ts.
const STANDING_COLORS = { exemplary: '#f5c518', trusted: '#7dffb3', standard: '#8b93a7', caution: '#ff5c8a' } as const;

/**
 * The standing tiers, highest first: the ONE source of the rep thresholds. `getRepStanding` walks it and the
 * in-app guide (`lib/trade-guide.ts`) prints it, so the number a trainer reads is the number that decides
 * their standing. The last entry's `min` is `MIN_REP`, so every score lands in a tier.
 */
export const REP_TIER_THRESHOLDS: readonly { tier: RepTier; label: string; min: number }[] = [
  { tier: 'exemplary', label: 'Exemplary', min: 4.8 },
  { tier: 'trusted', label: 'Trusted', min: 4.2 },
  { tier: 'standard', label: 'Standard', min: 3.5 },
  { tier: 'caution', label: 'Caution', min: MIN_REP },
];

/** Standing label for a rep score. `trades`/`bails` are accepted for callers' symmetry but do not change the tier. */
export function getRepStanding(rep: number | null | undefined, _trades?: number, _bails?: number): RepStanding {
  const value = rep ?? DEFAULT_REP;
  const last = REP_TIER_THRESHOLDS[REP_TIER_THRESHOLDS.length - 1];
  const hit = REP_TIER_THRESHOLDS.find((t) => value >= t.min) ?? last;
  return { tier: hit.tier, label: hit.label, color: STANDING_COLORS[hit.tier] };
}
