import { parseCatchDate, type CatchDate, type DateOrder } from './date';

/** `listing_proofs.kind`: the `proof_kind` enum in the database. */
export const PROOF_KINDS = ['appraisal', 'movesets', 'event_badge'] as const;
export type ProofKind = (typeof PROOF_KINDS)[number];

/**
 * A Pokémon caught before this date trades as Guaranteed Lucky. The cutoff is exclusive: caught on 2019-06-30
 * qualifies, caught on 2019-07-01 does not.
 */
export const LUCKY_CUTOFF = '2019-07-01';

/**
 * Where a catch date falls against `LUCKY_CUTOFF`:
 * - `early`: before it, however the date is read.
 * - `late`: on or after it, however the date is read.
 * - `unclear`: an ambiguous date (03/09/2019 is March 9 or September 3) whose two readings fall either side.
 *   The badge is not granted on a guess.
 */
export type LuckyCheck = 'early' | 'late' | 'unclear';

export function checkLuckyCutoff(caught: Pick<CatchDate, 'caughtAt' | 'alternate'>): LuckyCheck {
  // `YYYY-MM-DD` strings sort the same as the dates they name, so they compare directly.
  const readings = caught.alternate === undefined ? [caught.caughtAt] : [caught.caughtAt, caught.alternate];
  const early = readings.filter((date) => date < LUCKY_CUTOFF).length;
  if (early === readings.length) return 'early';
  return early === 0 ? 'late' : 'unclear';
}

/**
 * Enough words to tell a screenshot of a game screen from a blank image or a photo: at least this many runs of
 * three or more letters or digits. A real Pokémon GO screen has dozens.
 */
const MIN_TEXT_TOKENS = 3;

export function hasReadableText(text: string): boolean {
  return (text.match(/[A-Za-z0-9]{3,}/g)?.length ?? 0) >= MIN_TEXT_TOKENS;
}

export type Verdict =
  | {
      status: 'verified';
      /** What is saved in `listing_proofs.ocr_extracted`. */
      extracted: { caughtAt?: string; ambiguous?: true };
      /** Appraisal proofs only: whether the catch date earns the listing Guaranteed Lucky. */
      lucky?: LuckyCheck;
    }
  | {
      status: 'failed';
      extracted: { reason: 'unreadable' };
      /** Why, for the logs. Not saved. */
      cause: 'no_date' | 'no_text';
    };

export interface InterpretOptions {
  order?: DateOrder;
  /** The clock, for tests. */
  now?: Date;
}

/**
 * Decides what one proof's OCR text amounts to, by its `kind`:
 * - `appraisal` must show a catch date. Found, it is `verified` with `{ caughtAt }` and checked against the
 *   Guaranteed Lucky cutoff. Not found, it `failed` as `unreadable`.
 * - `movesets` and `event_badge` do not need a date. For the MVP they are `verified` once OCR reads readable
 *   text (so a blank image or a photo is not), and the text is not mined for anything else: a date on one of
 *   these earns nothing, since only the appraisal proof backs the badge. Tightening this to specific screen
 *   text would need real screenshots to check the game's wording against.
 *
 * Pure: no database and no clock but `options.now`. Throws on a kind it does not know, which means this
 * worker is older than the database's enum, so the proof is left to be retried once the worker is updated.
 */
export function interpretProof(kind: string, text: string, options: InterpretOptions = {}): Verdict {
  switch (kind) {
    case 'appraisal': {
      const found = parseCatchDate(text, options);
      if (!found) return { status: 'failed', extracted: { reason: 'unreadable' }, cause: 'no_date' };
      return {
        status: 'verified',
        // `ambiguous` is only written when true: the date order was assumed, so day and month may be swapped.
        extracted: found.ambiguous ? { caughtAt: found.caughtAt, ambiguous: true } : { caughtAt: found.caughtAt },
        lucky: checkLuckyCutoff(found),
      };
    }
    case 'movesets':
    case 'event_badge':
      return hasReadableText(text)
        ? { status: 'verified', extracted: {} }
        : { status: 'failed', extracted: { reason: 'unreadable' }, cause: 'no_text' };
    default:
      throw new Error(`Unknown proof kind "${kind}"`);
  }
}

// ================================================================================================================
// Profile proofs: the "My Trainer Code" screen (trainer name + a 12-digit friend code, usually beside a QR block)
// ================================================================================================================

/** Same shape the database enforces (`public.profiles.handle`, migration …000200): URL-safe, 3-15 characters. */
const HANDLE_PATTERN = /^[A-Za-z0-9]{3,15}$/;

/** The placeholder handle `private.handle_new_user` assigns every new account. Reading one back off a screenshot
 * would mean the trainer never set a real name, not that OCR found their handle. */
const PLACEHOLDER_HANDLE = /^Trainer[0-9]{8}$/;

/**
 * Game-chrome words that satisfy `HANDLE_PATTERN` on their own line and would otherwise be read as the trainer's
 * name: menu labels, buttons, and headings around the trainer-code screen. Not exhaustive by construction — new
 * false positives get added here as real screenshots turn them up (see `README.md`'s "known limits").
 */
const HANDLE_STOP_WORDS = new Set([
  'FRIEND',
  'FRIENDS',
  'TRAINER',
  'CODE',
  'MY',
  'ADD',
  'SHARE',
  'COPY',
  'QR',
  'SCAN',
  'INVITE',
  'GIFTS',
  'GIFT',
  'BUDDY',
  'SETTINGS',
  'CLOSE',
  'OK',
  'CANCEL',
  'POKEMON',
  'GO',
  'PROFILE',
  'LEVEL',
  'TEAM',
  'BACK',
  'NEXT',
  'DONE',
  'YES',
  'NO',
  'SEND',
  'ACCEPT',
  'DECLINE',
  'MENU',
  'MAP',
  'ITEMS',
  'SHOP',
  'NIANTIC',
]);

/**
 * The first line, in reading order, that is the trainer's handle: after trimming whitespace and surrounding
 * punctuation, exactly one token remains, it matches the handle shape, it is not all digits (a stray line of
 * the friend code itself), it is not the reserved placeholder pattern, and it is not one of `HANDLE_STOP_WORDS`.
 * Pure text search — no fuzzing, no scoring — because the handle is printed once, plainly, on its own line, and
 * guessing among near-misses risks writing the wrong trainer's name into `profiles.handle`.
 */
function extractHandle(text: string): string | null {
  for (const rawLine of text.split(/\r?\n/)) {
    const token = rawLine.trim().replace(/^[^A-Za-z0-9]+|[^A-Za-z0-9]+$/g, '');
    if (token === '' || /\s/.test(token)) continue; // not exactly one token
    if (!HANDLE_PATTERN.test(token)) continue;
    if (/^[0-9]+$/.test(token)) continue;
    if (PLACEHOLDER_HANDLE.test(token)) continue;
    if (HANDLE_STOP_WORDS.has(token.toUpperCase())) continue;
    return token;
  }
  return null;
}

/** One group of a friend code as Pokémon GO prints it: four digits, or a letter tesseract commonly confuses with one. */
const FRIEND_GROUP = '[0-9OoIl|SB]{4}';
/** The separators seen between groups: a space, the game's own '·', or '.' / '-' from OCR misreading '·'. */
const FRIEND_SEP = '[ ·.-]';
const FRIEND_CODE_PATTERN = new RegExp(`${FRIEND_GROUP}${FRIEND_SEP}${FRIEND_GROUP}${FRIEND_SEP}${FRIEND_GROUP}`, 'g');

/** Letters tesseract confuses with a digit, mapped back — but only inside a candidate group already shaped like
 * one, so a stray 'S' elsewhere in the screenshot is never mistaken for part of the code. */
const DIGIT_CONFUSION: Record<string, string> = { O: '0', o: '0', I: '1', l: '1', '|': '1', S: '5', B: '8' };

function normalizeDigits(group: string): string {
  return Array.from(group, (ch) => DIGIT_CONFUSION[ch] ?? ch).join('');
}

/** A QR payload's friend code, if the code is all that is in it: strip everything but digits and require exactly 12. */
function friendCodeFromQr(qrPayload: string | null | undefined): string | null {
  if (!qrPayload) return null;
  const digits = qrPayload.replace(/\D/g, '');
  return digits.length === 12 ? digits : null;
}

/**
 * Every distinct 12-digit reading `FRIEND_CODE_PATTERN` finds in the OCR text, after `normalizeDigits`. A screen
 * with the friend code printed once yields exactly one; a screen with two different-looking numbers that both
 * happen to fit the shape (a second, unrelated 12-digit run in the noise) yields two, and the caller must treat
 * that as ambiguous rather than pick one by guesswork.
 */
function friendCodesFromText(text: string): Set<string> {
  const found = new Set<string>();
  for (const match of text.matchAll(FRIEND_CODE_PATTERN)) {
    const candidate = normalizeDigits(match[0].replace(new RegExp(FRIEND_SEP, 'g'), ''));
    if (/^[0-9]{12}$/.test(candidate)) found.add(candidate);
  }
  return found;
}

export type ProfileVerdict =
  | { status: 'verified'; handle: string; friendCode: string }
  | {
      status: 'failed';
      reason: 'no_handle' | 'no_friend_code';
      /** Whichever of the two this run did manage to read, so the app's manual fallback form can prefill it. */
      handle?: string;
      friendCode?: string;
    };

/**
 * Decides what a "My Trainer Code" screenshot's OCR text (and, if the screen shows one, its decoded QR payload)
 * amounts to: a handle and a friend code, or a reason neither could be trusted.
 *
 * - **Friend code.** A QR payload wins outright when it decodes to exactly 12 digits (`friendCodeFromQr`) — a QR
 *   code is either read correctly or not decoded at all, so there is no OCR-style noise to second-guess, and a
 *   correctly-decoded payload is checked first without even looking at the OCR text. Otherwise the OCR text is
 *   scanned for the `dddd·dddd·dddd` shape; two different 12-digit readings on the same screen is `no_friend_code`
 *   (never a guess), and so is none at all.
 * - **Handle.** The first line that is unambiguously just a trainer name (`extractHandle`).
 * - Missing the handle takes priority over missing the friend code when both are absent, but either partial
 *   result that WAS read is still returned, so a caller can prefill everything it already knows.
 *
 * Pure: no I/O, no clock. Never throws.
 */
export function interpretProfile(text: string, qrPayload?: string | null): ProfileVerdict {
  const handle = extractHandle(text) ?? undefined;

  const qrCode = friendCodeFromQr(qrPayload);
  let friendCode: string | undefined;
  if (qrCode) {
    friendCode = qrCode;
  } else {
    const candidates = friendCodesFromText(text);
    friendCode = candidates.size === 1 ? [...candidates][0] : undefined;
  }

  if (!handle) return { status: 'failed', reason: 'no_handle', ...(friendCode ? { friendCode } : {}) };
  if (!friendCode) return { status: 'failed', reason: 'no_friend_code', handle };
  return { status: 'verified', handle, friendCode };
}
