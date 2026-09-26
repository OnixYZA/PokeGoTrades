import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { interpretProfile } from '../src/core/parser';

describe('interpretProfile', () => {
  it('verifies a clean screen: a handle line and a spaced friend code', () => {
    const text = 'MY TRAINER CODE\nAshKetchum123\n1234 5678 9012\nSCAN TO ADD FRIEND';
    assert.deepEqual(interpretProfile(text), { status: 'verified', handle: 'AshKetchum123', friendCode: '123456789012' });
  });

  it('accepts the middle-dot and dashed separators the game and OCR both produce', () => {
    assert.equal(interpretProfile('AshKetchum123\n1234·5678·9012').friendCode, '123456789012');
    assert.equal(interpretProfile('AshKetchum123\n1234-5678-9012').friendCode, '123456789012');
    assert.equal(interpretProfile('AshKetchum123\n1234.5678.9012').friendCode, '123456789012');
  });

  it('reads O/0, I/l/|, S and B the way tesseract commonly confuses them, inside a candidate group only', () => {
    // O -> 0, S -> 5, B -> 8, I/l/| -> 1
    assert.equal(interpretProfile('AshKetchum123\n12O4 5S78 9B1I').friendCode, '120455789811');
  });

  it('prefers a QR payload over the OCR text when the QR decodes to exactly 12 digits', () => {
    const text = 'AshKetchum123\n1234 5678 9012'; // a different, otherwise-valid code in the OCR text
    const verdict = interpretProfile(text, 'https://poke.go/add?code=1111-2222-3333');
    assert.deepEqual(verdict, { status: 'verified', handle: 'AshKetchum123', friendCode: '111122223333' });
  });

  it('falls back to the OCR text when the QR payload is absent, unreadable, or not 12 digits', () => {
    const text = 'AshKetchum123\n1234 5678 9012';
    assert.equal(interpretProfile(text, null).friendCode, '123456789012');
    assert.equal(interpretProfile(text, undefined).friendCode, '123456789012');
    assert.equal(interpretProfile(text, '12345').friendCode, '123456789012'); // not 12 digits: not usable
  });

  it('treats two different 12-digit readings in the OCR text as ambiguous, never guessing', () => {
    const text = 'AshKetchum123\n1234 5678 9012\nsome other trainer: 1111 2222 3333';
    assert.deepEqual(interpretProfile(text), { status: 'failed', reason: 'no_friend_code', handle: 'AshKetchum123' });
  });

  it('does not let a QR read rescue an ambiguous OCR text: the QR is checked first and, absent one, ambiguity stands', () => {
    const text = 'AshKetchum123\n1234 5678 9012\n1111 2222 3333';
    assert.deepEqual(interpretProfile(text, null), { status: 'failed', reason: 'no_friend_code', handle: 'AshKetchum123' });
  });

  it('fails as no_handle when no line is exactly one handle-shaped token', () => {
    const text = 'MY TRAINER CODE\n1234 5678 9012\nSCAN TO ADD FRIEND';
    assert.deepEqual(interpretProfile(text), { status: 'failed', reason: 'no_handle', friendCode: '123456789012' });
  });

  it('skips UI chrome stop-words and an all-digits noise line while looking back for the handle', () => {
    // Updated for the anchored handle search: the old version of this test put the handle BELOW a spurious
    // all-digits line, relying on a first-match-anywhere scan that the anchored rule (nearest candidate ABOVE
    // the friend-code line) intentionally no longer does. See the "no_handle" test below for the codeLine's own
    // reach limit.
    const text = 'TRAINER\nAshKetchum123\n42\n1234 5678 9012';
    assert.deepEqual(interpretProfile(text), { status: 'verified', handle: 'AshKetchum123', friendCode: '123456789012' });
  });

  it('does not mistake the reserved placeholder handle for a real one', () => {
    const text = 'Trainer12345678\n1234 5678 9012';
    assert.deepEqual(interpretProfile(text), { status: 'failed', reason: 'no_handle', friendCode: '123456789012' });
  });

  it('rejects a line with more than one token, even if a token on it looks like a handle', () => {
    const text = 'Level 42 AshKetchum123\n1234 5678 9012';
    assert.deepEqual(interpretProfile(text), { status: 'failed', reason: 'no_handle', friendCode: '123456789012' });
  });

  it('strips surrounding punctuation before matching the handle shape', () => {
    const text = '"AshKetchum123"\n1234 5678 9012';
    assert.equal(interpretProfile(text).status, 'verified');
  });

  it('fails as no_friend_code with the handle prefilled when no code is found at all', () => {
    // The handle needs an anchor even when there is no code line at all: the header line is what the anchored
    // search falls back to (see "How it decides" in README.md). Updated from the old version of this test, which
    // relied on a first-match-anywhere scan finding the handle with no landmark present at all.
    const text = 'MY TRAINER CODE\nAshKetchum123\nno code visible on this screen';
    assert.deepEqual(interpretProfile(text), { status: 'failed', reason: 'no_friend_code', handle: 'AshKetchum123' });
  });

  it('fails as no_handle with neither field when the screen is not a trainer-code screen at all', () => {
    assert.deepEqual(interpretProfile('POKEMON GO\nSETTINGS\nCLOSE'), { status: 'failed', reason: 'no_handle' });
  });
});

// ================================================================================================================
// Real-shaped regressions: the current game's QR deep link, tesseract's no-space misreads, and the appraisal
// screen a trainer might upload by mistake. Fake identities throughout (Driftcoral42 / 123456789012 and friends)
// — never a real handle or friend code.
// ================================================================================================================

describe('interpretProfile — the current QR deep link (dl_action=AddFriend,DlId=<code>)', () => {
  const onelinkUrl = (code: string) =>
    `https://pokemon-go.onelink.me/nBRb?af_dp=pokemongo://&deep_link_value=dl_action%3DAddFriend%2CDlId%3D${code}`;

  it('reads the friend code out of the real onelink.me deep-link payload, finding the handle via the header since the OCR text has no code-shaped line of its own', () => {
    // `text` has no friend-code-shaped line at all (the code came only from the QR), so the code-line anchor
    // (rule 1) never fires and the header anchor (rule 2) is what finds the handle.
    const text = 'MY TRAINER CODE\nDriftcoral42\nno readable code on this screen';
    const verdict = interpretProfile(text, onelinkUrl('123456789012'));
    assert.deepEqual(verdict, { status: 'verified', handle: 'Driftcoral42', friendCode: '123456789012' });
  });

  it('decodes a double-encoded deep-link payload (2 passes) the same way', () => {
    const doubleEncoded = onelinkUrl('123456789012').replace(/%3D/g, '%253D').replace(/%2C/g, '%252C');
    const text = 'MY TRAINER CODE\nDriftcoral42\nno readable code on this screen';
    assert.deepEqual(interpretProfile(text, doubleEncoded), {
      status: 'verified',
      handle: 'Driftcoral42',
      friendCode: '123456789012',
    });
  });

  it('keeps an undecodable QR payload raw instead of throwing, and still finds a standalone 12-digit run', () => {
    assert.equal(interpretProfile('x', '%zz-123456789012').friendCode, '123456789012');
  });

  it('still accepts a bare 12-digit QR code (the old, pre-deep-link shape)', () => {
    assert.equal(interpretProfile('x', '123456789012').friendCode, '123456789012');
  });

  it('does not let disagreeing OCR text override a QR reading (QR wins)', () => {
    const text = 'MY TRAINER CODE\nDriftcoral42\n999988887777'; // a different, otherwise-valid code in the OCR text
    const verdict = interpretProfile(text, onelinkUrl('123456789012'));
    assert.deepEqual(verdict, { status: 'verified', handle: 'Driftcoral42', friendCode: '123456789012' });
  });
});

describe('interpretProfile — OCR-noise friend-code shapes (0-2 separators, no false long runs)', () => {
  it('reads a friend code tesseract ran together with no separator between the first two groups', () => {
    const text = 'MY TRAINER CODE\nDriftcoral42\n12345678 9012 (0) (C';
    assert.equal(interpretProfile(text).friendCode, '123456789012');
  });

  it('reads a friend code with two separator characters between groups', () => {
    const text = 'MY TRAINER CODE\nDriftcoral42\n1234  5678  9012';
    assert.equal(interpretProfile(text).friendCode, '123456789012');
  });

  it('never reads a 13-digit run as a friend code: no digit may sit against either edge of the match', () => {
    const text = 'MY TRAINER CODE\nDriftcoral42\n1234567890123';
    assert.equal(interpretProfile(text).friendCode, undefined);
  });

  it('never turns a run of QR-block noise (|, l, I with no real digits) into a friend code', () => {
    const text = 'MY TRAINER CODE\nDriftcoral42\nlIl|lIIl|lll';
    assert.equal(interpretProfile(text).friendCode, undefined);
  });

  it('does not let QR-block noise become a second, "ambiguous" candidate beside the real code', () => {
    const text = 'TRAINER CODE QR CODE\nDriftcoral42\n12345678 9012 (0) (C\n|||| llll IIII\nlIl|lIIl|lll';
    assert.deepEqual(interpretProfile(text), { status: 'verified', handle: 'Driftcoral42', friendCode: '123456789012' });
  });

  it('does not anchor the handle search on a noise line that merely fits the code shape', () => {
    // The noise line comes first; anchoring on it would look above it and miss the handle entirely.
    const text = 'MY TRAINER CODE\nlIl|lIIl|lll\nx\ny\nz\nDriftcoral42\n1234 5678 9012';
    assert.equal(interpretProfile(text).handle, 'Driftcoral42');
  });
});

describe('interpretProfile — the wrong screen (an appraisal, not the trainer-code screen)', () => {
  it('never reads a Pokémon name off an appraisal screen as the trainer handle', () => {
    // Real shape (identity and species aside): stat lines with no friend-code line and no "TRAINER CODE" /
    // "FRIEND CODE" header anywhere, so neither handle anchor fires. This is the bug the anchored search fixes:
    // an unanchored first-match-anywhere scan would have read "Mewtwo" here as the trainer's handle.
    const text = '> 2947\nMewtwo\nHP 165/165\nCP 2043\nCaught on 25/12/2019';
    assert.deepEqual(interpretProfile(text), { status: 'failed', reason: 'no_handle' });
  });
});
