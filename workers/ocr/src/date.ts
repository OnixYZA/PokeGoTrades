/** Which part comes first when a date could be read either way (03/04/2021). */
export type DateOrder = 'MDY' | 'DMY';

export interface CatchDate {
  /** ISO calendar date, `YYYY-MM-DD`. */
  caughtAt: string;
  /** Both parts could have been the month, so `order` decided. The date may be off by a swap of day and month. */
  ambiguous: boolean;
  /** Only when `ambiguous`: the same digits read the other way round. Which of the two is right is unknown. */
  alternate?: string;
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

/** `YYYY-MM-DD` if this is a real calendar date inside the plausible range, else `null`. */
function plausible(year: number, month: number, day: number, latest: number): string | null {
  const time = Date.UTC(year, month - 1, day);
  const real = new Date(time);
  // Date.UTC rolls 31/02 over to March, and month 14 into the next year: only accept a date that survives the round trip.
  if (real.getUTCFullYear() !== year || real.getUTCMonth() !== month - 1 || real.getUTCDate() !== day) return null;
  if (time < EARLIEST || time > latest) return null;
  return real.toISOString().slice(0, 10);
}

/**
 * Finds the catch date in OCR text. Pokémon GO prints it after "Caught", as MM/DD/YYYY or DD/MM/YYYY
 * depending on the game's language. Returns `null` when there is no believable date, and prefers that to a
 * guess: a wrong date could wrongly grant or deny a listing's "Guaranteed Lucky" badge.
 *
 * The order is settled by elimination: each way of reading the two numbers (month first, day first) counts
 * only if it is a real date in range, so `25/12/2019` can only be day first, and `09/12/2026` cannot be
 * December in a year that has not reached December. If exactly one reading survives, that is the date. If both
 * do (`07/04/2018`), `order` picks (default month first), the result is flagged `ambiguous`, and the other
 * reading is returned as `alternate` so callers can tell whether the doubt matters to them.
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

    const monthFirst: [number, number] = [first, second]; // [month, day]
    const dayFirst: [number, number] = [second, first];
    const readings = new Set(
      (order === 'MDY' ? [monthFirst, dayFirst] : [dayFirst, monthFirst])
        .map(([month, day]) => plausible(year, month, day, latest))
        .filter((date): date is string => date !== null),
    );

    const [caughtAt, alternate] = [...readings];
    if (caughtAt === undefined) continue;
    return alternate === undefined ? { caughtAt, ambiguous: false } : { caughtAt, ambiguous: true, alternate };
  }
  return null;
}
