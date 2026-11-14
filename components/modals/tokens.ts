/**
 * Design tokens for the marketplace modal flows (Create Listing, Handshake, Bail & Block).
 * These come from their own handoff bundle with a palette distinct from `constants/theme.ts` —
 * kept separate rather than merged into the app-wide tokens so each stays a faithful match to
 * its own source of truth.
 */
import type { ViewStyle } from 'react-native';

import { gradient } from '@/constants/gradient';

export const MODAL_COLORS = {
  bgBase: '#08080c',
  bgSurface: '#0d0d14',
  bgCard: '#16161f',
  bgCardAlt: '#1c1c28',
  borderSubtle: '#1c1c28',
  borderDefault: '#2a2a38',
  textPrimary: '#f4f4f5',
  textSecondary: '#a1a1aa',
  textMuted: '#71717a',
  textDim: '#52525b',
  gold: '#fbbf24',
  goldDark: '#f59e0b',
  goldBright: '#fde047',
  goldPale: '#fef3c7',
  blue: '#38bdf8',
  blueDark: '#0284c7',
  pink: '#ec4899',
  pinkDark: '#db2777',
  success: '#22c55e',
  successDark: '#16a34a',
  successText: '#052e16',
  danger: '#ef4444',
  dangerDark: '#b91c1c',
} as const;

const C = MODAL_COLORS;

export const MODAL_SURFACE: Record<string, ViewStyle> = {
  ctaGold: {
    ...gradient(`linear-gradient(135deg, ${C.gold}, ${C.goldDark})`, C.gold),
    boxShadow: '0 8px 24px -8px rgba(251,191,36,0.5)',
  },
  ctaGreen: {
    ...gradient(`linear-gradient(135deg, ${C.success}, ${C.successDark})`, C.success),
    boxShadow: '0 8px 24px -8px rgba(34,197,94,0.5)',
  },
  ctaDanger: {
    ...gradient(`linear-gradient(135deg, ${C.danger}, ${C.dangerDark})`, C.danger),
    boxShadow: '0 8px 24px -8px rgba(239,68,68,0.5)',
  },
  toggleGold: {
    ...gradient(`linear-gradient(135deg, ${C.gold}, ${C.goldDark})`, C.gold),
    boxShadow: '0 0 12px rgba(251,191,36,0.4)',
  },
  togglePink: {
    ...gradient(`linear-gradient(135deg, ${C.pink}, ${C.pinkDark})`, C.pink),
    boxShadow: '0 0 12px rgba(236,72,153,0.4)',
  },
  toggleBlue: {
    ...gradient(`linear-gradient(135deg, ${C.blue}, ${C.blueDark})`, C.blue),
    boxShadow: '0 0 12px rgba(56,189,248,0.4)',
  },
  extractedCard: gradient(
    'linear-gradient(135deg, rgba(251,191,36,0.08), rgba(251,191,36,0.02))',
    'rgba(251,191,36,0.05)'
  ),
  sheenLine: gradient('linear-gradient(90deg, transparent, #fbbf24, transparent)', 'rgba(251,191,36,0.3)'),
  luckyBadge: gradient(`linear-gradient(135deg, ${C.gold}, ${C.goldDark})`, C.gold),
  stripedTile: gradient(
    'repeating-linear-gradient(45deg, #1c1c28, #1c1c28 6px, #22222e 6px, #22222e 12px)',
    C.bgCardAlt
  ),
  dangerIcon: gradient('linear-gradient(135deg, rgba(239,68,68,0.2), rgba(239,68,68,0.05))', 'rgba(239,68,68,0.08)'),
};

export function monogramGradient(from: string, to: string): ViewStyle {
  return gradient(`linear-gradient(135deg, ${from}, ${to})`, from);
}
