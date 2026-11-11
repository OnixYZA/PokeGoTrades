import { readFileSync } from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import {
  computeRepAfterTrade,
  computeStreakAfterTrade,
  DEFAULT_REP,
  evaluateBailOutcome,
  evaluateUnlockOutcome,
  getLockGraceStatus,
  getRepStanding,
  LOCK_GRACE_PERIOD_MINUTES,
  LOCK_GRACE_PERIOD_MS,
  MAX_REP,
  MIN_REP,
  REP_GAIN_PER_COMPLETED_TRADE,
  REP_PENALTY_POST_GRACE_BAIL,
  REP_PENALTY_UNRESPONSIVE_NO_SHOW,
  type BailReason,
} from './reputation';

const LOCKED_AT = '2026-11-03T10:00:00.000Z';
const at = (minutes: number, extraMs = 0) => Date.parse(LOCKED_AT) + minutes * 60_000 + extraMs;

describe('constants', () => {
  it('match the spec', () => {
    expect([DEFAULT_REP, MIN_REP, MAX_REP]).toEqual([5.0, 0.0, 5.0]);
    expect(REP_GAIN_PER_COMPLETED_TRADE).toBe(0.1);
    expect(REP_PENALTY_UNRESPONSIVE_NO_SHOW).toBe(0.3);
    expect(REP_PENALTY_POST_GRACE_BAIL).toBe(0.2);
    expect(LOCK_GRACE_PERIOD_MINUTES).toBe(15);
    expect(LOCK_GRACE_PERIOD_MS).toBe(900_000);
  });
});

describe('computeRepAfterTrade', () => {
  it('adds 0.1 without float drift', () => {
    expect(computeRepAfterTrade(4.8)).toBe(4.9);
    expect(computeRepAfterTrade(4.9)).toBe(5);
    expect(computeRepAfterTrade(0.2)).toBe(0.3);
    expect(computeRepAfterTrade(3.3)).toBe(3.4);
    expect(computeRepAfterTrade(2.6)).toBe(2.7);
  });
  it('clamps at the maximum', () => {
    expect(computeRepAfterTrade(5)).toBe(5);
    expect(computeRepAfterTrade(7)).toBe(5);
  });
  it('clamps at the minimum', () => {
    expect(computeRepAfterTrade(-3)).toBe(0);
    expect(computeRepAfterTrade(-0.1)).toBe(0);
  });
  it('treats null/undefined as the default', () => {
    expect(computeRepAfterTrade(null)).toBe(5);
    expect(computeRepAfterTrade(undefined)).toBe(5);
  });
  it('repeated gains never drift', () => {
    let rep = 0;
    for (let i = 0; i < 50; i++) rep = computeRepAfterTrade(rep);
    expect(rep).toBe(5);
    rep = 3;
    for (let i = 0; i < 7; i++) rep = computeRepAfterTrade(rep);
    expect(rep).toBe(3.7);
  });
});

describe('computeStreakAfterTrade', () => {
  const now = '2026-11-03T12:00:00.000Z';
  it('same UTC day keeps the streak (min 1)', () => {
    expect(computeStreakAfterTrade(5, '2026-11-03T00:00:00.000Z', now)).toBe(5);
    expect(computeStreakAfterTrade(0, '2026-11-03T01:00:00.000Z', now)).toBe(1);
  });
  it('the previous UTC day extends it', () => {
    expect(computeStreakAfterTrade(5, '2026-11-02T23:59:59.999Z', now)).toBe(6);
    expect(computeStreakAfterTrade(0, '2026-11-02T00:00:00.000Z', now)).toBe(1);
  });
  it('rolls over at UTC midnight, not 24 hours', () => {
    expect(computeStreakAfterTrade(3, '2026-11-02T23:59:59.000Z', '2026-11-03T00:00:00.000Z')).toBe(4);
    expect(computeStreakAfterTrade(3, '2026-11-03T00:00:00.000Z', '2026-11-03T23:59:59.999Z')).toBe(3);
  });
  it('rolls over month and year boundaries', () => {
    expect(computeStreakAfterTrade(9, '2026-12-31T20:00:00.000Z', '2027-01-01T01:00:00.000Z')).toBe(10);
    expect(computeStreakAfterTrade(9, '2026-10-31T20:00:00.000Z', '2026-11-01T01:00:00.000Z')).toBe(10);
  });
  it('a gap of two or more days resets to 1', () => {
    expect(computeStreakAfterTrade(9, '2026-11-01T12:00:00.000Z', now)).toBe(1);
    expect(computeStreakAfterTrade(9, '2025-01-01T00:00:00.000Z', now)).toBe(1);
  });
  it('no previous trade starts at 1', () => {
    expect(computeStreakAfterTrade(0, null, now)).toBe(1);
    expect(computeStreakAfterTrade(7, undefined, now)).toBe(1);
    expect(computeStreakAfterTrade(null, null, now)).toBe(1);
  });
  it('a last trade in the future (clock skew) resets rather than extends', () => {
    expect(computeStreakAfterTrade(4, '2026-11-05T00:00:00.000Z', now)).toBe(1);
  });
  it('garbage dates reset to 1; nowIso defaults to the clock', () => {
    expect(computeStreakAfterTrade(4, 'nope', now)).toBe(1);
    expect(computeStreakAfterTrade(4, new Date().toISOString())).toBe(4);
  });
});

describe('getLockGraceStatus', () => {
  it('not locked', () => {
    const expected = { isLocked: false, inGracePeriod: true, remainingMinutes: 15, elapsedMinutes: 0 };
    expect(getLockGraceStatus(null)).toEqual(expected);
    expect(getLockGraceStatus(undefined, 123)).toEqual(expected);
  });
  it('14:59 is in grace', () => {
    const s = getLockGraceStatus(LOCKED_AT, at(14.9833333333333));
    expect(s.isLocked).toBe(true);
    expect(s.inGracePeriod).toBe(true);
    expect(s.remainingMinutes).toBeGreaterThan(0);
  });
  it('exactly 15:00 is still in grace (matches the SQL `>`)', () => {
    const s = getLockGraceStatus(LOCKED_AT, at(15));
    expect(s.inGracePeriod).toBe(true);
    expect(s.remainingMinutes).toBe(0);
    expect(s.elapsedMinutes).toBe(15);
  });
  it('15:01 is past grace', () => {
    const s = getLockGraceStatus(LOCKED_AT, at(15, 1000));
    expect(s.inGracePeriod).toBe(false);
    expect(s.remainingMinutes).toBe(0);
    expect(getLockGraceStatus(LOCKED_AT, at(15, 1)).inGracePeriod).toBe(false);
  });
  it('just locked, and clock skew before lock, show a full window', () => {
    expect(getLockGraceStatus(LOCKED_AT, at(0))).toMatchObject({ elapsedMinutes: 0, remainingMinutes: 15 });
    expect(getLockGraceStatus(LOCKED_AT, at(-5))).toMatchObject({ elapsedMinutes: 0, remainingMinutes: 15 });
  });
  it('reports partial elapsed time', () => {
    expect(getLockGraceStatus(LOCKED_AT, at(5))).toMatchObject({ elapsedMinutes: 5, remainingMinutes: 10 });
  });
});

describe('evaluateBailOutcome', () => {
  const base = { callerConfirmed: false, partnerConfirmed: false };
  const reasons: BailReason[] = ['unresponsive', 'unreasonable_adds', 'spoofer', 'other'];

  it('unlocked: no penalty for any reason', () => {
    for (const reason of reasons) {
      const o = evaluateBailOutcome({ ...base, reason, lockedAtIso: null, partnerConfirmed: true, nowMs: at(60) });
      expect(o).toMatchObject({ kind: 'unlocked', partnerPenalty: 0, callerPenalty: 0 });
      expect(o.summary).toBeTruthy();
    }
  });
  it('in grace: no penalty for any reason, including exactly 15:00', () => {
    for (const reason of reasons) {
      for (const nowMs of [at(0), at(14.9833333333333), at(15)]) {
        const o = evaluateBailOutcome({ ...base, reason, lockedAtIso: LOCKED_AT, partnerConfirmed: true, nowMs });
        expect(o).toMatchObject({ kind: 'grace_period', partnerPenalty: 0, callerPenalty: 0 });
      }
    }
  });
  it('past grace: misconduct reasons carry no penalty', () => {
    for (const reason of ['spoofer', 'unreasonable_adds'] as const) {
      const o = evaluateBailOutcome({ ...base, reason, lockedAtIso: LOCKED_AT, partnerConfirmed: true, nowMs: at(15, 1000) });
      expect(o).toMatchObject({ kind: 'partner_misconduct', partnerPenalty: 0, callerPenalty: 0 });
    }
  });
  it('past grace: unresponsive penalises the partner by 0.3 only when the caller confirmed and the partner did not', () => {
    const o = evaluateBailOutcome({ reason: 'unresponsive', callerConfirmed: true, partnerConfirmed: false, lockedAtIso: LOCKED_AT, nowMs: at(15, 1000) });
    expect(o).toMatchObject({ kind: 'no_show_reported', partnerPenalty: 0.3, callerPenalty: 0 });
  });
  it('past grace: unresponsive is free when the partner confirmed, the caller did not, or both did', () => {
    for (const [callerConfirmed, partnerConfirmed] of [[false, true], [false, false], [true, true]] as const) {
      const o = evaluateBailOutcome({ reason: 'unresponsive', callerConfirmed, partnerConfirmed, lockedAtIso: LOCKED_AT, nowMs: at(15, 1000) });
      expect(o).toMatchObject({ kind: 'grace_period', partnerPenalty: 0, callerPenalty: 0 });
    }
  });
  it('past grace: other with the partner confirmed penalises the caller by 0.2', () => {
    const o = evaluateBailOutcome({ ...base, partnerConfirmed: true, reason: 'other', lockedAtIso: LOCKED_AT, nowMs: at(30) });
    expect(o).toMatchObject({ kind: 'late_bail_penalty', partnerPenalty: 0, callerPenalty: 0.2 });
  });
  it('past grace: other without the partner confirmed is free', () => {
    const o = evaluateBailOutcome({ ...base, reason: 'other', lockedAtIso: LOCKED_AT, nowMs: at(30), callerConfirmed: true });
    expect(o).toMatchObject({ kind: 'grace_period', partnerPenalty: 0, callerPenalty: 0 });
  });
  it('defaults nowMs to the clock', () => {
    const lockedAt = new Date(Date.now() - 60 * 60_000).toISOString();
    expect(evaluateBailOutcome({ reason: 'unresponsive', callerConfirmed: true, partnerConfirmed: false, lockedAtIso: lockedAt }).kind).toBe('no_show_reported');
  });
});

describe('evaluateUnlockOutcome', () => {
  const base = { lockedAtIso: LOCKED_AT, sellerConfirmed: false, buyerConfirmed: true };

  it('no lock: nobody is penalised', () => {
    expect(evaluateUnlockOutcome({ ...base, lockedAtIso: null, nowMs: at(60) })).toMatchObject({ kind: 'unlocked', sellerPenalty: 0 });
  });
  it('inside the grace: free, even with the buyer confirmed', () => {
    expect(evaluateUnlockOutcome({ ...base, nowMs: at(14) })).toMatchObject({ kind: 'grace_period', sellerPenalty: 0 });
  });
  it('boundary: exactly 15:00 is still grace, 15:00.001 is past', () => {
    expect(evaluateUnlockOutcome({ ...base, nowMs: at(15) })).toMatchObject({ kind: 'grace_period', sellerPenalty: 0 });
    expect(evaluateUnlockOutcome({ ...base, nowMs: at(15, 1) })).toMatchObject({ kind: 'late_unlock_penalty', sellerPenalty: 0.2 });
  });
  it('past grace with the buyer confirmed and the seller not: 0.2', () => {
    const o = evaluateUnlockOutcome({ ...base, nowMs: at(20) });
    expect(o).toMatchObject({ kind: 'late_unlock_penalty', sellerPenalty: REP_PENALTY_POST_GRACE_BAIL });
    expect(o.summary).toBeTruthy();
  });
  it('past grace with the buyer not confirmed: free', () => {
    expect(evaluateUnlockOutcome({ ...base, buyerConfirmed: false, nowMs: at(20) })).toMatchObject({ kind: 'no_penalty', sellerPenalty: 0 });
  });
  it('past grace with the seller already confirmed: free', () => {
    expect(evaluateUnlockOutcome({ ...base, sellerConfirmed: true, buyerConfirmed: false, nowMs: at(20) })).toMatchObject({ sellerPenalty: 0 });
  });
});

describe('getRepStanding', () => {
  it('tier boundaries', () => {
    expect(getRepStanding(5).label).toBe('Exemplary');
    expect(getRepStanding(4.8).label).toBe('Exemplary');
    expect(getRepStanding(4.7).label).toBe('Trusted');
    expect(getRepStanding(4.2).label).toBe('Trusted');
    expect(getRepStanding(4.1).label).toBe('Standard');
    expect(getRepStanding(3.5).label).toBe('Standard');
    expect(getRepStanding(3.4).label).toBe('Caution');
    expect(getRepStanding(0).label).toBe('Caution');
  });
  it('null counts as the default (Exemplary) and tiers have distinct colours', () => {
    expect(getRepStanding(null).tier).toBe('exemplary');
    const colors = [5, 4.5, 4, 1].map((r) => getRepStanding(r, 10, 0).color);
    expect(new Set(colors).size).toBe(4);
  });
});

const MIGRATIONS_DIR = path.join(__dirname, '..', 'supabase', 'migrations');
const readMigration = (name: string): string => readFileSync(path.join(MIGRATIONS_DIR, name), 'utf8');
const taggedLine = (sql: string, tag: string): string => {
  const line = sql.split('\n').find((l) => l.includes(`-- ${tag}`));
  if (!line) throw new Error(`no SQL line tagged ${tag}`);
  return line;
};

// 000400 is applied on hosted and immutable; 000500 redefines bail_and_block / unlock_trade, and 20261112000100
// recreates bail_and_block again (latest definition), so the penalty constants are pinned in ALL THREE.
describe.each([
  '20261103000400_reputation_and_anti_bail.sql',
  '20261103000500_tighten_reputation_loopholes.sql',
  '20261112000100_security_hardening.sql',
])('SQL drift guard (supabase/migrations/%s)', (file) => {
  const sql = readMigration(file);
  const lineWith = (tag: string) => taggedLine(sql, tag);

  it('unresponsive penalty and min rep', () => {
    const line = lineWith('REP_PENALTY_UNRESPONSIVE_NO_SHOW');
    expect(line).toContain(`- ${REP_PENALTY_UNRESPONSIVE_NO_SHOW})`);
    expect(line).toContain(`greatest(${MIN_REP.toFixed(1)},`);
  });
  it('post-grace bail penalty', () => {
    const line = lineWith('REP_PENALTY_POST_GRACE_BAIL');
    expect(line).toContain(`- ${REP_PENALTY_POST_GRACE_BAIL})`);
    expect(line).toContain(`greatest(${MIN_REP.toFixed(1)},`);
  });
  it('grace window', () => {
    expect(lineWith('LOCK_GRACE_PERIOD_MINUTES')).toContain(`interval '${LOCK_GRACE_PERIOD_MINUTES} minutes'`);
  });
});

describe('SQL drift guard (20261103000400: confirm_trade and profiles)', () => {
  const sql = readMigration('20261103000400_reputation_and_anti_bail.sql');
  const lineWith = (tag: string) => taggedLine(sql, tag);

  it('gain', () => {
    expect(lineWith('REP_GAIN_PER_COMPLETED_TRADE')).toContain(`+ ${REP_GAIN_PER_COMPLETED_TRADE})`);
  });
  it('max rep', () => {
    expect(lineWith('REP_GAIN_PER_COMPLETED_TRADE')).toContain(`least(${MAX_REP.toFixed(1)},`);
    expect(lineWith('REP_GAIN_PER_COMPLETED_TRADE')).toContain(`coalesce(rep, ${DEFAULT_REP.toFixed(1)})`);
  });
  it('profiles default rep', () => {
    expect(sql).toContain(`alter column rep set default ${DEFAULT_REP.toFixed(1)}`);
  });
  it('the BailReason mirror covers the enum', () => {
    const enums = readFileSync(path.join(__dirname, '..', 'supabase', 'migrations', '20260916000100_extensions_enums_validators.sql'), 'utf8');
    const match = /create type public\.bail_reason\s+as enum \(([^)]*)\)/.exec(enums);
    const values = match![1].split(',').map((v) => v.trim().replace(/'/g, '')).sort();
    expect(values).toEqual([...(['unresponsive', 'unreasonable_adds', 'spoofer', 'other'] satisfies BailReason[])].sort());
  });
});

describe('SQL drift guard (20261103000500: tightened rules)', () => {
  const sql = readMigration('20261103000500_tighten_reputation_loopholes.sql');
  const fn = (name: string): string => {
    const start = sql.indexOf(`create or replace function public.${name}(`);
    if (start < 0) throw new Error(`no ${name} in 000500`);
    const next = sql.indexOf('create or replace function', start + 1);
    return sql.slice(start, next < 0 ? undefined : next);
  };

  it('bail_and_block penalises the partner for unresponsive only when the caller confirmed and the partner did not', () => {
    const body = fn('bail_and_block');
    expect(body).toMatch(/p_reason = 'unresponsive'\s+--[^\n]*\n\s+and \(case when v_uid = v_lock\.seller_id then v_lock\.seller_confirmed_at else v_lock\.buyer_confirmed_at end\) is not null\s+and \(case when v_uid = v_lock\.seller_id then v_lock\.buyer_confirmed_at else v_lock\.seller_confirmed_at end\) is null/);
  });
  it('unlock_trade reads the lock before deleting it and needs buyer confirmed, seller not', () => {
    const body = fn('unlock_trade');
    expect(body.indexOf('select * into v_lock')).toBeGreaterThan(-1);
    expect(body.indexOf('select * into v_lock')).toBeLessThan(body.indexOf('delete from public.trade_locks'));
    expect(body.indexOf('REP_PENALTY_POST_GRACE_BAIL')).toBeLessThan(body.indexOf('delete from public.trade_locks'));
    expect(body).toContain('v_lock.buyer_confirmed_at is not null and v_lock.seller_confirmed_at is null');
    expect(body).toContain('where id = v_uid');
  });
});
