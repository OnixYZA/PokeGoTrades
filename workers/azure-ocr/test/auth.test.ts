import assert from 'node:assert/strict';
import { afterEach, beforeEach, describe, it } from 'node:test';

import { isAuthorized } from '../src/core/auth';
import { readWorkerSecret } from '../src/core/env';

// 64 hex characters, the shape `openssl rand -hex 32` produces — same length the real Vault / Container App
// value will be, so these tests exercise the real code path rather than some other arbitrary length.
const SECRET = 'a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4';
const OTHER_SECRET = 'f6e5d4c3b2a1f6e5d4c3b2a1f6e5d4c3f6e5d4c3b2a1f6e5d4c3b2a1f6e5d4c3';

describe('isAuthorized', () => {
  it('accepts a header that matches the expected secret', () => {
    assert.equal(isAuthorized(SECRET, SECRET), true);
  });

  it('rejects a header that does not match, same length', () => {
    assert.equal(isAuthorized(OTHER_SECRET, SECRET), false);
    assert.equal(OTHER_SECRET.length, SECRET.length); // the interesting case: timingSafeEqual never sees unequal lengths
  });

  it('rejects a header that does not match, different length', () => {
    assert.equal(isAuthorized('short', SECRET), false);
    assert.equal(isAuthorized(`${SECRET}-extra`, SECRET), false);
  });

  it('rejects a missing header', () => {
    assert.equal(isAuthorized(null, SECRET), false);
    assert.equal(isAuthorized(undefined, SECRET), false);
  });

  it('rejects an empty header', () => {
    assert.equal(isAuthorized('', SECRET), false);
  });
});

describe('readWorkerSecret', () => {
  // process.env is global, shared mutable state; save and restore around every test so this file never leaks a
  // value into (or out of) whatever else runs in the same `tsx --test` process.
  const ORIGINAL = process.env.PGT_WORKER_SECRET;

  beforeEach(() => {
    delete process.env.PGT_WORKER_SECRET;
  });

  afterEach(() => {
    if (ORIGINAL === undefined) delete process.env.PGT_WORKER_SECRET;
    else process.env.PGT_WORKER_SECRET = ORIGINAL;
  });

  it('throws when unset', () => {
    assert.throws(() => readWorkerSecret(), /Missing environment variable PGT_WORKER_SECRET/);
  });

  it('throws when empty', () => {
    process.env.PGT_WORKER_SECRET = '';
    assert.throws(() => readWorkerSecret(), /Missing environment variable PGT_WORKER_SECRET/);
  });

  it('throws when shorter than 32 characters (rejects the placeholder from .env.example)', () => {
    process.env.PGT_WORKER_SECRET = 'your_custom_secret_here';
    assert.throws(() => readWorkerSecret(), /PGT_WORKER_SECRET must be at least 32 characters/);
  });

  it('returns the value when valid', () => {
    process.env.PGT_WORKER_SECRET = SECRET;
    assert.equal(readWorkerSecret(), SECRET);
  });
});
