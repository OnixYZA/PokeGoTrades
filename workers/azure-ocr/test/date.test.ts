import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { parseCatchDate } from '../src/core/date';

const NOW = new Date('2026-09-20T12:00:00Z');
const parse = (text: string, order?: 'MDY' | 'DMY') => parseCatchDate(text, { now: NOW, order });

describe('parseCatchDate', () => {
  describe('the formats Pokémon GO prints', () => {
    it('reads MM/DD/YYYY', () => {
      assert.deepEqual(parse('Caught 03/14/2021'), { caughtAt: '2021-03-14', ambiguous: false });
    });

    it('reads DD/MM/YYYY', () => {
      assert.deepEqual(parse('Caught 25/12/2019'), { caughtAt: '2019-12-25', ambiguous: false });
    });

    it('reads the spaced form OCR often produces', () => {
      assert.deepEqual(parse('Caught 03 / 14 / 2021'), { caughtAt: '2021-03-14', ambiguous: false });
    });

    it('reads single-digit day and month', () => {
      assert.deepEqual(parse('Caught 7/24/2018'), { caughtAt: '2018-07-24', ambiguous: false });
    });

    it('finds the date among the rest of the screen', () => {
      const screen = 'Mewtwo\nCP 4178\nHP 165 / 165\nStardust 2500\nWeight 12.20 kg\nCaught on 03/14/2021 at Adyar\nHeight 2.02 m';
      assert.deepEqual(parse(screen), { caughtAt: '2021-03-14', ambiguous: false });
    });

    it('allows the date on the next line', () => {
      assert.deepEqual(parse('Caught\n03/14/2021'), { caughtAt: '2021-03-14', ambiguous: false });
    });

    it('is not case sensitive', () => {
      assert.equal(parse('CAUGHT 03/14/2021')?.caughtAt, '2021-03-14');
    });
  });

  describe('day and month order', () => {
    it('takes a part above 12 as the day, whichever side it is on', () => {
      assert.equal(parse('Caught 14/03/2021', 'MDY')?.caughtAt, '2021-03-14');
      assert.equal(parse('Caught 03/14/2021', 'DMY')?.caughtAt, '2021-03-14');
    });

    it('flags a date whose order had to be assumed, month first by default, and offers the other reading', () => {
      assert.deepEqual(parse('Caught 07/04/2018'), { caughtAt: '2018-07-04', ambiguous: true, alternate: '2018-04-07' });
    });

    it('follows the configured order when it has to assume', () => {
      assert.deepEqual(parse('Caught 07/04/2018', 'DMY'), { caughtAt: '2018-04-07', ambiguous: true, alternate: '2018-07-04' });
    });

    it('gives an unambiguous date no alternate', () => {
      assert.equal('alternate' in (parse('Caught 25/12/2019') ?? {}), false);
      assert.equal('alternate' in (parse('Caught 05/05/2019') ?? {}), false);
    });

    it('drops a reading that is not a real date in range, so it is not ambiguous after all', () => {
      // 06/07/2016: June 7 is before the game existed, so it can only be July 6.
      assert.deepEqual(parse('Caught 06/07/2016'), { caughtAt: '2016-07-06', ambiguous: false });
      // 09/12/2026, read on 2026-09-20: December 9 has not happened yet, so it can only be September 12.
      assert.deepEqual(parse('Caught 09/12/2026'), { caughtAt: '2026-09-12', ambiguous: false });
      assert.deepEqual(parse('Caught 09/12/2026', 'DMY'), { caughtAt: '2026-09-12', ambiguous: false });
    });

    it('does not flag a date that reads the same either way', () => {
      assert.deepEqual(parse('Caught 05/05/2019'), { caughtAt: '2019-05-05', ambiguous: false });
    });
  });

  describe('OCR noise', () => {
    it('reads the letter O as a zero', () => {
      assert.equal(parse('Caught O3/14/2O21')?.caughtAt, '2021-03-14');
    });

    it('reads a bar or backslash as the slash', () => {
      assert.equal(parse('Caught 03|14|2021')?.caughtAt, '2021-03-14');
      assert.equal(parse('Caught 03\\14\\2021')?.caughtAt, '2021-03-14');
    });

    it('accepts the dotted and dashed forms of other locales', () => {
      assert.equal(parse('Caught 14.03.2021')?.caughtAt, '2021-03-14');
      assert.equal(parse('Caught 14-03-2021')?.caughtAt, '2021-03-14');
    });

    it('reads "Cought"', () => {
      assert.equal(parse('Cought 03/14/2021')?.caughtAt, '2021-03-14');
    });
  });

  describe('no believable date', () => {
    it('returns null for text with no date', () => {
      assert.equal(parse('Mewtwo CP 4178 Stardust 2500'), null);
      assert.equal(parse(''), null);
    });

    it('ignores a date that is not after "Caught"', () => {
      assert.equal(parse('Event 03/14/2021 Weight 12 kg'), null);
      assert.equal(parse('03/14/2021'), null);
    });

    it('ignores a date too far after "Caught"', () => {
      assert.equal(parse('Caught ' + 'x'.repeat(60) + ' 03/14/2021'), null);
    });

    it('rejects a day that does not exist', () => {
      assert.equal(parse('Caught 02/30/2021'), null);
      assert.equal(parse('Caught 31/04/2021'), null);
    });

    it('rejects a leap day in a common year, and accepts it in a leap year', () => {
      assert.equal(parse('Caught 02/29/2021'), null);
      assert.equal(parse('Caught 02/29/2020')?.caughtAt, '2020-02-29');
    });

    it('rejects two parts that cannot be a month', () => {
      assert.equal(parse('Caught 13/13/2020'), null);
    });

    it('rejects a date before the game existed', () => {
      assert.equal(parse('Caught 01/01/2010'), null);
      assert.equal(parse('Caught 06/30/2016'), null);
      assert.equal(parse('Caught 07/06/2016')?.caughtAt, '2016-07-06');
    });

    it('rejects a date in the future, with a day of slack for time zones', () => {
      assert.equal(parse('Caught 01/01/2099'), null);
      assert.equal(parse('Caught 09/22/2026'), null);
      assert.equal(parse('Caught 09/21/2026')?.caughtAt, '2026-09-21');
    });

    it('rejects a two-digit year and an over-long year', () => {
      assert.equal(parse('Caught 03/14/21'), null);
      assert.equal(parse('Caught 03/14/20211'), null);
    });
  });

  it('skips a first "Caught" with no usable date and tries the next', () => {
    assert.equal(parse('Caught 13/13/2020 ... Caught 03/14/2021')?.caughtAt, '2021-03-14');
  });
});
