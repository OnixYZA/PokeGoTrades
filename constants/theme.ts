/**
 * Style values NativeWind can't express as static utility classes: gradients, glows, and
 * anything driven by a per-Pokémon `hue`. React Native's New Architecture accepts these as
 * literal CSS strings via the `boxShadow` / `experimental_backgroundImage` style props, so
 * they port directly from the handoff instead of being approximated.
 */
import type { ViewStyle } from 'react-native';

import type { FriendshipLabel } from '@/data/types';

import { gradient } from './gradient';

export const COLORS = {
  bgBase: '#050810',
  bgCanvas: '#080b14',
  bgPanel: '#0a0f1c',
  bgCard: '#0f1524',
  bgCardAlt: '#101728',
  bgCardBottom: '#0b1120',
  borderDefault: '#1a2032',
  borderStrong: '#1e2436',
  borderSubtle: '#151b2a',
  borderDashed: '#2a3350',
  textPrimary: '#e8ecf5',
  textBody: '#c5cad9',
  textMuted: '#8b93a7',
  textSubtle: '#7d87a0', // lifted from the handoff's #6d7690 for WCAG AA contrast — see tailwind.config.js
  textFaint: '#4a5169',
  accentBlue: '#4fb3ff',
  accentBlueDark: '#2a8ed6',
  accentGold: '#f5c518',
  accentGoldDark: '#c99b0a',
  accentGoldDeep: '#2a1e02',
  accentPink: '#ff6bd6',
  accentDanger: '#ff5c8a',
  accentGreen: '#7dffb3',
  accentViolet: '#c9a6ff',
} as const;

export const FRIENDSHIP_LEVELS: { label: FriendshipLabel; color: string }[] = [
  { label: 'Good', color: COLORS.textMuted },
  { label: 'Great', color: '#7fd4ff' },
  { label: 'Ultra', color: COLORS.accentViolet },
  { label: 'Best', color: COLORS.accentGold },
];

// ——— static surfaces ———

export const SURFACE: Record<string, ViewStyle> = {
  card: gradient('linear-gradient(180deg, #0f1524 0%, #0b1120 100%)', COLORS.bgCard),
  control: gradient('linear-gradient(180deg, #101728, #0b1120)', COLORS.bgCardAlt),
  stardustCard: gradient('linear-gradient(180deg, #0f1524 0%, #0a0f1c 100%)', COLORS.bgCard),
  ctaBlue: {
    ...gradient('linear-gradient(180deg, #4fb3ff 0%, #2a8ed6 100%)', COLORS.accentBlue),
    boxShadow: '0 0 24px rgba(79,179,255,.35), inset 0 1px 0 rgba(255,255,255,.4)',
  },
  ctaBlueSmall: {
    ...gradient('linear-gradient(180deg, #4fb3ff 0%, #2a8ed6 100%)', COLORS.accentBlue),
    boxShadow: '0 0 20px rgba(79,179,255,.35)',
  },
  ctaGold: {
    ...gradient('linear-gradient(180deg, #f5c518 0%, #c99b0a 100%)', COLORS.accentGold),
    boxShadow: '0 0 20px rgba(245,197,24,.35)',
  },
  bubbleMe: gradient('linear-gradient(180deg, #4fb3ff 0%, #2a8ed6 100%)', COLORS.accentBlue),
  avatarHero: {
    ...gradient('linear-gradient(135deg, #4fb3ff, #2a4a80)', COLORS.accentBlue),
    boxShadow: '0 0 26px rgba(79,179,255,.35)',
  },
  lockedBanner: gradient(
    'linear-gradient(90deg, rgba(245,197,24,.12), rgba(245,197,24,.04))',
    'rgba(245,197,24,.08)'
  ),
  ctaFade: gradient('linear-gradient(180deg, transparent, #0a0f1c 30%)', COLORS.bgPanel),
  profileHero: gradient(
    'radial-gradient(ellipse at 20% 0%, rgba(79,179,255,.18), transparent 65%), linear-gradient(180deg, #0f1524, #0a0f1c)',
    COLORS.bgCard
  ),
  divider: gradient('linear-gradient(90deg, #1e2436, transparent)', COLORS.borderStrong),
};

export const luckyShimmerGradient =
  'linear-gradient(90deg, #a37a10 0%, #f5c518 45%, #fff2a8 50%, #f5c518 55%, #a37a10 100%)';

// ——— hue-driven (per-Pokémon accent) ———

export function hueBleed(hue: number): ViewStyle {
  return { backgroundImage: `radial-gradient(circle, hsla(${hue},80%,55%,.18), transparent 70%)` };
}

export function hueHeroBleed(hue: number): ViewStyle {
  return {
    backgroundImage: `radial-gradient(ellipse at 70% 0%, hsla(${hue},80%,55%,.22), transparent 60%)`,
  };
}

export function hueDiscBg(hue: number): ViewStyle {
  return {
    backgroundImage: `radial-gradient(circle at 30% 25%, hsla(${hue},80%,68%,.9), hsla(${hue},70%,35%,.9) 60%, hsla(${hue},80%,15%,1))`,
    borderColor: `hsla(${hue},70%,55%,.5)`,
  };
}

export function hueDiscGlow(hue: number, shiny: boolean): ViewStyle {
  return {
    boxShadow: shiny
      ? `0 0 18px hsla(${hue},90%,65%,.45), inset 0 0 20px hsla(${hue},80%,55%,.35)`
      : `inset 0 0 24px hsla(${hue},50%,35%,.5)`,
  };
}

export function hueChipBg(hue: number): ViewStyle {
  return {
    backgroundImage: `linear-gradient(140deg, hsla(${hue},70%,45%,.9), hsla(${hue},60%,20%,.9))`,
    borderColor: `hsla(${hue},60%,50%,.4)`,
  };
}

export function hueChipGlow(hue: number, shiny: boolean): ViewStyle {
  return {
    boxShadow: shiny
      ? `0 0 14px hsla(${hue},90%,60%,.4), inset 0 1px 0 hsla(${hue},90%,70%,.5)`
      : `inset 0 1px 0 hsla(${hue},80%,60%,.35)`,
  };
}

export function hueSilhouetteBg(hue: number): ViewStyle {
  return { backgroundColor: `hsla(${hue},60%,12%,.85)` };
}

export function hueBadgeStyle(hue: number): ViewStyle {
  return {
    backgroundColor: `hsla(${hue},70%,55%,.14)`,
    borderColor: `hsla(${hue},70%,55%,.3)`,
  };
}

// Solid fills only — avatars need a plain `backgroundColor` that's guaranteed to render on every
// platform, not a gradient (native only paints those via `experimental_backgroundImage`; see
// constants/gradient.ts).
const PARTNER_AVATAR_COLORS = ['#ef4444', '#3b82f6', '#10b981', '#8b5cf6', '#f59e0b'];

export function partnerAvatarGradient(partner: string): ViewStyle {
  const c0 = partner.charCodeAt(0);
  const c1 = partner.charCodeAt(1);
  // charCodeAt returns NaN (not undefined) past the string's end, so `??` never
  // catches a single-character name — fall back to c0 explicitly instead.
  const index = (c0 + (Number.isNaN(c1) ? c0 : c1)) % PARTNER_AVATAR_COLORS.length;
  return { backgroundColor: PARTNER_AVATAR_COLORS[index] };
}
