import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const storageMocks = vi.hoisted(() => ({
  upload: vi.fn(),
  createSignedUrl: vi.fn(),
  from: vi.fn(),
}));

storageMocks.from.mockReturnValue({
  upload: storageMocks.upload,
  createSignedUrl: storageMocks.createSignedUrl,
});

vi.mock('@/lib/supabase', () => ({
  supabase: {
    storage: {
      from: storageMocks.from,
    },
  },
}));

import {
  CHAT_IMAGES_BUCKET,
  CHAT_IMAGE_SIGNED_URL_TTL_SECONDS,
  ChatApiError,
  chatImagePreviewText,
  chatImageStoragePath,
  clearChatImageUrlCache,
  getChatImageUrl,
  parseMessageEvent,
  toChatMessage,
  uploadChatImage,
  type MessageRow,
} from './chats';

const CHAT_ID = 'c0000000-0000-4000-8000-000000000001';
const ME_ID = 'a0000000-0000-4000-8000-000000000001';
const PARTNER_ID = 'a0000000-0000-4000-8000-000000000002';
const CLIENT_ID = 'd0000000-0000-4000-8000-000000000009';

describe('chat image helpers', () => {
  it('formats storage paths as <chatId>/<senderId>/<clientId>', () => {
    expect(chatImageStoragePath(CHAT_ID, ME_ID, CLIENT_ID)).toBe(`${CHAT_ID}/${ME_ID}/${CLIENT_ID}`);
  });

  it('builds inbox preview text for empty, whitespace-only, and non-empty captions', () => {
    expect(chatImagePreviewText()).toBe('📷 Photo');
    expect(chatImagePreviewText('')).toBe('📷 Photo');
    expect(chatImagePreviewText('   \t\n  ')).toBe('📷 Photo');
    expect(chatImagePreviewText('  Appraisal screenshot  ')).toBe('📷 Appraisal screenshot');
  });
});

describe('toChatMessage & parseMessageEvent', () => {
  it('maps image rows via toChatMessage', () => {
    const path = chatImageStoragePath(CHAT_ID, ME_ID, CLIENT_ID);
    const row: MessageRow = {
      id: 'm1',
      chat_id: CHAT_ID,
      sender_id: ME_ID,
      client_id: CLIENT_ID,
      kind: 'image',
      body: 'Lucky check',
      offer: null,
      image_path: path,
      system_event: null,
      created_at: '2026-11-14T12:00:00.000Z',
    };

    const msg = toChatMessage(row, ME_ID);
    expect(msg.kind).toBe('image');
    expect(msg.role).toBe('me');
    expect(msg.text).toBe('Lucky check');
    expect(msg.imagePath).toBe(path);
    expect(msg.clientId).toBe(CLIENT_ID);
  });

  it('accepts valid image events and rejects missing, null, or empty image_path', () => {
    const path = chatImageStoragePath(CHAT_ID, PARTNER_ID, CLIENT_ID);
    const base = {
      id: 'm2',
      chat_id: CHAT_ID,
      sender_id: PARTNER_ID,
      client_id: CLIENT_ID,
      kind: 'image',
      body: 'Here is the moveset',
      created_at: '2026-11-14T12:00:00.000Z',
    };

    const parsed = parseMessageEvent({ ...base, image_path: path }, ME_ID);
    expect(parsed).not.toBeNull();
    expect(parsed?.kind).toBe('image');
    expect(parsed?.role).toBe('them');
    expect(parsed?.imagePath).toBe(path);
    expect(parsed?.text).toBe('Here is the moveset');

    expect(parseMessageEvent({ ...base }, ME_ID)).toBeNull();
    expect(parseMessageEvent({ ...base, image_path: null }, ME_ID)).toBeNull();
    expect(parseMessageEvent({ ...base, image_path: '' }, ME_ID)).toBeNull();
  });

  it('parses text, offer, and system events', () => {
    const textMsg = parseMessageEvent(
      {
        id: 'm-text',
        chat_id: CHAT_ID,
        sender_id: ME_ID,
        client_id: CLIENT_ID,
        kind: 'text',
        body: 'Meet at 5pm?',
        created_at: '2026-11-14T12:00:00.000Z',
      },
      ME_ID,
    );
    expect(textMsg?.kind).toBe('text');
    expect(textMsg?.role).toBe('me');
    expect(textMsg?.text).toBe('Meet at 5pm?');

    const offerMsg = parseMessageEvent(
      {
        id: 'm-offer',
        chat_id: CHAT_ID,
        sender_id: PARTNER_ID,
        client_id: CLIENT_ID,
        kind: 'offer',
        body: '',
        offer: { name: 'Pikachu', pokemonId: 25, hue: 48, shiny: true },
        created_at: '2026-11-14T12:01:00.000Z',
      },
      ME_ID,
    );
    expect(offerMsg?.kind).toBe('offer');
    expect(offerMsg?.role).toBe('them');
    expect(offerMsg?.offer).toMatchObject({ name: 'Pikachu', pokemonId: 25, shiny: true });

    const sysMsg = parseMessageEvent(
      {
        id: 'm-sys',
        chat_id: CHAT_ID,
        sender_id: null,
        client_id: null,
        kind: 'system',
        body: 'Trade locked.',
        system_event: 'locked',
        created_at: '2026-11-14T12:02:00.000Z',
      },
      ME_ID,
    );
    expect(sysMsg?.kind).toBe('system');
    expect(sysMsg?.role).toBe('system');
    expect(sysMsg?.systemEvent).toBe('locked');
  });
});

describe('uploadChatImage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('uploads to chat-images at <chatId>/<senderId>/<clientId> with upsert: false and returns the path', async () => {
    storageMocks.upload.mockResolvedValue({ data: { path: 'ok' }, error: null });
    const data = new ArrayBuffer(8);

    const path = await uploadChatImage({
      chatId: CHAT_ID,
      senderId: ME_ID,
      clientId: CLIENT_ID,
      data,
      contentType: 'image/jpeg',
    });

    const expectedPath = `${CHAT_ID}/${ME_ID}/${CLIENT_ID}`;
    expect(path).toBe(expectedPath);
    expect(storageMocks.from).toHaveBeenCalledWith(CHAT_IMAGES_BUCKET);
    expect(storageMocks.upload).toHaveBeenCalledWith(expectedPath, data, {
      contentType: 'image/jpeg',
      upsert: false,
    });
  });

  it('treats 409 and already-exists errors as idempotent success', async () => {
    const expectedPath = `${CHAT_ID}/${ME_ID}/${CLIENT_ID}`;
    const data = new ArrayBuffer(4);

    storageMocks.upload.mockResolvedValueOnce({
      data: null,
      error: { message: 'Conflict', statusCode: '409' },
    });
    await expect(
      uploadChatImage({ chatId: CHAT_ID, senderId: ME_ID, clientId: CLIENT_ID, data, contentType: 'image/png' }),
    ).resolves.toBe(expectedPath);

    storageMocks.upload.mockResolvedValueOnce({
      data: null,
      error: { message: 'The resource already exists' },
    });
    await expect(
      uploadChatImage({ chatId: CHAT_ID, senderId: ME_ID, clientId: CLIENT_ID, data, contentType: 'image/png' }),
    ).resolves.toBe(expectedPath);
  });

  it('throws ChatApiError on non-409 errors', async () => {
    storageMocks.upload.mockResolvedValueOnce({
      data: null,
      error: { message: 'new row violates row-level security policy', statusCode: '403' },
    });

    await expect(
      uploadChatImage({
        chatId: CHAT_ID,
        senderId: ME_ID,
        clientId: CLIENT_ID,
        data: new ArrayBuffer(4),
        contentType: 'image/webp',
      }),
    ).rejects.toThrow(ChatApiError);
  });
});

describe('getChatImageUrl & clearChatImageUrlCache', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    clearChatImageUrlCache();
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-11-14T12:00:00.000Z'));
  });

  afterEach(() => {
    vi.useRealTimers();
    clearChatImageUrlCache();
  });

  it('signs URLs for 3600s and caches them within the 50m TTL', async () => {
    const path = `${CHAT_ID}/${ME_ID}/${CLIENT_ID}`;
    storageMocks.createSignedUrl
      .mockResolvedValueOnce({ data: { signedUrl: 'https://cdn.example/signed-1' }, error: null })
      .mockResolvedValueOnce({ data: { signedUrl: 'https://cdn.example/signed-2' }, error: null });

    await expect(getChatImageUrl(path)).resolves.toBe('https://cdn.example/signed-1');
    expect(storageMocks.from).toHaveBeenCalledWith(CHAT_IMAGES_BUCKET);
    expect(storageMocks.createSignedUrl).toHaveBeenCalledWith(path, CHAT_IMAGE_SIGNED_URL_TTL_SECONDS);
    expect(CHAT_IMAGE_SIGNED_URL_TTL_SECONDS).toBe(3600);

    // Within 50m TTL: served from cache without calling storage again.
    vi.advanceTimersByTime(49 * 60 * 1000);
    await expect(getChatImageUrl(path)).resolves.toBe('https://cdn.example/signed-1');
    expect(storageMocks.createSignedUrl).toHaveBeenCalledTimes(1);

    // Past 50m TTL: re-signs.
    vi.advanceTimersByTime(2 * 60 * 1000);
    await expect(getChatImageUrl(path)).resolves.toBe('https://cdn.example/signed-2');
    expect(storageMocks.createSignedUrl).toHaveBeenCalledTimes(2);
  });

  it('returns null without caching on errors or empty paths', async () => {
    const path = `${CHAT_ID}/${ME_ID}/${CLIENT_ID}`;
    await expect(getChatImageUrl('')).resolves.toBeNull();
    expect(storageMocks.createSignedUrl).not.toHaveBeenCalled();

    storageMocks.createSignedUrl
      .mockResolvedValueOnce({ data: null, error: { message: 'Object not found' } })
      .mockResolvedValueOnce({ data: { signedUrl: 'https://cdn.example/recovered' }, error: null });

    await expect(getChatImageUrl(path)).resolves.toBeNull();
    await expect(getChatImageUrl(path)).resolves.toBe('https://cdn.example/recovered');
    expect(storageMocks.createSignedUrl).toHaveBeenCalledTimes(2);
  });

  it('clears the cache via clearChatImageUrlCache', async () => {
    const path = `${CHAT_ID}/${ME_ID}/${CLIENT_ID}`;
    storageMocks.createSignedUrl
      .mockResolvedValueOnce({ data: { signedUrl: 'https://cdn.example/first' }, error: null })
      .mockResolvedValueOnce({ data: { signedUrl: 'https://cdn.example/second' }, error: null });

    await expect(getChatImageUrl(path)).resolves.toBe('https://cdn.example/first');
    clearChatImageUrlCache();
    await expect(getChatImageUrl(path)).resolves.toBe('https://cdn.example/second');
    expect(storageMocks.createSignedUrl).toHaveBeenCalledTimes(2);
  });
});
