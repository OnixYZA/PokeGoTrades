/**
 * Content of the in-app "How PokeGoTrades works" guide (`components/modals/TradeGuideModal.tsx`).
 *
 * PURE and number-free by construction: every figure a trainer reads here (Stardust, rep, minutes, rep
 * standings, the vicinity radius) is imported from the module that defines it (`TRADE_COST_MATRIX`,
 * `lib/reputation.ts`, `constants/locations.ts`) and formatted, never typed, so the guide cannot drift from
 * the rules the app and the database actually enforce. `lib/trade-guide.test.ts` scans every string here for
 * numeric tokens and fails on any that is not derived from one of those imports. Relative imports only: vitest
 * loads this module directly (no `@/` alias, no react-native).
 */
import { MAX_BADGE_PALETTES } from '../constants/max-badges';
import { PROOF_KIND_LABELS } from '../constants/listing-attributes';
import { VICINITY_RADIUS_LABEL } from '../constants/locations';
import { CROWNED_FORM_TOGGLES } from '../constants/pokedex';
import { TRADE_COST_MATRIX, type FriendshipLabel, type TradeType } from '../data/types';
import { fmtDust, speciesName } from './format';
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

export type TradeGuideStepId = 'listings' | 'stardust' | 'handshake' | 'reputation';

/** The guide's steps, in the order they are shown. */
export const TRADE_GUIDE_STEP_IDS: readonly TradeGuideStepId[] = ['listings', 'stardust', 'handshake', 'reputation'];

export interface TradeGuideSection {
  heading: string;
  points: readonly string[];
}

export interface TradeGuideStep {
  id: TradeGuideStepId;
  title: string;
  /** Short label for the step pill. */
  shortTitle: string;
  intro: string;
  sections: readonly TradeGuideSection[];
}

/** Friendship tiers, lowest to highest: the column order of the Stardust table. */
export const FRIENDSHIP_TIERS: readonly FriendshipLabel[] = ['Good', 'Great', 'Ultra', 'Best'];

export interface StardustRow {
  tradeType: TradeType;
  label: string;
  costs: readonly { tier: FriendshipLabel; dust: number; text: string }[];
  /** The costliest row, which gets the gold tint. */
  highlight: boolean;
}

const HIGHLIGHT_TRADE_TYPE: TradeType = 'Unregistered (Shiny/Legendary)';

/** The Stardust table, built by walking `TRADE_COST_MATRIX` (AGENTS.md: never hand-type a cost). */
export function stardustTable(): readonly StardustRow[] {
  return (Object.keys(TRADE_COST_MATRIX) as TradeType[]).map((tradeType) => ({
    tradeType,
    label: tradeType,
    costs: FRIENDSHIP_TIERS.map((tier) => {
      const dust = TRADE_COST_MATRIX[tradeType][tier];
      return { tier, dust, text: fmtDust(dust) };
    }),
    highlight: tradeType === HIGHLIGHT_TRADE_TYPE,
  }));
}

/** Rep as a score ("5.0"). Deltas use the raw constant ("0.1") instead. */
const score = (rep: number) => rep.toFixed(1);

/** The grace and penalty bullets, for the Bail & Block sheet's expandable row (a subset of the reputation step). */
export function reputationRuleSummary(): readonly string[] {
  return [
    `Grace period: for the first ${LOCK_GRACE_PERIOD_MINUTES} minutes after a lock, backing out costs nobody rep.`,
    'Reporting a spoofer or unreasonable adds never costs you rep.',
    // Only the "Other" reason carries the caller penalty (`evaluateBailOutcome`'s `late_bail_penalty`; SQL
    // `bail_and_block`: `p_reason = 'other'`). "Other" is the bail sheet's own label (BailBlockModal REASONS).
    `After the grace period, bailing with the reason "Other" once your partner has confirmed costs you ${REP_PENALTY_POST_GRACE_BAIL} rep. A seller who unlocks after the grace period, once the buyer has confirmed and the seller has not, pays the same.`,
    `After the grace period, a partner you report unresponsive loses ${REP_PENALTY_UNRESPONSIVE_NO_SHOW} rep, but only if you confirmed and they did not.`,
  ];
}

export function tradeGuideSteps(): readonly TradeGuideStep[] {
  const M = TRADE_COST_MATRIX;
  const unregSpecial = M['Unregistered (Shiny/Legendary)'];
  const { dynamax, gigantamax } = MAX_BADGE_PALETTES;
  const crowned = [...CROWNED_FORM_TOGGLES.values()].map(
    (t) => `${speciesName({ pokemonId: t.pokemonId })}: ${t.heroLabel} or ${t.crownedLabel}.`
  );
  const proofLabels = Object.values(PROOF_KIND_LABELS).join(', ');
  const tierLines = REP_TIER_THRESHOLDS.map((t, i) =>
    i === REP_TIER_THRESHOLDS.length - 1
      ? `${t.label}: below ${score(REP_TIER_THRESHOLDS[i - 1].min)}.`
      : `${t.label}: ${score(t.min)} or higher.`
  );

  return [
    {
      id: 'listings',
      title: 'Listings, forms & Max battle forms',
      shortTitle: 'Listings',
      intro: 'Post what you have, find what you want, and say exactly which version it is.',
      sections: [
        {
          heading: 'Location',
          points: [
            `Your listing shows a place name as a ${VICINITY_RADIUS_LABEL}, never your GPS position.`,
            'The feed filters by location (Home, your current vicinity or any place) and by attributes such as CP, Shiny, Purified, Lucky and ' +
              `${dynamax.label} / ${gigantamax.label}.`,
          ],
        },
        { heading: 'Crowned forms', points: crowned },
        {
          heading: 'Max battle forms',
          points: [
            `Pick Standard, ${dynamax.accessibilityLabel} (${dynamax.label}) or ${gigantamax.accessibilityLabel} (${gigantamax.label}). One per Pokémon.`,
            `${gigantamax.accessibilityLabel} is offered only for species with a ${gigantamax.label} form.`,
          ],
        },
        {
          heading: 'Proofs',
          points: [
            `Optional screenshots (${proofLabels}) are read automatically to verify the details you entered.`,
          ],
        },
      ],
    },
    {
      id: 'stardust',
      title: 'Stardust & friendship',
      shortTitle: 'Stardust',
      intro: 'A trade costs Stardust. How much depends on the trade type and on your friendship tier with your partner.',
      sections: [
        {
          heading: 'How the cost works',
          points: [
            'Registered standard trades cost the same at every friendship tier.',
            'Special and unregistered trades get cheaper as friendship grows.',
            `An unregistered Shiny or Legendary costs ${fmtDust(unregSpecial.Good)} at Good friendship and ${fmtDust(unregSpecial.Best)} at Best.`,
          ],
        },
      ],
    },
    {
      id: 'handshake',
      title: 'Offers, lock & handshake',
      shortTitle: 'Handshake',
      intro: 'Every trade follows the same moves, in the same order, so nobody can be surprised.',
      sections: [
        {
          heading: 'The flow',
          points: [
            'The buyer sends a Formal Offer.',
            'The seller locks the trade. Competing offers on that listing freeze.',
            'Inside the locked Handshake, friend codes and your partner\'s safe meet zone are revealed. They are never shown outside a lock.',
            'Both trainers confirm with Mark Trade Completed before the trade counts as done.',
          ],
        },
      ],
    },
    {
      id: 'reputation',
      title: 'Reputation & anti-bail',
      shortTitle: 'Reputation',
      intro: `Rep is a score from ${score(MIN_REP)} to ${score(MAX_REP)} that tells other trainers how reliable you are.`,
      sections: [
        {
          heading: 'Your score',
          points: [
            `You start at ${score(DEFAULT_REP)}, which is the maximum.`,
            `Each completed trade restores ${REP_GAIN_PER_COMPLETED_TRADE} after a penalty, up to ${score(MAX_REP)}.`,
            'Your streak counts consecutive UTC days with a completed trade.',
          ],
        },
        { heading: 'Standings', points: tierLines },
        { heading: 'Grace & penalties', points: reputationRuleSummary() },
      ],
    },
  ];
}
