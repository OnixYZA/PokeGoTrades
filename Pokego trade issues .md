Read `AGENTS.md` and `CLAUDE.md` first and follow all project rules.

## Context & Goal (Task 3 of 3: Fix Mobile-Web Proof Image Upload `NotFoundError`)
On Android Chrome mobile web (`https://pokegotrades-ivory.vercel.app`), when a user picks 1–3 proof screenshots in Step 1 of `CreateListingModal`, fills out the form (species, CP, location, tags), advances to Step 2 (Preview), and taps Publish, the upload fails with:
> `A requested file or directory could not be found at the time an operation was processed.`

### Root Cause
In `lib/proof-image.ts`:
- `pickProofImage()` calls `ImagePicker.launchImageLibraryAsync(...)` and returns `{ uri, filename, contentType, sizeBytes, webFile: asset.file }` without reading the underlying bytes.
- Minutes later, on Step 2 (`publish()` in `components/modals/CreateListingModal.tsx`), `readProofBytes(proof)` calls `await blob.arrayBuffer()` on `proof.webFile` (or `await (await fetch(proof.uri)).blob()`).
- On Android Chrome, the `File` / `content://` handle backing `<input type="file">` is lazily read from the Android content provider and frequently expires or gets garbage-collected once the file picker closes and the user interacts with the rest of the form, causing `blob.arrayBuffer()` to throw DOM `NotFoundError: A requested file or directory could not be found at the time an operation was processed.`

## Required Changes

### 1. Eagerly Read & Cache Proof Bytes at Pick Time on Web (`lib/proof-image.ts`)
- Add `bytes?: ArrayBuffer;` to `PickedProof`:
  ```ts
  export interface PickedProof {
    uri: string;
    filename: string;
    contentType: ProofMimeType;
    sizeBytes: number | null;
    webFile?: Blob;
    bytes?: ArrayBuffer;
  }
  ```
- In `pickProofImage()`:
  - When `Platform.OS === 'web'`:
    1. Immediately read the file bytes while the `<input type="file">` selection is still fresh:
       - Prefer `await asset.file.arrayBuffer()` if `asset.file` is present; otherwise `await (await fetch(asset.uri)).arrayBuffer()`.
       - Wrap any read failure (such as DOM `NotFoundError` / `"could not be found"`) in a clear `ProofImageError('Could not read that photo from your device. Please re-select the screenshot.')`.
    2. Validate `rawBytes.byteLength > PROOF_MAX_BYTES` right away and throw `ProofImageError(\`That image is \${formatBytes(rawBytes.byteLength)}. The limit is 5 MB.\`)`.
    3. Sniff magic bytes right away via `sniffImageMime(rawBytes)`. If `null`, throw `ProofImageError('That file is not a JPEG, PNG or WebP image.')`.
    4. Return `{ uri: asset.uri, filename, contentType: sniffed, sizeBytes: rawBytes.byteLength, webFile: asset.file, bytes: rawBytes }`.
- In `readProofBytes(proof: PickedProof)`:
  - If `proof.bytes` is already present (regardless of platform, or on web), use `data = proof.bytes` directly without touching `proof.webFile` or `fetch(proof.uri)`.
  - Still run the `data.byteLength > PROOF_MAX_BYTES` and `sniffImageMime(data)` checks on `data` so `readProofBytes` maintains its safety invariants even if called directly in tests.
  - In the fallback branch where `proof.bytes` is not present (e.g. native `new File(proof.uri).arrayBuffer()` or legacy callers without `bytes`), catch DOM `NotFoundError` (or any error whose `name === 'NotFoundError'` or message matches `/could not be found/i`) and throw `new ProofImageError('Could not read that photo from your device. Please remove it and pick the screenshot again.')`.

### 2. Verify `CreateListingModal.tsx` Error Recovery (`components/modals/CreateListingModal.tsx`)
- Inspect `addProof()` and `publish()` in `components/modals/CreateListingModal.tsx`:
  - Ensure that if `pickProofImage()` throws a `ProofImageError` (e.g. > 5 MB, unsupported format, or unreadable file), `addProof()` surfaces `e.message` cleanly via `setPublishError(e.message)` (or the form's error banner) as it already does.
  - Ensure that once a proof slot has succeeded (`status: 'ready'`), retrying `publish()` for another slot does not re-upload already `'ready'` slots (verify existing behavior remains intact).

### 3. Unit Tests (`lib/proof-image.test.ts`)
- Create `lib/proof-image.test.ts` testing:
  1. `sniffImageMime`: detects valid JPEG (`FF D8 FF`), PNG (`89 50 4E 47 0D 0A 1A 0A`), and WebP (`RIFF....WEBP`) headers, and returns `null` for truncated/unknown bytes.
  2. `readProofBytes` with pre-cached `proof.bytes`: returns `{ data, contentType }` even when `proof.webFile.arrayBuffer()` is a mock that rejects with `new DOMException('A requested file or directory could not be found at the time an operation was processed.', 'NotFoundError')`.
  3. `readProofBytes` size & MIME validation: throws `ProofImageError` when `proof.bytes` exceeds `PROOF_MAX_BYTES` (5 MB) or has non-image magic bytes.
  4. `readProofBytes` fallback when `proof.bytes` is undefined and `webFile.arrayBuffer()` throws `NotFoundError`: converts it into a user-friendly `ProofImageError`.

## Delegation & Verification Workflow
1. Spawn an `implementer` Gemini 4 hydrogen agent to implement the changes in `lib/proof-image.ts` (and `components/modals/CreateListingModal.tsx` if needed) and add `lib/proof-image.test.ts`.
2. Spawn a separate `verifier` Gemini 4 hydrogen agent to review the diff, run `npx tsc --noEmit` and `npx vitest run`, and verify all requirements pass.