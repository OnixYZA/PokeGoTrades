# Expo HAS CHANGED

Read the exact versioned docs at https://docs.expo.dev/versions/v57.0.0/ before writing any code.
# Agent Rules & Gotchas for PokeGoTrades

## CORE DIRECTIVES
*   **Mobile Constraints:** Always wrap main layouts in the mobile constraint classes (`max-w-md mx-auto h-screen`) to maintain the app feel on web previews.
*   **No Fictional APIs:** Do not attempt to hit official Niantic servers or `db.pokemongohub.net`. We rely strictly on internal mock data `data/listings.ts` and OCR uploads for verification.

## RECURRING MISTAKES TO AVOID
*   **Stardust Math:** Never hallucinate Stardust costs. Always strictly compute trade costs based on the matrix in `data/types.ts`. Unregistered Shinies cost 1,000,000 dust at the base level.
*   **File Modifying:** When updating state logic in `store/trade-store.tsx`, you must immediately check and update `components/chats/` to ensure the UI reflects the locked/bailed states. 

## SUB-AGENT DELEGATION
*   If instructed to write Python/Node scripts for the OCR image processing pipeline, create a temporary isolated workspace rather than polluting the Expo React Native directories.