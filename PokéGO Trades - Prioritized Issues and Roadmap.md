# **PokéGO Trades — Issues & Feature Roadmap Specification**

# **Executive Summary & Priority Matrix**

This document outlines the triage, prioritization, and technical specifications for resolving current application bugs and implementing pending feature requests across the PokéGO Trades platform. Priorities are assigned based on transactional criticality, data integrity, user safety, and UX polish.

| Tier | Priority Level | Focus Area | Included Issues |
| :---- | :---- | :---- | :---- |
| **P0** | Critical Blockers | Transactional flows & inventory state integrity | Chat formal offer negotiation flow, Inventory & Wishlist deletion mutability |
| **P1** | High Impact | Core data accuracy & primary discovery features | Missing dual-type Pokémon data, Combat Power (CP) & catch attributes, Inactive feed search bar, Tradable form variants & Crowned form architecture (8.5/10) |
| **P2** | Medium Priority | Visual bug fixes & user privacy protection | Duplicate 'Shiny Shiny' label display, Sparkle badge collision, Vicinity-based geolocation fuzzing |
| **P3** | Feature Enhancements | Meta systems & extended Pokémon forms | Central Pokédex explorer & tier rankings, User trade reputation & anti-bail system, Gigantamax (G-Max) form integration |

# **P0: Critical Blockers (Trade Execution & Inventory Integrity)**

## **1\. Chat Formal Offer Selection & Negotiation Logic (Problem 6\)**

* **Problem Description:** During trade negotiations in chat threads, when multiple formal offers are exchanged between buyer and seller, the system only allows accepting the latest offer. Users cannot navigate backward to accept an earlier offer, and there is no preview step prior to trade commitment.  
* **Impact:** Causes negotiation deadlocks, unintended offer acceptances, and potential state corruption in trade agreements.  
* **Expected Outcome:**  
  * Each formal offer card rendered in the chat timeline remains individually selectable if not superseded or explicitly withdrawn.  
  * Tapping any valid offer opens a Trade Summary Preview Modal presenting the exact trade terms (Offered Pokémon vs. Requested Pokémon, level, IVs, stardust cost, and meetup logistics).  
  * Both parties must confirm via the preview modal before triggering the trade lock state.  
* **Key Affected Files:** `app/(tabs)/chats/[chatId].tsx`, `components/chats/FormalOfferCard.tsx`, `components/modals/HandshakeModal.tsx`, `lib/api/chats.ts`

## **2\. Deletion / Removal from Arsenal & Wishlist (Problem 10\)**

* **Problem Description:** Users can add Pokémon to their Arsenal (inventory) and Wishlist, but deletion and removal functionality is non-functional or missing.  
* **Impact:** Inventory staleness and state pollution; users continue receiving trade requests for Pokémon they no longer possess.  
* **Expected Outcome:**  
  * Provide an intuitive deletion action (delete icon on card/long-press menu) for individual items in both Arsenal and Wishlist grids.  
  * Implement optimistic UI updates with immediate synchronization to Supabase via deletion endpoints.  
* **Key Affected Files:** `components/profile/ArsenalGrid.tsx`, `components/profile/WishlistGrid.tsx`, `lib/api/profile.ts`

# **P1: High Impact (Search, Filtering & Pokémon Attributes)**

## **3\. Missing Dual-Type Pokémon Support (Problem 7\)**

* **Problem Description:** Pokémon are currently rendered as monotype entities. Dual-type species only display their primary typing (e.g., Crowned Sword Zacian displays Steel only, omitting Fairy; Charizard displays Fire only, omitting Flying).  
* **Impact:** Broken elemental search filtering, inaccurate community trade calculations, and poor user trust.  
* **Expected Outcome:**  
  * Update data schemas so Pokémon support an array of elemental types (`types: [PokemonType, PokemonType?]`).  
  * Render both type badges across feed cards, search listings, and detail pages.  
  * Enhance feed filters to allow filtering by either primary or secondary type.  
* **Key Affected Files:** `constants/pokedex-data.ts`, `constants/pokedex.ts`, `components/feed/ListingCard.tsx`, `components/modals/ListingFilterSheet.tsx`

## **4\. Mandatory Combat Power (CP) & Catch Attributes (Problem 5\)**

* **Problem Description:** Trade listings omit CP (Combat Power), size/weight variations (XXS, XS, XL, XXL), and the Pokéball type caught in.  
* **Impact:** In Pokémon GO, CP determines PvP league eligibility (Great League under 1500 CP, Ultra League under 2500 CP). Missing CP forces users into manual inquiries in chat.  
* **Expected Outcome:**  
  * Make CP a required numeric field during listing creation and display it prominently on listing cards and previews.  
  * Add optional selectors for size categories (XXS through XXL) and Pokéball variants (Premier Ball, Beast Ball, Master Ball, Ultra Ball, etc.).  
* **Key Affected Files:** `components/modals/CreateListingModal.tsx`, `components/feed/ListingCard.tsx`, `app/listing/[id].tsx`

## **5\. Inactive Main Page Header Search Bar (Problem 1\)**

* **Problem Description:** The search icon/button in the top header on the main trade feed is static and unresponsive.  
* **Impact:** Prevents users from querying specific Pokémon directly, forcing slow manual scrolling through the geolocation feed.  
* **Expected Outcome:**  
  * Tapping the search icon opens an interactive search interface with real-time autocompletion.  
  * Support query matching by Pokédex number, Pokémon name, and elemental typing.  
  * Default results sorted by Pokédex number, accompanied by quick-filter chips for trending searches.  
* **Key Affected Files:** `app/(tabs)/index.tsx`, `components/feed/ListingFilterSheet.tsx`, `store/listing-filters.ts`

## **6\. Tradable Form Variants & Crowned Form Query Optimization (Problem 12 \- Criticality Score: 8.5/10 \- P1)**

* **Problem Description:** There is currently no mechanism to list, select, or preview Crowned forms (such as Crowned Sword Zacian and Crowned Shield Zamazenta) along with other specific tradable Pokémon form variants (e.g., Origin forms, Therian forms, Kyurem/Necrozma fusions, Rotom forms). In addition, fetching forms requires fragmented requests that bloat network calls.  
* **Impact:** High-value flagship trades cannot be accurately initiated or previewed in the trade hub; users cannot differentiate base Hero of Many Battles forms from Crowned forms, leading to misaligned trade commitments and unnecessary database load.  
* **Expected Outcome:**  
  * **Architecture / DB Optimization:** Implement a single, batched database query / RPC endpoint that fetches the complete form catalog alongside the base creature reference in a single request, eliminating multi-roundtrip waterfall lookups.  
  * **UI / Form Picker:** In the Pokémon listing creation modal and feed preview cards, provide a dedicated 'Form' selector / chip group when a multi-form species is selected.  
  * **Visual Assets & Sprites:** Render accurate form-specific 3D sprites/models and metadata badges (e.g., 'Crowned Sword', 'Crowned Shield') across cards, listing previews, and chat offer cards.  
* **Key Affected Files:** `components/modals/CreateListingModal.tsx`, `components/feed/ListingCard.tsx`, `constants/pokedex-data.ts`, `lib/api/creature-ref.ts`, `lib/api/listings.ts`, `supabase/migrations/*_creature_form_codes.sql`

# **P2: Medium Priority (UI Polish & User Privacy)**

## **7\. Duplicate 'Shiny Shiny' Text Label Bug (Problem 3\)**

* **Problem Description:** On the listing details screen under 'Looking For', shiny Pokémon render duplicate 'Shiny' prefixes (e.g., 'Shiny Shiny Kyogre').  
* **Impact:** Visually unprofessional bug indicating broken string formatting logic.  
* **Expected Outcome:**  
  * Ensure title formatting functions check whether a Pokémon's raw name or shiny attribute already contains the prefix, ensuring only a single 'Shiny ' is displayed.  
* **Key Affected Files:** `components/listing/LookingForRow.tsx`, `lib/format.ts`, `app/listing/[id].tsx`

## **8\. Badge Icon Collision Between 'Shiny' and 'NEW' (Problem 4\)**

* **Problem Description:** The badge indicator for 'NEW' listings uses the identical 4-point sparkle icon used for shiny Pokémon, leading users to mistake regular listings for shiny variants.  
* **Impact:** Misleading visual cues in high-stakes trading.  
* **Expected Outcome:**  
  * Reserve the sparkle glint icon strictly for shiny Pokémon with gold/magenta accenting.  
  * Update the 'NEW' badge to a clean textual pill badge or clock/pulse indicator without sparkle glyphs.  
* **Key Affected Files:** `components/feed/ListingCard.tsx`, `components/ui/TextBadge.tsx`

## **9\. Vicinity & Geolocation Privacy Fuzzing (Problem 9\)**

* **Problem Description:** Exact GPS coordinate exposure could compromise trainer physical safety during local physical trade arrangements.  
* **Impact:** Privacy and safety concerns during in-person meetups.  
* **Expected Outcome:**  
  * Implement reverse geocoding neighborhood bucketing so listings only display locality or neighborhood vicinity (e.g., 'East Tambaram', 'Adyar') rather than exact coordinates.  
* **Key Affected Files:** `components/feed/LocationDropdown.tsx`, `lib/api/listings.ts`

# **P3: Feature Enhancements & Advanced Mechanics**

## **10\. Central Pokédex Explorer & Meta Rankings (Problem 2\)**

* **Problem Description:** The application currently lacks a Pokédex preview section where users can inspect base stats, PvP/PvE rankings, and trade values.  
* **Expected Outcome:**  
  * Build a dedicated Pokédex explorer tab/page with comprehensive search and filtering.  
  * Display base stats, competitive tier rankings (PvE Raid Attacker, Great League, Ultra League, Master League), and community trade demand.  
* **Key Affected Files:** `app/dex/index.tsx`, `constants/pokedex-data.ts`, `lib/api/market.ts`

## **11\. Trader Reputation & Anti-Bail System (Problem 8\)**

* **Problem Description:** Reputation points and trade cancellation protections are unbuilt.  
* **Expected Outcome:**  
  * Formulate a clear trust rating model: successfully completed trades increment trust scores, while verified cancellations or no-shows impose penalties.  
  * Provide grace periods and protection mechanisms for legitimate cancellations.  
* **Key Affected Files:** `components/profile/RepStats.tsx`, `components/modals/BailBlockModal.tsx`

## **12\. Gigantamax (G-Max) Form Support (Problem 11\)**

* **Problem Description:** Database records include Gigantamax forms, but listing creation, badges, and preview screens do not support selecting or displaying G-Max forms.  
* **Expected Outcome:**  
  * Add `is_gigantamax` toggle and form support to listing creation and filtering.  
  * Display the official red Gigantamax symbol on preview cards and detail headers.  
* **Key Affected Files:** `constants/listing-attributes.ts`, `components/modals/CreateListingModal.tsx`, `components/feed/ListingCard.tsx`

# **Recommended Sprint Implementation Roadmap**

## **Sprint 1: Core Trade Safety & Data Mutations**

1. Chat formal offer selection & trade preview modal (P0)  
2. Arsenal & Wishlist item deletion and optimistic sync (P0)  
3. Dual-type Pokémon schema update & badge rendering (P1)  
4. Fix duplicate 'Shiny Shiny' label & badge icon conflict (P2)

## **Sprint 2: Listing Discovery, Privacy & Form Architecture**

1. Mandatory CP field, size/weight, and Pokéball selector (P1)  
2. Interactive header search bar with autocomplete (P1)  
3. Geolocation vicinity fuzzing & neighborhood bucketing (P2)  
4. Tradable form variants & single DB call optimization for Crowned forms (P1 \- 8.5/10)

## **Sprint 3: Meta Exploration & Form Expansions**

1. Gigantamax form flags, filters, and badge indicators (P3)  
2. Pokédex explorer page with PvP/PvE tier rankings (P3)  
3. User reputation scoring and trade confirmation safeguards (P3)

