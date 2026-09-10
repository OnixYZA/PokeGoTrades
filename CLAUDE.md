@AGENTS.md
# PokeGoTrades - Architecture & Onboarding

## WHAT & WHY
PokeGoTrades is a mobile-first, proximity-based trading marketplace for Pokémon GO players. The goal is to provide a safe, OLX-style negotiation hub with a strict UI aesthetic (dark mode slate/zinc with neon gaming accents).

## HOW (Tech Stack & Commands)
*   **Framework:** React Native (Expo) using Expo Router for navigation `app/(tabs)`.
*   **Styling:** NativeWind (Tailwind for React Native) and `lucide-react-native` for icons.
*   **State Management:** Global state handled in `store/trade-store.tsx`.
*   **Run Command:** Use `npx expo start` to test locally. 
*   **Linting:** Rely on the project's Prettier/ESLint configs for styling; do not manually reformat code unless fixing a break.

## PROJECT MAP (Progressive Disclosure)
When working on specific features, refer to these authoritative files first:
*   **UI Components:** See `components/ui/` for atomic elements like badges and buttons.
*   **Modals:** All interactive overlays live in `components/modals/`.
*   **Game Data:** Reference `constants/pokedex.ts` and `data/types.ts` for strictly enforced game logic (e.g., Stardust trade costs, forbidden Shadow trades).