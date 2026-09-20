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
