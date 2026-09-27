import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { checkLuckyCutoff, hasReadableText, interpretProof, LUCKY_CUTOFF } from '../src/core/parser';

const NOW = new Date('2026-09-20T12:00:00Z');
const interpret = (kind: string, text: string) => interpretProof(kind, text, { now: NOW });

// What a Pokémon detail screen reads as, without the catch line.
const SCREEN = 'CP 2947 Mewtwo HP 165/165 12.20 kg Psychic 2.02 m Weight Type Height Stardust Candy';

describe('checkLuckyCutoff', () => {
  it('uses 2019-07-01 as an exclusive cutoff', () => {
    assert.equal(LUCKY_CUTOFF, '2019-07-01');
    assert.equal(checkLuckyCutoff({ caughtAt: '2019-06-30' }), 'early');
    assert.equal(checkLuckyCutoff({ caughtAt: '2019-07-01' }), 'late');
    assert.equal(checkLuckyCutoff({ caughtAt: '2016-07-06' }), 'early');
    assert.equal(checkLuckyCutoff({ caughtAt: '2026-01-01' }), 'late');
  });

  it('is early or late only when every reading of an ambiguous date agrees', () => {
    assert.equal(checkLuckyCutoff({ caughtAt: '2019-03-04', alternate: '2019-04-03' }), 'early');
    assert.equal(checkLuckyCutoff({ caughtAt: '2019-08-09', alternate: '2019-09-08' }), 'late');
  });

  it('is unclear when the readings fall either side, whichever one was picked', () => {
    assert.equal(checkLuckyCutoff({ caughtAt: '2019-03-09', alternate: '2019-09-03' }), 'unclear');
    assert.equal(checkLuckyCutoff({ caughtAt: '2019-09-03', alternate: '2019-03-09' }), 'unclear');
  });
});

describe('interpretProof: appraisal', () => {
  it('verifies a catch date and records it', () => {
    assert.deepEqual(interpret('appraisal', `${SCREEN} Caught 03/14/2021`), {
      status: 'verified',
      extracted: { caughtAt: '2021-03-14' },
      lucky: 'late',
    });
  });

  it('flags an ambiguous date in what it records', () => {
    assert.deepEqual(interpret('appraisal', 'Caught 7/4/2018'), {
      status: 'verified',
      extracted: { caughtAt: '2018-07-04', ambiguous: true },
      lucky: 'early',
    });
  });

  it('fails as unreadable without a catch date, even with plenty of other text', () => {
    assert.deepEqual(interpret('appraisal', SCREEN), { status: 'failed', extracted: { reason: 'unreadable' }, cause: 'no_date' });
    assert.deepEqual(interpret('appraisal', ''), { status: 'failed', extracted: { reason: 'unreadable' }, cause: 'no_date' });
  });

  it('marks a date before the cutoff as early, and the last day before it too', () => {
    assert.equal((interpret('appraisal', 'Caught 11/23/2018') as { lucky: string }).lucky, 'early');
    assert.equal((interpret('appraisal', 'Caught 06/30/2019') as { lucky: string }).lucky, 'early');
  });

  it('marks a date on or after the cutoff as late', () => {
    assert.equal((interpret('appraisal', 'Caught 07/15/2019') as { lucky: string }).lucky, 'late');
    assert.equal((interpret('appraisal', 'Caught 25/12/2019') as { lucky: string }).lucky, 'late');
  });

  it('cannot call 07/01/2019 early: it is also 7 January, so it is unclear', () => {
    // July 1 is the cutoff itself and can never be written unambiguously as numbers (both parts are <= 12).
    assert.equal((interpret('appraisal', 'Caught 07/01/2019') as { lucky: string }).lucky, 'unclear');
  });

  it('marks an ambiguous date as unclear when the readings straddle the cutoff', () => {
    assert.deepEqual(interpret('appraisal', 'Caught 03/09/2019'), {
      status: 'verified',
      extracted: { caughtAt: '2019-03-09', ambiguous: true },
      lucky: 'unclear',
    });
  });
});

describe('interpretProof: appraisal size class and catch location', () => {
  it('adds a public sizeClass to extracted, and a separate, non-merged privateFacts.catchLocation', () => {
    // The size label sits next to the weight/height line; the catch line (with its own location) is separate,
    // just as the two would be on a real appraisal screenshot's own separate lines.
    const verdict = interpret('appraisal', `${SCREEN} XL\nCaught on 03/14/2021 at Adyar`);
    assert.deepEqual(verdict, {
      status: 'verified',
      extracted: { caughtAt: '2021-03-14', sizeClass: 'XL' },
      lucky: 'late',
      privateFacts: { catchLocation: 'Adyar' },
    });
    // The location must never end up in the same place the size class does: a buyer can see `extracted`.
    assert.equal('catchLocation' in verdict.extracted, false);
  });

  it('omits sizeClass from extracted, and privateFacts entirely, when neither was read', () => {
    const verdict = interpret('appraisal', 'Caught 11/23/2018');
    assert.deepEqual(verdict, { status: 'verified', extracted: { caughtAt: '2018-11-23' }, lucky: 'early' });
    assert.equal('sizeClass' in verdict.extracted, false);
    assert.equal('privateFacts' in verdict, false);
  });

  it('extracts a location with no size label present', () => {
    const verdict = interpret('appraisal', 'Caught 11/23/2018 · Adyar');
    assert.deepEqual(verdict, {
      status: 'verified',
      extracted: { caughtAt: '2018-11-23' },
      lucky: 'early',
      privateFacts: { catchLocation: 'Adyar' },
    });
    assert.equal('sizeClass' in verdict.extracted, false);
  });

  it('extracts a size label with no catch location present', () => {
    const verdict = interpret('appraisal', `${SCREEN} Caught 11/23/2018 XL`);
    assert.deepEqual(verdict, { status: 'verified', extracted: { caughtAt: '2018-11-23', sizeClass: 'XL' }, lucky: 'early' });
    assert.equal('privateFacts' in verdict, false);
  });

  it('never guesses a size when two different labels are both near a weight/height token', () => {
    const verdict = interpret('appraisal', 'Weight 12.20 kg XL Height 2.02 m XS Caught 11/23/2018');
    assert.equal(verdict.status === 'verified' && verdict.extracted.sizeClass, undefined);
  });
});

describe('interpretProof: movesets and event_badge', () => {
  for (const kind of ['movesets', 'event_badge']) {
    describe(kind, () => {
      it('verifies a screenshot with readable text and no catch date', () => {
        assert.deepEqual(interpret(kind, SCREEN), { status: 'verified', extracted: {} });
      });

      it('does not need a date, and does not record or act on one', () => {
        const verdict = interpret(kind, `${SCREEN} Caught 11/23/2018`);
        assert.deepEqual(verdict, { status: 'verified', extracted: {} });
        assert.equal('lucky' in verdict, false, 'only an appraisal can earn the badge');
      });

      it('fails as unreadable when there is no readable text', () => {
        assert.deepEqual(interpret(kind, ''), { status: 'failed', extracted: { reason: 'unreadable' }, cause: 'no_text' });
        assert.deepEqual(interpret(kind, ' . , ~ \n |'), { status: 'failed', extracted: { reason: 'unreadable' }, cause: 'no_text' });
      });
    });
  }
});

describe('interpretProof: unknown kind', () => {
  it('throws rather than guess', () => {
    assert.throws(() => interpret('selfie', SCREEN), /Unknown proof kind "selfie"/);
  });
});

describe('hasReadableText', () => {
  it('needs three words of three or more characters', () => {
    assert.equal(hasReadableText('Fast Attack Charged'), true);
    assert.equal(hasReadableText('Fast Attack'), false);
    assert.equal(hasReadableText('ab cd ef gh ij kl'), false);
    assert.equal(hasReadableText(''), false);
  });
});
