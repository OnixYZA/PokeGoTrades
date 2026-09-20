/** Which part comes first when a date could be read either way (03/04/2021). */
export type DateOrder = 'MDY' | 'DMY';

export interface CatchDate {
  /** ISO calendar date, `YYYY-MM-DD`. */
  caughtAt: string;
  /** Both parts could have been the month, so `order` decided. The date may be off by a swap of day and month. */
  ambiguous: boolean;
}

export interface ParseOptions {
  order?: DateOrder;
  /** The clock, for tests. */
  now?: Date;
}

/** Pokémon GO launched in July 2016: nothing can have been caught earlier, so an earlier "date" is a misread. */
const EARLIEST = Date.UTC(2016, 6, 1);
const DAY_MS = 24 * 60 * 60 * 1000;

/** How far past "Caught" to look for the date: room for "on", a colon, or a line break, not for a new paragraph. */
const WINDOW = 40;

// The word the date hangs off. Only a date right after it counts: another date on the screenshot, or a stray
// 03/04/2021 in the noise, must never be taken for the catch date.
const ANCHOR = /\bc[ao]ught\b/gi;

// D/M/YYYY. Separators: the game's `/`, plus `-` and `.` from other locales and `|` `\` for a thin `/` misread.
// Spaces are allowed anywhere, because the screenshot is often read as "03 / 14 / 2021". The year is 4 digits.
const DATE = /(\d{1,2})\s*[/\\|.-]\s*(\d{1,2})\s*[/\\|.-]\s*((?:19|20)\d{2})(?!\d)/;

/**
 * Finds the catch date in OCR text. Pokémon GO prints it after "Caught", as MM/DD/YYYY or DD/MM/YYYY
 * depending on the game's language. Returns `null` when there is no believable date, and prefers that to a
 * guess: a wrong date could wrongly grant or deny a listing's "Guaranteed Lucky" badge.
 *
 * Reading the order: a part above 12 has to be the day, which settles it. When both parts could be the
 * month, `order` decides (default month first) and the result is flagged `ambiguous`.
 */
export function parseCatchDate(text: string, options: ParseOptions = {}): CatchDate | null {
  const { order = 'MDY', now = new Date() } = options;
  const latest = now.getTime() + DAY_MS; // the phone's local date can be a day ahead of UTC

  for (const anchor of text.matchAll(ANCHOR)) {
    const start = (anchor.index ?? 0) + anchor[0].length;
    // Tesseract's commonest slip in digits is the letter O for a zero.
    const window = text.slice(start, start + WINDOW).replace(/[Oo]/g, '0');
    const match = DATE.exec(window);
    if (!match) continue;

    const first = Number(match[1]);
    const second = Number(match[2]);
    const year = Number(match[3]);

    let month: number;
    let day: number;
    let ambiguous = false;
    if (first > 12 && second <= 12) [day, month] = [first, second];
    else if (second > 12 && first <= 12) [month, day] = [first, second];
    else if (first > 12 && second > 12) continue;
    else {
      [month, day] = order === 'MDY' ? [first, second] : [second, first];
      ambiguous = first !== second;
    }

    const time = Date.UTC(year, month - 1, day);
    const real = new Date(time);
    // Date.UTC rolls 31/02 over to March: only accept a date that survives the round trip.
    if (real.getUTCFullYear() !== year || real.getUTCMonth() !== month - 1 || real.getUTCDate() !== day) continue;
    if (time < EARLIEST || time > latest) continue;

    return { caughtAt: real.toISOString().slice(0, 10), ambiguous };
  }
  return null;
}
