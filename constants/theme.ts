/**
 * Style values NativeWind can't express as static utility classes: gradients, glows, and
 * anything driven by a per-Pokémon `hue`. React Native's New Architecture accepts these as
 * literal CSS strings via the `boxShadow` / `backgroundImage` style props, so they port
 * directly from the handoff instead of being approximated.
 */
import type { ViewStyle } from 'react-native';

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

export const FRIENDSHIP_LEVELS = [
  { label: 'Good', mult: 1, color: COLORS.textMuted },
  { label: 'Great', mult: 0.2, color: '#7fd4ff' },
  { label: 'Ultra', mult: 0.02, color: COLORS.accentViolet },
  { label: 'Best', mult: 0.005, color: COLORS.accentGold },
] as const;

export type FriendshipLabel = (typeof FRIENDSHIP_LEVELS)[number]['label'];

// ——— static surfaces ———

export const SURFACE: Record<string, ViewStyle> = {
  card: {
    backgroundImage: 'linear-gradient(180deg, #0f1524 0%, #0b1120 100%)',
  },
  control: {
    backgroundImage: 'linear-gradient(180deg, #101728, #0b1120)',
  },
  stardustCard: {
    backgroundImage: 'linear-gradient(180deg, #0f1524 0%, #0a0f1c 100%)',
  },
  ctaBlue: {
    backgroundImage: 'linear-gradient(180deg, #4fb3ff 0%, #2a8ed6 100%)',
    boxShadow: '0 0 24px rgba(79,179,255,.35), inset 0 1px 0 rgba(255,255,255,.4)',
  },
  ctaBlueSmall: {
    backgroundImage: 'linear-gradient(180deg, #4fb3ff 0%, #2a8ed6 100%)',
    boxShadow: '0 0 20px rgba(79,179,255,.35)',
  },
  ctaGold: {
    backgroundImage: 'linear-gradient(180deg, #f5c518 0%, #c99b0a 100%)',
    boxShadow: '0 0 20px rgba(245,197,24,.35)',
  },
  bubbleMe: {
    backgroundImage: 'linear-gradient(180deg, #4fb3ff 0%, #2a8ed6 100%)',
  },
  avatarHero: {
    backgroundImage: 'linear-gradient(135deg, #4fb3ff, #2a4a80)',
    boxShadow: '0 0 26px rgba(79,179,255,.35)',
  },
  lockedBanner: {
    backgroundImage: 'linear-gradient(90deg, rgba(245,197,24,.12), rgba(245,197,24,.04))',
  },
  ctaFade: {
    backgroundImage: 'linear-gradient(180deg, transparent, #0a0f1c 30%)',
  },
  profileHero: {
    backgroundImage:
      'radial-gradient(ellipse at 20% 0%, rgba(79,179,255,.18), transparent 65%), linear-gradient(180deg, #0f1524, #0a0f1c)',
  },
  divider: {
    backgroundImage: 'linear-gradient(90deg, #1e2436, transparent)',
  },
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

export function partnerAvatarGradient(partner: string): ViewStyle {
  const a = partner.charCodeAt(0) * 7 % 360;
  const b = (partner.charCodeAt(1) ?? partner.charCodeAt(0)) * 11 % 360;
  return { backgroundImage: `linear-gradient(135deg, hsl(${a}, 55%, 45%), hsl(${b}, 55%, 25%))` };
}
