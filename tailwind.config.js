/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ['./app/**/*.{js,jsx,ts,tsx}', './components/**/*.{js,jsx,ts,tsx}'],
  presets: [require('nativewind/preset')],
  theme: {
    extend: {
      colors: {
        bg: {
          base: '#050810',
          canvas: '#080b14',
          panel: '#0a0f1c',
          card: '#0f1524',
          cardAlt: '#101728',
          cardBottom: '#0b1120',
        },
        border: {
          DEFAULT: '#1a2032',
          strong: '#1e2436',
          subtle: '#151b2a',
          dashed: '#2a3350',
        },
        text: {
          primary: '#e8ecf5',
          body: '#c5cad9',
          muted: '#8b93a7',
          // Lifted from the handoff's #6d7690 (~3.9:1 on card/panel backgrounds, under WCAG AA's
          // 4.5:1 for normal text) to #7d87a0 (~5.1:1) — same hue, same role, just legible.
          subtle: '#7d87a0',
          faint: '#4a5169',
        },
        accent: {
          blue: '#4fb3ff',
          blueDark: '#2a8ed6',
          gold: '#f5c518',
          goldDark: '#c99b0a',
          goldDeep: '#2a1e02',
          pink: '#ff6bd6',
          danger: '#ff5c8a',
          green: '#7dffb3',
          violet: '#c9a6ff',
        },
      },
      fontFamily: {
        'display-med': ['SpaceGrotesk_500Medium'],
        'display-semi': ['SpaceGrotesk_600SemiBold'],
        display: ['SpaceGrotesk_700Bold'],
        mono: ['JetBrainsMono_500Medium'],
        'mono-semi': ['JetBrainsMono_600SemiBold'],
      },
    },
  },
  plugins: [],
};
