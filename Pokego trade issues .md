# PokéGO Trades — Issues Prioritization & Technical Remediation Plan

This document restructures and prioritizes application bugs, security hardening, and pending feature requirements based on operational criticality, state integrity, trade execution safety, and visual polish, mapped directly against the codebase implementation.

## Issue Prioritization Matrix

| Priority Tier | Issue | Risk & Impact | Primary Files Involved |
| :---- | :---- | :---- | :---- |
| **P0 — Critical Blocker** | Trade Preview Modal Close Button Unresponsive | UI/Navigation soft-lock preventing trade navigation and dismissals | app/listing/\[id\].tsx, components/modals/HandshakeModal.tsx, components/listing/LookingForRow.tsx |
| **P0 — Critical Security** | Application & Backend Security Hardening (RLS, OCR Auth & Rate Limiting) | Unauthorized data mutation, spoofing of OCR proofs, API abuse, and token exposure | supabase/migrations/20260916000400\_grants\_rls.sql, workers/azure-ocr/src/core/auth.ts, lib/auth.ts, lib/supabase.ts |
| **P1 — High Risk** | Flexible Availability-Based Location Selection (Home, Current GPS, or Any Custom Zone) & Vicinity Fuzzing | Severe market lock-in; blocks non-Chennai users, prevents trainers from listing/browsing based on their travel or meetup availability (Home, Current GPS, or Custom), and risks physical privacy | components/feed/LocationDropdown.tsx, components/modals/CreateListingModal.tsx, components/profile/SafeMeetZone.tsx, lib/api/listings.ts, supabase/migrations/20260916000200\_tables.sql |
| **P1 — High Risk** | Conditional Toggle for Zacian & Zamazenta Crowned Forms | Inability to distinguish Hero of Many Battles vs. Crowned Sword/Shield forms during listing | components/modals/CreateListingModal.tsx, constants/pokedex-data.ts, lib/api/creature-ref.ts, supabase/migrations/20260927000500\_creature\_form\_codes.sql |
| **P1 — High Risk** | Dynamax (D-Max) Integration & G-Max Symbol Alignment | Missing meta battle form coverage for 2026 Wild Area event | constants/listing-attributes.ts, components/modals/CreateListingModal.tsx, components/feed/ListingCard.tsx, constants/pokedex-data.ts |
| **P2 — Medium Risk** | Current Listing Management & Dynamax Toggle Controls | Inventory staleness, orphaned active feed entries, and missing Dynamax toggle in listing controls | lib/api/listings.ts, components/modals/CreateListingModal.tsx, app/listing/\[id\].tsx, supabase/migrations/20260916000500\_rpcs.sql |
| **P3 — Low Risk / Polish** | Onboarding Guide & Reputation System Tutorial | User friction during trade onboarding and rating comprehension | app/onboarding.tsx, components/profile/RepStats.tsx, components/modals/BailBlockModal.tsx |

## P0: Critical Blockers & Security (Immediate Hotfix)

### 1\. Close Button Unresponsive on Listing & Trade Preview

* **Risk Level:** Critical (P0) — Blocks user navigation and causes modal lockups.  
* **Problem:** When previewing listed trades or opening the listing details modal (app/listing/\[id\].tsx), the top-right close (✕) button fails to dismiss the view or navigate back to the previous feed state.  
* **Technical Root Cause:** Missing or decoupled router.back() / onClose callback bindings on the close icon button, or modal touch handlers being intercepted by full-screen overlay touch absorbers (PhoneFrame.tsx / Modal backdrop).  
* **Expected Outcome:**  
  * Tapping the ✕ button immediately dismisses the modal or navigates back (router.canGoBack() ? router.back() : router.replace('/')).  
  * Safe dismissal handling when gestures/swipes are initiated.  
* **Affected Files:**  
  * app/listing/\[id\].tsx  
  * components/modals/HandshakeModal.tsx  
  * components/modals/BuyerOfferModal.tsx

### 2\. Application & Backend Security Measures

* **Risk Level:** Critical Security (P0) — Protects user accounts, trade integrity, and cloud worker billing.  
* **Problem:** As the platform scales beyond local testing, critical attack vectors—including direct client-side Supabase table manipulation, Azure OCR worker abuse, spoofing of trade lock states, and unvalidated image uploads—must be locked down.  
* **Expected Outcome:**  
  * **Strict Row-Level Security (RLS) & Service Role Isolation:** Audit all tables (listings, chats, messages, trade\_locks, profile\_proofs) to ensure users can only mutate rows where auth.uid() \= user\_id. Restrict sensitive fields (like is\_verified, reputation\_score, and is\_lucky overrides) strictly to service\_role or SECURITY DEFINER RPCs (20260920000200\_lock\_lucky\_to\_service\_role.sql).  
  * **Azure OCR Worker Authentication & Rate Limiting:** Enforce HMAC/Bearer token verification between Supabase webhooks and the Azure Container Apps OCR worker (20260928000100\_ocr\_vault\_auth.sql, workers/azure-ocr/src/core/auth.ts). Add per-user rate limiting on screenshot uploads to prevent Azure Vision API cost exhaustion.  
  * **Private Storage Buckets & Signed URLs:** Keep proof screenshots (listing\_proof\_private, profile\_proofs) in private Supabase Storage buckets with strict MIME-type (image/png, image/jpeg, image/webp) and file-size (\< 5 MB) validation. Serve proofs exclusively via short-lived signed URLs.  
  * **RPC Input Sanitization & State Guards:** Enforce server-side validation on all trade negotiation RPCs (20260916000500\_rpcs.sql) to prevent race conditions, double-spending of Arsenal Pokémon, or accepting withdrawn offers, while strictly blocking untradable species (20260929000100\_enforce\_untradable\_pokemon.sql).  
* **Affected Files:**  
  * supabase/migrations/20260916000400\_grants\_rls.sql  
  * supabase/migrations/20260928000100\_ocr\_vault\_auth.sql  
  * workers/azure-ocr/src/core/auth.ts  
  * lib/auth.ts & lib/supabase.ts

## P1: High Risk (Core Market Expansion, Flagship Forms & Battle Mechanics)

### 3\. Flexible Availability-Based Location Selector & Global Vicinity Fuzzing

* **Risk Level:** High (P1) — Limits platform adoption to Chennai, restricts trainer mobility, and creates physical safety risks without coordinate fuzzing.  
* **Problem:** The app feed and listing creation pipeline currently enforce hardcoded Chennai localities (Adyar, East Tambaram, Velachery). Trainers are locked out of choosing locations based on their real-world availability—for instance, a trainer based in Tambaram who is currently in Puducherry (or planning a trip/meetup elsewhere) needs the freedom to select their **Home Location**, their **Current Live Location**, or **any custom location** where they are available to trade.  
* **Expected Outcome & Technical Logic:**  
  * **Remove Hardcoded Localities:** Strip static Chennai mock arrays from components/feed/LocationDropdown.tsx and data/listings.ts.  
  * **Saved Home & Frequent Availability Zones:** Allow trainers to save a primary **Home Location** (e.g., *East Tambaram*) alongside optional frequent/secondary availability zones in their profile (ProfileForm.tsx and SafeMeetZone.tsx).  
  * **Open / Multi-Option Location Selector (Not Restricted to Dual):** In CreateListingModal.tsx and LocationDropdown.tsx, provide a flexible location picker where trainers can freely choose or switch between:  
    * **1\. Current Live Location (GPS):** Fetches device GPS via expo-location, reverse-geocodes it to a neighborhood/city label (e.g., *Puducherry*), and sets it as the active trade zone.  
    * **2\. Home Location (Saved Base):** One-tap selection of their saved home vicinity (e.g., *Tambaram*) so they can post or browse trades for when they are back home.  
    * **3\. Custom / Availability Search (Any Location):** An open search/autocomplete input allowing trainers to select *any* neighborhood, city, or event zone based on where they will be available to meet and trade.  
  * **Multi-Zone Listing & Availability Tagging:** Allow listers to tag whether the listing is available at their *Current Location*, *Home Base*, or *Both / Custom Availability*, displaying clear vicinity pills on ListingCard.tsx.  
  * **Vicinity Privacy Fuzzing:** Snap all resolved coordinates to a 1–2 km neighborhood/suburb centroid rather than exposing exact street-level GPS pins.  
* **Affected Files:**  
  * components/feed/LocationDropdown.tsx  
  * components/modals/CreateListingModal.tsx  
  * components/profile/SafeMeetZone.tsx  
  * components/onboarding/ProfileForm.tsx  
  * lib/api/listings.ts & store/listing-filters.ts  
  * supabase/migrations/20260916000200\_tables.sql

### 4\. Conditional Toggle Exclusively for Zacian & Zamazenta Crowned Forms

* **Risk Level:** High (P1) — Flagship Legendary trades require accurate form differentiation and typing accuracy without cluttering standard Pokémon listing flows.  
* **Problem:** Currently, there is no way to toggle between the base "Hero of Many Battles" form and the "Crowned Sword" (Zacian) or "Crowned Shield" (Zamazenta) forms when creating or previewing a listing.  
* **Expected Outcome:**  
  * **Conditional UI Toggle:** Inside CreateListingModal.tsx, dynamically render a dedicated Crowned Form Toggle (Hero Form vs. Crowned Sword / Crowned Shield) only when the selected Pokémon species is Zacian (dex\_number \=== 888\) or Zamazenta (dex\_number \=== 889). Keep this toggle hidden for all other Pokémon.  
  * **Single-Call Form Resolution:** Map the toggle state directly to the form code (ZACIAN\_CROWNED\_SWORD, ZAMAZENTA\_CROWNED\_SHIELD) in lib/api/creature-ref.ts so sprite URLs, dual typings (Fairy/Steel and Fighting/Steel), and metadata badges resolve in a single database query.  
* **Affected Files:**  
  * components/modals/CreateListingModal.tsx  
  * components/feed/ListingCard.tsx  
  * constants/pokedex-data.ts  
  * lib/api/creature-ref.ts  
  * supabase/migrations/20260927000500\_creature\_form\_codes.sql

### 5\. Dynamax (D-Max) Form Integration & Gigantamax (G-Max) Symbols

* **Risk Level:** High (P1) — Essential for the 2026 Wild Area event meta.  
* **Problem:** While Gigantamax exists partially in backend definitions, standard Dynamax (D-Max) is completely absent. Traders cannot specify whether a Pokémon is Dynamax-capable or regular, and listing badges lack clear visual indicators for D-Max vs. G-Max.  
* **Expected Outcome:**  
  * **Schema Update:** Add is\_dynamax: boolean alongside is\_gigantamax: boolean in listing schemas and database tables.  
  * **Listing Creation UI:** Provide a toggled battle form selector (Standard \| Dynamax \| Gigantamax) restricted only to species eligible for D-Max/G-Max in Pokémon GO.  
  * **Card Badges:** Render distinct iconography:  
    * **Dynamax (D-Max):** Magenta energy aura / spiral D-Max icon badge.  
    * **Gigantamax (G-Max):** Official red G-Max cross/cloud glyph badge.  
* **Affected Files:**  
  * constants/listing-attributes.ts  
  * components/modals/CreateListingModal.tsx  
  * components/feed/ListingCard.tsx  
  * constants/pokedex-data.ts  
  * supabase/migrations/20260927000100\_listing\_attributes.sql

## P2: Medium Risk (Data Lifecycle & Listing Controls)

### 6\. Active Listing Deletion, Management & Dynamax Toggle Controls (Originally Point 4\)

* **Risk Level:** Medium (P2) — Stale listings and uneditable battle attributes cause buyer frustration and false availability.  
* **Problem:** Trainers currently lack a direct mechanism to edit, cancel, or permanently delete an active trade listing once posted, and the listing configuration/management flow also needs a direct toggle for Dynamax Pokémon.  
* **Expected Outcome:**  
  * **Manage & Delete Actions:** Provide a 'Manage Listing' menu on user-owned listing cards with 'Delete Listing' and 'Mark as Traded' actions. Ensure deletion cascades across pending chat offer proposals referencing the listing ID, gracefully updating chat threads to 'Listing Closed'.  
  * **Dynamax Toggle in Listing Flow:** Include an explicit Dynamax Toggle (is\_dynamax) within the listing creation and listing edit/management controls so trainers can easily flag or update a Pokémon's Dynamax status alongside its active listing state.  
* **Affected Files:**  
  * app/listing/\[id\].tsx  
  * lib/api/listings.ts  
  * components/chats/FormalOfferCard.tsx  
  * supabase/migrations/20260916000500\_rpcs.sql  
  * components/modals/CreateListingModal.tsx

## P3: Low Risk / UX Polish (User Onboarding & Education)

### 7\. In-App Feature Guide & Reputation System Tutorial

* **Risk Level:** Low (P3) — Does not break app functionality, but essential for user retention and trust clarity.  
* **Problem:** Users have no structured walkthrough explaining how trade matching works, what trade locks signify, or how trust/reputation points and bail protections operate.  
* **Expected Outcome:**  
  * Create a modular, dismissible tutorial modal or interactive tooltip walkthrough accessible from Profile / Settings.  
  * Detail core workflows:  
    * 1\. How to create and filter listings (specifying CP, Shiny, Crowned Forms, and D-Max/G-Max).  
    * 2\. Formal Offer exchange and the two-party Handshake lock.  
    * 3\. How Reputation scoring calculates (successful completion \= \+points, bail/no-show \= penalty).  
* **Affected Files:**  
  * app/onboarding.tsx  
  * components/profile/RepStats.tsx  
  * components/modals/BailBlockModal.tsx

## Recommended Implementation Sprint Schedule

### Sprint 1: Critical Blockers, Security Hardening & Listing Lifecycle (Immediate)

1. **Fix Close Button (P0):** Ensure reliable dismiss and navigation bindings on app/listing/\[id\].tsx and HandshakeModal.tsx.  
2. **App & Backend Security Hardening (P0):** Audit RLS policies, enforce Azure OCR webhook auth/rate-limiting, and lock private proof storage buckets.  
3. **Active Listing Deletion & Dynamax Toggle (P2):** Wire up Supabase delete listing RPC, optimistic UI prune, and the Dynamax toggle inside listing controls.

### Sprint 2: Core Expansion, Crowned Forms & Event Mechanics

1. **Flexible Availability-Based Location Selector & Vicinity Fuzzing (P1):** Replace Chennai mock items with open location selection (Home Base, Current Live GPS, or Custom Availability search) backed by 1–2 km vicinity privacy fuzzing.  
2. **Zacian & Zamazenta Crowned Form Toggle (P1):** Add conditional Crowned Sword/Shield toggle in CreateListingModal.tsx backed by single-query form resolution.  
3. **Dynamax & Gigantamax Visual Indicators (P1):** Implement is\_dynamax attribute, form picker, and distinct D-Max / G-Max badge icons.

### Sprint 3: Onboarding & Trust System Education

1. **Feature Walkthrough & Rep System Guide (P3):** Build onboarding slide-outs explaining matching, Stardust calculations, and reputation mechanics.