import { describe, expect, it } from 'vitest';

import { describeError } from './rpc-errors';

describe('describeError', () => {
  it('maps the 20261112000100 rate-limit codes to their own sentences', () => {
    expect(describeError({ message: 'proof_rate_limited', code: 'PT429' })).toMatchObject({
      code: 'proof_rate_limited',
      sqlState: 'PT429',
      message: "You've uploaded a lot of screenshots in the last hour. Try again later.",
      followUp: 'none',
    });
    expect(describeError({ message: 'listing_rate_limited', code: 'PT429' })).toMatchObject({
      code: 'listing_rate_limited',
      sqlState: 'PT429',
      message: "You've posted a lot of listings in the last hour. Try again later.",
      followUp: 'none',
    });
  });

  it('falls back to the generic rate_limited for an unknown PT429 message', () => {
    expect(describeError({ message: 'something_new', code: 'PT429' })).toMatchObject({
      code: 'rate_limited',
      sqlState: 'PT429',
      message: 'You are doing that too fast. Try again in a moment.',
    });
  });

  it('leaves an existing code unchanged', () => {
    expect(describeError({ message: 'listing_not_open', code: 'PT409' })).toMatchObject({
      code: 'listing_not_open',
      message: 'This listing is no longer open. It may have been locked by another trainer.',
      followUp: 'resync',
    });
  });

  it('maps a network failure to network', () => {
    expect(describeError(new Error('Network request failed'))).toMatchObject({ code: 'network', followUp: 'none' });
  });
});
