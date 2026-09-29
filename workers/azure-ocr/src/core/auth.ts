/**
 * The one check standing between `src/functions/profileOcr.ts` and an anonymous internet request now that its
 * registration is `authLevel: 'anonymous'` (see that file's header comment for why: with `authLevel: 'function'`
 * the host itself rejected an unkeyed request before our handler ever ran, so this replaces that gate rather
 * than supplementing it) — pure and unit-tested on its own, apart from the HTTP plumbing around it.
 */
import { createHash, timingSafeEqual } from 'node:crypto';

/**
 * True only when `presented` (the `x-api-key` header) matches `expected` (`readWorkerSecret()`, `src/core/env.ts`).
 *
 * Hashes both sides with SHA-256 before comparing, for two reasons: it makes the two buffers passed to
 * `timingSafeEqual` a fixed, equal length regardless of how long either input string is — `timingSafeEqual`
 * itself throws on a length mismatch rather than safely returning `false` — and it means a wrong-length header
 * never short-circuits into a fast rejection that would otherwise leak the secret's real length.
 *
 * Missing or empty `presented` is `false` outright, before any hashing: there is nothing secret about "the
 * header was absent", so there is no timing signal worth protecting there.
 */
export function isAuthorized(presented: string | null | undefined, expected: string): boolean {
  if (!presented) return false;

  const presentedHash = createHash('sha256').update(presented).digest();
  const expectedHash = createHash('sha256').update(expected).digest();
  return timingSafeEqual(presentedHash, expectedHash);
}
