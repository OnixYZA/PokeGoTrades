import { describe, expect, it } from 'vitest';

import { describeBailSafeguard } from './bail-safeguard';
import { LOCK_GRACE_PERIOD_MINUTES, REP_PENALTY_POST_GRACE_BAIL, REP_PENALTY_UNRESPONSIVE_NO_SHOW } from './reputation';

const NOW = Date.parse('2026-01-01T12:00:00Z');
const minutesAgo = (m: number) => new Date(NOW - m * 60_000).toISOString();
const base = { callerConfirmed: false, partnerConfirmed: false, nowMs: NOW };
const pastGrace = minutesAgo(LOCK_GRACE_PERIOD_MINUTES + 30);

describe('describeBailSafeguard', () => {
  it('makes no claim when the lock time is unknown', () => {
    expect(describeBailSafeguard({ ...base, reason: 'other', lockedAtIso: undefined })).toBeNull();
  });

  it('pre-lock chat is penalty-free', () => {
    const s = describeBailSafeguard({ ...base, reason: 'other', lockedAtIso: null });
    expect(s).toMatchObject({ tone: 'safe', headline: 'PRE-LOCK CHAT' });
  });

  it('inside the grace period shows the remaining minutes, whatever the reason', () => {
    const s = describeBailSafeguard({ ...base, reason: 'other', partnerConfirmed: true, lockedAtIso: minutesAgo(1) });
    expect(s?.tone).toBe('safe');
    expect(s?.headline).toMatch(/^GRACE PERIOD ACTIVE · \d+m left$/);
  });

  it('a past-grace report is protected, and unresponsive names the partner penalty', () => {
    const s = describeBailSafeguard({ ...base, callerConfirmed: true, reason: 'unresponsive', lockedAtIso: pastGrace });
    expect(s?.tone).toBe('caution');
    expect(s?.detail).toContain(String(REP_PENALTY_UNRESPONSIVE_NO_SHOW));
    const spoof = describeBailSafeguard({ ...base, reason: 'spoofer', lockedAtIso: pastGrace });
    expect(spoof?.headline).toBe('PROTECTED REPORT');
  });

  it('unresponsive past grace without "caller confirmed, partner not" charges nobody and does not claim a live grace', () => {
    for (const flags of [{ partnerConfirmed: true }, {}, { callerConfirmed: true, partnerConfirmed: true }]) {
      const s = describeBailSafeguard({ ...base, ...flags, reason: 'unresponsive', lockedAtIso: pastGrace });
      expect(s).toMatchObject({ tone: 'safe', headline: 'NO REP PENALTY' });
    }
  });

  it('"other" past grace is penalised only once the partner confirmed', () => {
    const late = describeBailSafeguard({ ...base, reason: 'other', partnerConfirmed: true, lockedAtIso: pastGrace });
    expect(late?.tone).toBe('penalty');
    expect(late?.headline).toContain(String(REP_PENALTY_POST_GRACE_BAIL));
    const free = describeBailSafeguard({ ...base, reason: 'other', lockedAtIso: pastGrace });
    expect(free?.tone).not.toBe('penalty');
  });
});
