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

  it('skips UI chrome stop-words and an all-digits line, and finds the real handle further down', () => {
    const text = 'FRIEND\nTRAINER\nCODE\n123456789012\nAshKetchum123\n1234 5678 9012';
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
    const text = 'AshKetchum123\nno code on this screen';
    assert.deepEqual(interpretProfile(text), { status: 'failed', reason: 'no_friend_code', handle: 'AshKetchum123' });
  });

  it('fails as no_handle with neither field when the screen is not a trainer-code screen at all', () => {
    assert.deepEqual(interpretProfile('POKEMON GO\nSETTINGS\nCLOSE'), { status: 'failed', reason: 'no_handle' });
  });
});
