/**
 * The copy and tone of the Bail & Block "Reputation & Grace Period Safeguard" banner.
 *
 * Every number and every verdict here comes from `lib/reputation.ts` (`getLockGraceStatus`,
 * `evaluateBailOutcome`), the same functions the rules are defined by, so the sentence a trainer reads
 * before pressing Submit cannot drift from what the server will do. Nothing below knows a penalty size or a
 * grace length. It is pure (no React, no clock of its own) so the wording is tested directly.
 */
import { evaluateBailOutcome, getLockGraceStatus } from './reputation';

export type BailSafeguardReason = 'unresponsive' | 'unreasonable_adds' | 'spoofer' | 'other';
export type BailSafeguardTone = 'safe' | 'caution' | 'penalty';

export interface BailSafeguardInput {
  reason: BailSafeguardReason;
  /**
   * When the trade lock was taken. `null` means "known to be unlocked" (a pre-lock chat). `undefined` means
   * "the caller doesn't know", and then no claim is made at all: promising "no penalty" for a lock we
   * cannot see would be a guess presented as a rule.
   */
  lockedAtIso: string | null | undefined;
  callerConfirmed: boolean;
  partnerConfirmed: boolean;
  nowMs: number;
}

export interface BailSafeguard {
  tone: BailSafeguardTone;
  /** Upper-case status line. */
  headline: string;
  /** The consequence, one sentence. */
  detail: string;
}

/** Formats a Rep delta without a stray trailing zero or float noise (0.3, not 0.30000000000000004). */
function rep(amount: number): string {
  return String(Math.round(amount * 100) / 100);
}

export function describeBailSafeguard(input: BailSafeguardInput): BailSafeguard | null {
  if (input.lockedAtIso === undefined) return null;
  const grace = getLockGraceStatus(input.lockedAtIso, input.nowMs);
  const outcome = evaluateBailOutcome({
    reason: input.reason,
    lockedAtIso: input.lockedAtIso,
    callerConfirmed: input.callerConfirmed,
    partnerConfirmed: input.partnerConfirmed,
    nowMs: input.nowMs,
  });

  switch (outcome.kind) {
    case 'unlocked':
      return { tone: 'safe', headline: 'PRE-LOCK CHAT', detail: 'No Rep penalty for leaving.' };
    case 'grace_period':
      // evaluateBailOutcome reuses this kind for "past grace but nothing to charge": don't claim a live grace.
      if (!grace.inGracePeriod) return { tone: 'safe', headline: 'NO REP PENALTY', detail: outcome.summary };
      return {
        tone: 'safe',
        headline: `GRACE PERIOD ACTIVE · ${grace.remainingMinutes}m left`,
        detail: 'Your Rep is protected.',
      };
    case 'late_bail_penalty':
      return {
        tone: 'penalty',
        headline: `−${rep(outcome.callerPenalty)} Rep late-bail penalty applies`,
        detail: 'The grace period has ended and your partner has confirmed the trade.',
      };
    case 'partner_misconduct':
    case 'no_show_reported':
      return {
        tone: 'caution',
        headline: 'PROTECTED REPORT',
        detail:
          outcome.partnerPenalty > 0
            ? `Your Rep is unaffected. Your partner loses ${rep(outcome.partnerPenalty)} Rep.`
            : 'Your Rep is unaffected.',
      };
  }
}
