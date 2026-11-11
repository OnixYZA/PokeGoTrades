import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('expo-router', () => ({ router: { canGoBack: vi.fn(), back: vi.fn(), replace: vi.fn() } }));

import { router } from 'expo-router';

import { goBack } from './navigation';

const mocked = vi.mocked(router);

describe('goBack', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('goes back when there is history', () => {
    mocked.canGoBack.mockReturnValue(true);
    goBack();
    expect(mocked.back).toHaveBeenCalledTimes(1);
    expect(mocked.replace).not.toHaveBeenCalled();
  });

  it('replaces with the default route when there is no history', () => {
    mocked.canGoBack.mockReturnValue(false);
    goBack();
    expect(mocked.back).not.toHaveBeenCalled();
    expect(mocked.replace).toHaveBeenCalledWith('/');
  });

  it('passes a custom fallback through', () => {
    mocked.canGoBack.mockReturnValue(false);
    goBack('/chats');
    expect(mocked.replace).toHaveBeenCalledWith('/chats');
  });
});
