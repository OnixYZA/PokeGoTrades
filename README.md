# PokéGo Trade Hub ⚡

A high-performance, cyber-aesthetic Pokémon GO Trading Marketplace mobile application built with **Expo SDK 57**, **React Native 0.86 (New Architecture)**, **NativeWind v4 (Tailwind CSS)**, and **Expo Router**.

Designed for local Pokémon GO trainers to safely discover, negotiate, and execute in-person trades with proximity sorting, stardust cost calculation, and parallel offer locking.

---

## ✨ Features

### 1. 📍 Feed Tab (`/`)
- **Proximity-Sorted Listings**: Browse available Pokémon sorted by nearest distance in your neighborhood.
- **Location Selector**: Filter listings across local zones (e.g., *Adyar*, *East Tambaram*, *Velachery*, *T. Nagar*, *Anna Nagar*, *Besant Nagar*).
- **Live Stats Strip**: Real-time counter of available, Lucky-eligible, and Shiny Pokémon.
- **Dynamic Listing Cards**:
  - Official PokéAPI high-res artwork with form-specific assets (Crowned Zacian, Primal Groudon, Origin Palkia, Mega Rayquaza, Deoxys Attack Forme).
  - Hue-tinted ambient glow rings reflecting Pokémon elemental palettes.
  - Interactive badges for **Lucky**, **Meta / Legacy Backgrounds**, and **Shiny (✦)** status.
  - Quick glance at distance, IV spreads, and seller reputation.

### 2. 🔍 Listing Detail Sheet (`/listing/[id]`)
- **Fluid Gesture-Driven Bottom Sheet**: Smooth slide-up transition powered by **React Native Reanimated** and drag-to-dismiss via **React Native Gesture Handler**.
- **Hero Artwork**: Large ambient hero showcase with custom backdrop gradients.
- **Combat & Rarity Badges**: PvP Rank badges (S+, S, A), Community Demand index, and IV distribution.
- **Dynamic Stardust Cost Calculator**:
  - Interactive friendship tier selector (**Good**, **Great**, **Ultra**, **Best Friend**).
  - Automatically calculates standard and discounted trading stardust costs based on Pokémon rarity (Special Trade / Shiny / Legendary).
- **"Looking For" Wishlist**: Breakdown of Pokémon accepted by the seller with 1-to-1 match criteria.
- **Quick Action Bar**: Meetup zone map shortcut and direct "Make Offer" routing.

### 3. 💬 Chats & Parallel Negotiations (`/chats`, `/chats/[chatId]`)
- **Grouped Inbox**: Organizes active buyer inquiries under their respective listing.
- **Parallel Offer Dims & Locks**: Accepting and locking a trade with a buyer instantly dims competing offers, tagging the listing as `LOCKED` to prevent double-commitments.
- **Real-Time Thread View**: Message bubbles, timestamps, and active negotiation flow.
- **Formal Offer Cards**: Inline preview of the offered Pokémon, IV rating, and legacy moves.
- **Safety First Actions**: Quick "Bail & Block" and trade unlock request mechanisms.

### 4. 👤 Trainer Profile (`/profile`)
- **Trainer Identification**: In-game handle, Trainer Code (`2841 · 9903 · 7715`), Level 47 Mystic status.
- **Reputation & Badges**: 4.9★ rating, trade streak counter, and total verified trade completions.
- **Safe Meet Zone**: Transparent safety policies (daylight-only trades, public meeting spots like university gates and police station public zones).
- **Arsenal Showcase**: Displays the trainer's top showcase Pokémon available for high-tier swaps.
- **Wishlist Grid**: Visual tracker of priority targets sought by the trainer.

---

## 🛠 Tech Stack & Architecture

- **Framework**: [Expo SDK 57](https://docs.expo.dev/versions/v57.0.0/) with Expo Router (File-based navigation)
- **Runtime**: React Native 0.86 (React 19.2) with New Architecture
- **Styling**: [NativeWind v4](https://www.nativewind.dev/) (Tailwind CSS v3.4 integration) + Custom CSS gradients & shadows
- **Gestures & Animations**: `react-native-reanimated` 4.5 & `react-native-gesture-handler` 2.32
- **Typography**: `@expo-google-fonts/space-grotesk` & `@expo-google-fonts/jetbrains-mono`
- **Icons**: `lucide-react-native`
- **State Management**: React Context (`TradeStoreProvider`) for friendship tier calculation, location filtering, and persistent trade lock status
- **Sprites & Artwork**: Official Pokémon Artwork via PokéAPI

---

## 📁 Project Structure

```
PokeGoTrades/
├── app/                        # Expo Router file-based routes
│   ├── _layout.tsx             # Root layout: font loading, splash screen, providers
│   ├── +not-found.tsx          # 404 handler
│   ├── (tabs)/                 # Tab navigator
│   │   ├── _layout.tsx         # Bottom tab bar with dark blur effect
│   │   ├── index.tsx           # Feed Screen (Listings & proximity filters)
│   │   ├── profile.tsx         # Trainer Profile & Safe Meet Zone
│   │   └── chats/              # Chat inbox & individual thread routes
│   │       ├── index.tsx       # Inbox screen (Grouped parallel offers)
│   │       └── [chatId].tsx    # Active chat conversation & formal offer
│   └── listing/
│       └── [id].tsx            # Gesture-dismissible listing detail modal
├── components/                 # Reusable UI components
│   ├── chats/                  # Chat rows, bubbles, composer, lock banner
│   ├── feed/                   # Listing cards, location dropdowns
│   ├── layout/                 # PhoneFrame container, TabBar buttons
│   ├── listing/                # Stardust calculator card, Looking-for rows
│   ├── profile/                # Profile hero, Arsenal grid, Wishlist grid
│   └── ui/                     # Badges, Sprite rendering, PrimaryButton, StatTile
├── constants/                  # Theme tokens, pokedex metadata, colors
├── data/                       # Mock data (listings, chats, trainer profile)
├── store/                      # React Context TradeStore (locks, filters)
└── tailwind.config.js          # Tailwind theme configuration
```

---

## 🚀 Getting Started

### Prerequisites

- **Node.js**: `v20.x` or higher (`v22` / `v24` supported)
- **npm** or **yarn**
- **Expo Go** mobile app (iOS/Android) or simulator/web browser

### Installation

1. Clone the repository and navigate into the folder:
   ```bash
   cd PokeGoTrades
   ```

2. Install dependencies:
   ```bash
   npm install
   ```

### Running Locally

Start the Expo development server:

```bash
npm run start
```

Or target specific platforms:

- **Web Browser**:
  ```bash
  npm run web
  ```
- **iOS Simulator**:
  ```bash
  npm run ios
  ```
- **Android Emulator**:
  ```bash
  npm run android
  ```

Once running, press `w` in the terminal to open in your browser, or scan the QR code using the **Expo Go** app on your physical device.

---

## 🛡 Safe Trading Guidelines

This app incorporates built-in safety prompts:
1. **Public Daylight Meetups**: All trade negotiations recommend vetted public locations.
2. **Trade Locking**: Once terms are agreed upon, locking the trade protects both trainers against sudden cancellations or snipe offers.
3. **Stardust Transparency**: Live stardust calculations avoid failed in-person trades due to insufficient resources.

---

## 📄 License

This project is licensed under the MIT License. See [LICENSE](LICENSE) for details.
