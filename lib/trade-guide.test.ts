import { describe, expect, it } from 'vitest';

import { MAX_BADGE_PALETTES } from '../constants/max-badges';
import { VICINITY_RADIUS_LABEL } from '../constants/locations';
import { TRADE_COST_MATRIX, type FriendshipLabel, type TradeType } from '../data/types';
import { fmtDust } from './format';
import {
  DEFAULT_REP,
  LOCK_GRACE_PERIOD_MINUTES,
  MAX_REP,
  MIN_REP,
  REP_GAIN_PER_COMPLETED_TRADE,
  REP_PENALTY_POST_GRACE_BAIL,
  REP_PENALTY_UNRESPONSIVE_NO_SHOW,
  REP_TIER_THRESHOLDS,
} from './reputation';
import {
  FRIENDSHIP_TIERS,
  reputationRuleSummary,
  stardustTable,
  TRADE_GUIDE_STEP_IDS,
  tradeGuideSteps,
} from './trade-guide';

const TRADE_TYPES = Object.keys(TRADE_COST_MATRIX) as TradeType[];

describe('stardustTable', () => {
  it('mirrors TRADE_COST_MATRIX cell for cell', () => {
    const rows = stardustTable();
    expect(rows.map((r) => r.tradeType)).toEqual(TRADE_TYPES);
    for (const row of rows) {
      expect(row.costs.map((c) => c.tier)).toEqual([...FRIENDSHIP_TIERS]);
      for (const c of row.costs) {
        expect(c.dust).toBe(TRADE_COST_MATRIX[row.tradeType][c.tier]);
        expect(c.text).toBe(fmtDust(TRADE_COST_MATRIX[row.tradeType][c.tier]));
      }
    }
  });

  it('FRIENDSHIP_TIERS covers every key of every matrix row', () => {
    for (const type of TRADE_TYPES) {
      expect(Object.keys(TRADE_COST_MATRIX[type]).sort()).toEqual([...FRIENDSHIP_TIERS].sort());
    }
  });

  it('highlights only the unregistered Shiny/Legendary row', () => {
    const highlighted = stardustTable().filter((r) => r.highlight);
    expect(highlighted.map((r) => r.tradeType)).toEqual(['Unregistered (Shiny/Legendary)']);
    const [row] = highlighted;
    const text = (tier: FriendshipLabel) => row.costs.find((c) => c.tier === tier)!.text;
    expect(text('Good')).toBe(fmtDust(TRADE_COST_MATRIX['Unregistered (Shiny/Legendary)'].Good));
    expect(text('Best')).toBe(fmtDust(TRADE_COST_MATRIX['Unregistered (Shiny/Legendary)'].Best));
    // Sanity check of fmtDust against the literal AGENTS.md figures.
    expect(text('Good')).toBe('1M');
    expect(text('Best')).toBe('40K');
  });
});

describe('tradeGuideSteps', () => {
  it('has the steps in order, unique, each with at least one section', () => {
    const steps = tradeGuideSteps();
    expect(steps.map((s) => s.id)).toEqual([...TRADE_GUIDE_STEP_IDS]);
    expect(TRADE_GUIDE_STEP_IDS).toEqual(['listings', 'stardust', 'handshake', 'reputation']);
    expect(new Set(TRADE_GUIDE_STEP_IDS).size).toBe(TRADE_GUIDE_STEP_IDS.length);
    for (const s of steps) expect(s.sections.length).toBeGreaterThan(0);
  });

  it('the reputation step prints every constant it is built from', () => {
    const text = flatten(tradeGuideSteps().find((s) => s.id === 'reputation')!).join('\n');
    for (const needle of [
      DEFAULT_REP.toFixed(1),
      MAX_REP.toFixed(1),
      String(REP_GAIN_PER_COMPLETED_TRADE),
      String(REP_PENALTY_POST_GRACE_BAIL),
      String(REP_PENALTY_UNRESPONSIVE_NO_SHOW),
      String(LOCK_GRACE_PERIOD_MINUTES),
      ...REP_TIER_THRESHOLDS.filter((t) => t.min !== MIN_REP).map((t) => t.min.toFixed(1)),
    ]) {
      expect(text).toContain(needle);
    }
  });

  it('the stardust sentence uses the matrix', () => {
    const M = TRADE_COST_MATRIX['Unregistered (Shiny/Legendary)'];
    const text = flatten(tradeGuideSteps().find((s) => s.id === 'stardust')!).join('\n');
    expect(text).toContain(`${fmtDust(M.Good)} at Good friendship and ${fmtDust(M.Best)} at Best`);
  });

  // The numbers being right is not enough: each penalty must state the CONDITIONS `evaluateBailOutcome` /
  // `evaluateUnlockOutcome` (and the SQL) apply, or the copy overstates the rule. These pin each one.
  it('ties every penalty to its exact conditions', () => {
    const rules = reputationRuleSummary();
    const bail = rules.find((r) => r.includes(`${REP_PENALTY_POST_GRACE_BAIL} rep`))!;
    expect(bail).toMatch(/After the grace period/);
    expect(bail).toMatch(/reason "Other"/); // only `other` carries the caller penalty
    expect(bail).toMatch(/partner has confirmed/);
    expect(bail).toMatch(/seller who unlocks after the grace period, once the buyer has confirmed and the seller has not/);
    const noShow = rules.find((r) => r.includes(`${REP_PENALTY_UNRESPONSIVE_NO_SHOW} rep`))!;
    expect(noShow).toMatch(/After the grace period/);
    expect(noShow).toMatch(/only if you confirmed and they did not/);
    expect(rules.join('\n')).toMatch(new RegExp(`first ${LOCK_GRACE_PERIOD_MINUTES} minutes`));
    // Every rule in the bail sheet's summary is also in the full reputation step.
    const repStep = flatten(tradeGuideSteps().find((s) => s.id === 'reputation')!);
    for (const rule of rules) expect(repStep).toContain(rule);
  });

  it('says "Registered standard" for the flat row, so it cannot be read as "Unregistered (Standard)"', () => {
    const text = flatten(tradeGuideSteps().find((s) => s.id === 'stardust')!).join('\n');
    expect(text).toContain('Registered standard trades cost the same at every friendship tier.');
    expect(new Set(Object.values(TRADE_COST_MATRIX['Standard / Registered'])).size).toBe(1); // ...and it IS flat
    expect(new Set(Object.values(TRADE_COST_MATRIX['Unregistered (Standard)'])).size).toBeGreaterThan(1);
  });

  // The drift guard below only sees digits; a spelled-out number would slip past it. "one" is left out: it is
  // ordinary English in the copy ("One per Pokémon", "no one"), and "one million" is still caught by "million".
  it('never spells a number out in words', () => {
    const words = /\b(zero|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|fifteen|twenty|thirty|forty|fifty|hundred|thousand|million|half|quarter)\b/i;
    const all = [...tradeGuideSteps().flatMap(flatten), ...reputationRuleSummary()];
    for (const s of all) expect(s, s).not.toMatch(words);
  });
});

function flatten(step: { title: string; shortTitle: string; intro: string; sections: readonly { heading: string; points: readonly string[] }[] }): string[] {
  return [step.title, step.shortTitle, step.intro, ...step.sections.flatMap((s) => [s.heading, ...s.points])];
}

/**
 * DRIFT GUARD. Every numeric token in the guide's copy must be derivable from an imported source of truth.
 * The allowlist below is built ONLY from imports; if anyone hand-types a number into `lib/trade-guide.ts`
 * that no source module backs, this fails.
 */
describe('drift guard', () => {
  const allowed = new Set<string>();
  const allow = (n: number) => {
    allowed.add(String(n));
    allowed.add(n.toFixed(1));
  };

  // Stardust: every matrix value, raw and as fmtDust prints it.
  for (const type of TRADE_TYPES) {
    for (const tier of FRIENDSHIP_TIERS) {
      const dust = TRADE_COST_MATRIX[type][tier];
      allowed.add(String(dust));
      allowed.add(fmtDust(dust));
    }
  }
  // Rep constants, raw and as a score.
  [DEFAULT_REP, MAX_REP, MIN_REP, REP_GAIN_PER_COMPLETED_TRADE, REP_PENALTY_POST_GRACE_BAIL, REP_PENALTY_UNRESPONSIVE_NO_SHOW, LOCK_GRACE_PERIOD_MINUTES, ...REP_TIER_THRESHOLDS.map((t) => t.min)].forEach(allow);
  // Numbers inside the vicinity label (the km range) and any digits in the Max badge labels.
  const numbersIn = (s: string) => s.match(/\d+(?:\.\d+)?/g) ?? [];
  for (const n of numbersIn(VICINITY_RADIUS_LABEL)) allowed.add(n);
  for (const p of Object.values(MAX_BADGE_PALETTES)) for (const n of [...numbersIn(p.label), ...numbersIn(p.accessibilityLabel)]) allowed.add(n);

  const strings = [...tradeGuideSteps().flatMap(flatten), ...reputationRuleSummary()];
  // Numeric tokens: digits with optional decimal part and optional K / M suffix. Comma thousands separators
  // are NOT normalised away: a "20,000" would tokenise as "20" and "000" and fail, forcing fmtDust.
  const TOKEN = /\d+(?:\.\d+)?[KM]?/g;

  it('finds numbers to check (the guard is not vacuous)', () => {
    expect(strings.flatMap((s) => s.match(TOKEN) ?? []).length).toBeGreaterThan(10);
  });

  it('every number in the guide copy comes from an imported source', () => {
    const offenders: string[] = [];
    for (const s of strings) {
      for (const tok of s.match(TOKEN) ?? []) if (!allowed.has(tok)) offenders.push(`${tok} in "${s}"`);
    }
    expect(offenders).toEqual([]);
  });
});
