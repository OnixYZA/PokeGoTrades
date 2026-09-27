/**
 * Two more things an **appraisal** screenshot's OCR text can carry, beside the catch date `date.ts` already
 * reads: the in-game size label (Pokémon GO's XXS/XS/XL/XXL, next to the weight and height) and the catch
 * location (the game prints it right on the "Caught <date>" line). Both are pure text checks, no I/O, no clock
 * — same shape as `date.ts` and the rest of `parser.ts`, and for the same reason: a wrong read is worse than no
 * read, so every rule below is written to prefer returning nothing over guessing.
 *
 * `extractSizeClass`'s result is public (`listings.size_class`, next to `lucky`). `extractCatchLocation`'s
 * result is NOT: a catch location is roughly where the seller plays, so it is only ever written to
 * `public.listing_proof_private` (seller-only readable, migration ...000200_listing_proof_private.sql) and is
 * never put in `listing_proofs.ocr_extracted` (world-readable, like the rest of that column) and never logged
 * (`src/core/log.ts`'s rule already covers it, but callers must still never pass it to `log()`).
 *
 * The Poké Ball a Pokémon was caught in is NOT read here, or anywhere in this worker: the product decision is
 * that it stays seller-declared (`listings.pokeball`), never auto-tagged from a screenshot.
 */

/** Same anchor `date.ts` uses to find the catch date: "Caught" (or tesseract's common misread "Cought"), a
 * whole word. Kept as a non-global, case-insensitive `RegExp` here (rather than imported from `date.ts`, which
 * does not export it) since `.test()` / `.exec()` on a fresh match is all either extraction needs — no shared
 * `lastIndex` state to manage. */
const ANCHOR_LINE = /\bc[ao]ught\b/i;

/**
 * Locates a date shape (D/M/YYYY, whatever order, tesseract's usual separator noise) without validating it as a
 * real calendar date — that job belongs to `date.ts`'s `parseCatchDate` alone, and this file must not duplicate
 * or drift from it. All this needs is WHERE a date-shaped run of characters sits on the anchor line, so the
 * location text can be read from whichever side of it the connector word turns out to be on.
 */
const DATE_SHAPE = /\d{1,2}\s*[/\\|.-]\s*\d{1,2}\s*[/\\|.-]\s*(?:19|20)\d{2}(?!\d)/;

/**
 * A word (or punctuation mark) Pokémon GO's own "Caught ... around/at/in ..." phrasing — and OCR's own
 * middle-dot / dash misreads of it — uses to introduce the catch location. Fenced on both sides by whitespace
 * (or string start/end) rather than `\b`, so the punctuation forms (`·`, `-`) get the same standalone-token
 * treatment the word forms need anyway: a bare `-` glued inside a hyphenated word must never match.
 */
const LOCATION_CONNECTOR = /(?:^|\s)(?:around|at|in|·|-)(?=\s|$)/i;

/** Strips the "on" that glues a leading connector phrase to the date that follows it — "around Paris, France
 * on 3/14/2021" — once the date itself has already been sliced off the end. Never strips "on" from the middle
 * of a location: the pattern only matches a suffix. */
const GLUE_TO_DATE = /\s+on\s*$/i;

/** Reject the result outright if this many digits run together survive un-filtered — a stray year, CP, or
 * Stardust count that leaked in past the connector means the boundary was mis-read, and a truncated guess is
 * worse than none. Checked before punctuation/letter filtering removes the evidence. */
const DIGIT_RUN = /\d{3,}/;

/** Screen chrome that has no business in a place name. If any of these words survive, the "location" is really
 * some other part of the appraisal screen that the connector search wandered into. */
const UI_WORD = /\b(?:weight|height|stardust|candy|cp|hp|type|power\s*up|evolve)\b/i;

/** What a cleaned catch location is allowed to be made of: Unicode letters (so "México", "Zürich" survive),
 * plain whitespace, and the punctuation an OCR'd "City, Country" or "O'Fallon"-style name actually uses. Anything
 * else (digits, the connector's own "·", stray symbols) is dropped rather than kept and hoped to be harmless. */
const DISALLOWED_CHARS = /[^\p{L}\s,'-.]/gu;

/**
 * Finds the raw (unvalidated) location substring on one already-joined line, if the line's shape matches one of
 * the two ways Pokémon GO's own phrasing (and OCR noise on top of it) can place it against the date:
 *
 * - **Connector after the date**: "Caught 11/23/2018 · Adyar", "Caught on 03/14/2021 at Adyar", "...caught on
 *   3/14/2021 around Paris, France." — the location is everything after the connector, which itself comes after
 *   the date.
 * - **Connector before the date**: "caught around Paris, France on 3/14/2021" — the location is between the
 *   connector (which follows "caught" directly) and the "on" that glues it to the date.
 *
 * Returns `undefined` when the line has no date shape at all, or a date shape but no connector on either side of
 * it: nothing anchors a guess, so nothing is guessed at. Not yet cleaned or validated — `cleanLocation` does that.
 */
function rawLocationCandidate(line: string): string | undefined {
  const dateMatch = DATE_SHAPE.exec(line);
  if (!dateMatch) return undefined;

  const afterDate = line.slice((dateMatch.index ?? 0) + dateMatch[0].length);
  const afterConnector = LOCATION_CONNECTOR.exec(afterDate);
  if (afterConnector) {
    return afterDate.slice((afterConnector.index ?? 0) + afterConnector[0].length);
  }

  const beforeDate = line.slice(0, dateMatch.index ?? 0);
  const anchorMatch = ANCHOR_LINE.exec(beforeDate);
  if (!anchorMatch) return undefined;

  const afterAnchor = beforeDate.slice((anchorMatch.index ?? 0) + anchorMatch[0].length);
  const beforeConnector = LOCATION_CONNECTOR.exec(afterAnchor);
  if (!beforeConnector) return undefined;

  const candidate = afterAnchor.slice((beforeConnector.index ?? 0) + beforeConnector[0].length);
  return candidate.replace(GLUE_TO_DATE, '');
}

/**
 * Cleans and validates a raw location candidate, or rejects it outright (returning `undefined`) rather than save
 * a mangled or mis-anchored guess:
 *
 * 1. Strip a trailing '.' (the sentence-ending period in "...around Paris, France.") and collapse whitespace.
 * 2. Reject if a run of 3+ digits, or a UI word, survived this far — either means the connector search read past
 *    the real end of the location and into the rest of the screen.
 * 3. Drop anything that is not a Unicode letter, whitespace, comma, apostrophe, hyphen, or period, then collapse
 *    whitespace again (filtering can leave doubled spaces) and strip a newly-exposed trailing period.
 * 4. Reject if what is left is shorter than 2 characters or longer than 120 (`listing_proof_private`'s own
 *    `check` constraint).
 */
function cleanLocation(raw: string): string | undefined {
  const collapsed = raw.replace(/\.+$/, '').replace(/\s+/g, ' ').trim();
  if (collapsed === '') return undefined;
  if (DIGIT_RUN.test(collapsed)) return undefined;
  if (UI_WORD.test(collapsed)) return undefined;

  const filtered = collapsed.replace(DISALLOWED_CHARS, '').replace(/\s+/g, ' ').trim();
  const final = filtered.replace(/\.+$/, '').trim();

  if (final.length < 2 || final.length > 120) return undefined;
  return final;
}

/**
 * The catch location off an appraisal screenshot's OCR text, or `undefined` when nothing on the "Caught" line
 * (or lines — see below) can be trusted as one. **Private**: the caller must save this only to
 * `public.listing_proof_private`, never to `listing_proofs.ocr_extracted`, and never pass it to `log()`.
 *
 * Works line by line rather than over a fixed character window (unlike `date.ts`'s date search) because a
 * location has no self-terminating shape the way a date's digits do — a window wide enough to catch "Paris,
 * France" is also wide enough to swallow the next unrelated line ("Stardust 2500") if the search were not
 * fenced at the line break. The one case a line is extended past its own break: if it ends in a bare ',', the
 * next line is joined on, since that is OCR wrapping a location that continues ("...around Paris,\nFrance"),
 * not two unrelated lines.
 *
 * Every line containing the anchor is tried in turn (mirroring `parseCatchDate`'s own "skip an anchor with
 * nothing usable and try the next" behaviour) so one throwaway "Caught" earlier in the noise never hides a
 * usable one later on.
 */
export function extractCatchLocation(text: string): string | undefined {
  const lines = text.split(/\r?\n/);

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i] ?? '';
    if (!ANCHOR_LINE.test(line)) continue;

    const joined = line.trim().endsWith(',') && i + 1 < lines.length ? `${line} ${(lines[i + 1] ?? '').trim()}` : line;

    const raw = rawLocationCandidate(joined);
    if (raw === undefined) continue;

    const cleaned = cleanLocation(raw);
    if (cleaned !== undefined) return cleaned;
  }

  return undefined;
}

// ================================================================================================================
// Size class: XXS / XS / XL / XXL, printed next to an appraisal's weight and height.
// ================================================================================================================

export type SizeClass = 'XXS' | 'XS' | 'XL' | 'XXL';

/** The four size labels the game prints, longest first so `XXS`/`XXL` are never mistaken for a partial `XS`/`XL`
 * match at the same position (moot with `\b` fencing both ends, but explicit is cheap and this is the order the
 * task spec itself lists them in). Case-insensitive, and matched as its own word so a size never comes out of
 * the middle of some longer run of letters. */
const SIZE_TOKEN = /\b(XXS|XXL|XS|XL)\b/gi;

/** A weight or height token, the only context that makes a bare "XL"/"XS" trustworthy as the size label rather
 * than noise: the units the game prints them in, or the field names themselves. */
const WEIGHT_HEIGHT_TOKEN = /\b(?:kg|m|weight|height)\b/i;

/** How far (in characters, either direction) a size token must be from a weight/height token to count. Roughly
 * a short run of OCR text — "12.20 kg ... XL ..." on the same line-ish stretch — not the whole screen. */
const SIZE_PROXIMITY = 40;

/** Trainers level 31+ see a running "XL Candy" count on the very same appraisal screen as the weight and height,
 * so a bare "XL" immediately followed by "Candy" is that counter, never the size label — checked before the
 * proximity rule even runs, since the candy count sits right next to the weight/height text too. */
function isXlCandy(text: string, matchEnd: number): boolean {
  return /^\s*candy\b/i.test(text.slice(matchEnd, matchEnd + 20));
}

/**
 * The size label (XXS/XS/XL/XXL) off an appraisal screenshot's OCR text, or `undefined` when none is trustworthy
 * enough to tag: no size token at all, every candidate was the "XL Candy" counter or too far from a weight/height
 * token to be the size label, or two DIFFERENT sizes both passed those checks (never resolved by picking one —
 * `listings.size_class` is a one-shot write, so a wrong tag can never be corrected by a later, better read; see
 * `applySizeClass` in `process.ts`). OCR case noise ("XXl") is normalised to the game's own uppercase spelling.
 */
export function extractSizeClass(text: string): SizeClass | undefined {
  const found = new Set<SizeClass>();

  for (const match of text.matchAll(SIZE_TOKEN)) {
    const start = match.index ?? 0;
    const end = start + match[0].length;
    const normalized = match[0].toUpperCase() as SizeClass;

    if (normalized === 'XL' && isXlCandy(text, end)) continue;

    const windowStart = Math.max(0, start - SIZE_PROXIMITY);
    const windowEnd = Math.min(text.length, end + SIZE_PROXIMITY);
    if (!WEIGHT_HEIGHT_TOKEN.test(text.slice(windowStart, windowEnd))) continue;

    found.add(normalized);
  }

  return found.size === 1 ? [...found][0] : undefined;
}
