import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { extractCatchLocation, extractSizeClass } from '../src/core/catch';

// What a Pokémon detail screen reads as, without a catch line or a size label: the weight/height context the
// size rules anchor on, same fixture shape `test/parser.test.ts` uses.
const SCREEN = 'CP 2947 Mewtwo HP 165/165 12.20 kg Psychic 2.02 m Weight Type Height Stardust Candy';

describe('extractCatchLocation', () => {
  describe('the shapes Pokémon GO (and OCR noise on top of it) prints', () => {
    it('reads a middle-dot after the date', () => {
      assert.equal(extractCatchLocation('Caught 11/23/2018 · Adyar'), 'Adyar');
    });

    it('reads "at" after the date', () => {
      assert.equal(extractCatchLocation('Caught on 03/14/2021 at Adyar'), 'Adyar');
    });

    it('reads "around" after the date, with a comma and a trailing period', () => {
      assert.equal(extractCatchLocation('This Pokémon was caught on 3/14/2021 around Paris, France.'), 'Paris, France');
    });

    it('reads "around" BEFORE the date, stripping the glue word that introduces it', () => {
      assert.equal(extractCatchLocation('caught around Paris, France on 3/14/2021'), 'Paris, France');
    });

    it('reads a dash after the date', () => {
      assert.equal(extractCatchLocation('Caught 11/23/2018 - Adyar'), 'Adyar');
    });

    it('finds the location among the rest of the screen', () => {
      const screen = `${SCREEN}\nCaught on 03/14/2021 at Adyar\nMore stuff below`;
      assert.equal(extractCatchLocation(screen), 'Adyar');
    });
  });

  describe('line wrapping', () => {
    it('joins the next line when the location is cut off after a trailing comma', () => {
      assert.equal(extractCatchLocation('caught on 3/14/2021 around Paris,\nFrance'), 'Paris, France');
    });

    it('does not pull in an unrelated next line with no trailing comma', () => {
      assert.equal(extractCatchLocation('Caught 11/23/2018 · Adyar\nStardust 2500'), 'Adyar');
    });
  });

  describe('no believable location', () => {
    it('returns undefined with no "Caught" line at all', () => {
      assert.equal(extractCatchLocation(SCREEN), undefined);
      assert.equal(extractCatchLocation(''), undefined);
    });

    it('returns undefined when a date is present but no connector introduces a location', () => {
      assert.equal(extractCatchLocation('Caught 11/23/2018'), undefined);
      assert.equal(extractCatchLocation('Caught 11/23/2018 CP 2947'), undefined);
    });

    it('rejects a result carrying a run of 3+ digits', () => {
      assert.equal(extractCatchLocation('Caught 11/23/2018 · Area 5128'), undefined);
    });

    it('rejects a result carrying a UI word, even mid-phrase', () => {
      assert.equal(extractCatchLocation('Caught on 03/14/2021 at Adyar Height 2.02 m'), undefined);
      assert.equal(extractCatchLocation('Caught 11/23/2018 · Stardust'), undefined);
    });

    it('rejects a result shorter than 2 characters', () => {
      assert.equal(extractCatchLocation('Caught 11/23/2018 · A'), undefined);
      assert.equal(extractCatchLocation('Caught 11/23/2018 · .'), undefined);
    });

    it('rejects a result longer than 120 characters', () => {
      const long = 'A'.repeat(121);
      assert.equal(extractCatchLocation(`Caught 11/23/2018 · ${long}`), undefined);
    });

    it('skips a "Caught" line with nothing usable and tries the next', () => {
      const text = 'Caught 11/23/2018\nUnrelated\nCaught on 03/14/2021 at Adyar';
      assert.equal(extractCatchLocation(text), 'Adyar');
    });
  });

  it('keeps Unicode letters, commas, apostrophes, hyphens and periods, and strips anything else', () => {
    assert.equal(extractCatchLocation("Caught 11/23/2018 · O'Fallon-Winter's Zürich"), "O'Fallon-Winter's Zürich");
  });
});

describe('extractSizeClass', () => {
  it('reads XS near a weight token', () => {
    assert.equal(extractSizeClass('12.20 kg XS 2.02 m'), 'XS');
  });

  it('reads XL near a height token', () => {
    assert.equal(extractSizeClass('Height 2.02 m XL'), 'XL');
  });

  it('reads XXS and XXL', () => {
    assert.equal(extractSizeClass('Weight 12.20 kg XXS'), 'XXS');
    assert.equal(extractSizeClass('Weight 12.20 kg XXL'), 'XXL');
  });

  it('normalises OCR case noise to the game\'s own uppercase spelling', () => {
    assert.equal(extractSizeClass('Weight 12.20 kg XXl'), 'XXL');
    assert.equal(extractSizeClass('Weight 12.20 kg xs'), 'XS');
  });

  it('ignores a size token with no weight/height token nearby', () => {
    assert.equal(extractSizeClass('CP 2947 Mewtwo XL Psychic'), undefined);
  });

  it('ignores "XL Candy" — the level 31+ XL Candy counter, not the size label', () => {
    assert.equal(extractSizeClass(`${SCREEN} XL Candy 40`), undefined);
    assert.equal(extractSizeClass('Weight 12.20 kg XL Candy'), undefined);
  });

  it('still reads a real XL elsewhere even when XL Candy is also on the screen', () => {
    assert.equal(extractSizeClass('Weight 12.20 kg XL Height 2.02 m ... XL Candy 40'), 'XL');
  });

  it('returns undefined when two different sizes are both found near weight/height tokens', () => {
    assert.equal(extractSizeClass('Weight 12.20 kg XL Height 2.02 m XS'), undefined);
  });

  it('returns the one size when it is mentioned twice', () => {
    assert.equal(extractSizeClass('Weight 12.20 kg XL Height 2.02 m XL'), 'XL');
  });

  it('returns undefined with no size token at all', () => {
    assert.equal(extractSizeClass(SCREEN), undefined);
    assert.equal(extractSizeClass(''), undefined);
  });
});
