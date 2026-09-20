import { expect, test, type Browser, type BrowserContext, type Locator, type Page } from '@playwright/test';
import type { SupabaseClient } from '@supabase/supabase-js';

import { watchRealtime } from './support/realtime';
import { recordToasts, type ToastSighting } from './support/toasts';
import {
  adminClient,
  createListingFixture,
  DRIFTCORAL,
  MINTRUNNER,
  removeListingFixture,
  sessionStorageKey,
  signIn,
  type ListingFixture,
  type Trainer,
} from './support/supabase';

/**
 * The two-device script (SUPABASE_PLAN.md §5.4) with one buyer, run headlessly against the web export and
 * the local Supabase stack: an offer arrives in the seller's inbox live, the seller locks it, the buyer's
 * Handshake opens by itself, and the trade completes once *both* trainers confirm (D2).
 *
 * Needs: Docker + the local stack (`npx supabase start -x logflare,vector`), the seeded database
 * (`npm run db:reset`), and Chromium (`npx playwright install chromium`). Run with `npm run e2e`.
 *
 * Each run makes its own listing for DriftCoral (unique name) and deletes it afterwards, so the seed stays
 * as it was and the test can be run again straight away.
 */

const runId = Date.now().toString(36);
const TEST_MESSAGE = `Ready when you are ${runId}`;

interface Device {
  trainer: Trainer;
  context: BrowserContext;
  page: Page;
  /** Console errors and uncaught exceptions, attached to the report when the test fails. */
  problems: string[];
  /** `performance.timeOrigin` after the first load: it only changes on a full page load. */
  bootedAt: number;
  toasts: () => Promise<ToastSighting[]>;
}

const devices: Device[] = [];

/** A separate browser context (own storage, own WebSocket) already signed in as `trainer`. */
async function openDevice(browser: Browser, origin: string, trainer: Trainer): Promise<Device> {
  const session = await signIn(trainer);
  const context = await browser.newContext({
    storageState: {
      cookies: [],
      origins: [{ origin, localStorage: [{ name: sessionStorageKey(), value: JSON.stringify(session) }] }],
    },
  });
  const page = await context.newPage();
  const problems: string[] = [];
  page.on('pageerror', (error) => problems.push(`pageerror: ${error.message}`));
  page.on('console', (message) => {
    if (message.type() === 'error') problems.push(`console.error: ${message.text()}`);
  });
  const realtime = watchRealtime(page);
  const toasts = await recordToasts(page);

  await page.goto('/');
  await expect(page.getByRole('tab', { name: 'Feed' })).toBeVisible();
  // Acting on the other device before this one has joined would let the app's gap-fill mask a missed event.
  await realtime.joined(`user:${trainer.id}`);

  const device: Device = {
    trainer,
    context,
    page,
    problems,
    bootedAt: await page.evaluate(() => performance.timeOrigin),
    toasts: toasts.seen,
  };
  devices.push(device);
  return device;
}

/** Tabs and earlier screens stay mounted underneath the current one, and `getByText` also matches hidden nodes. */
const shown = (locator: Locator) => locator.filter({ visible: true });
const handshake = (page: Page) => shown(page.getByText('Exchange Friend Codes'));

/**
 * Opens a listing from the feed by tapping its artwork. Known web bug (ListingCard): the text column carries
 * `style={{ pointerEvents: 'box-none' }}`, which NativeWind emits as inline CSS the browser rejects, so that
 * column stays `pointer-events: auto` and swallows taps meant for the card's tap-target underlay. Only the
 * artwork side reaches the underlay. This keeps working once the card is fixed.
 */
async function openListing(page: Page, name: string): Promise<void> {
  const title = shown(page.getByText(name, { exact: true }));
  await expect(title).toBeVisible();
  const box = await title.boundingBox();
  if (!box) throw new Error(`"${name}" has no box on screen`);
  test.info().annotations.push({
    type: 'known-issue',
    description: 'ListingCard: taps on the text column do not open the listing on web (pointerEvents "box-none" in style).',
  });
  await page.mouse.click(box.x - 45, box.y + box.height / 2);
}

let admin: SupabaseClient;
let fixture: ListingFixture | undefined;

test.beforeAll(async () => {
  admin = adminClient();
  fixture = await createListingFixture(admin, DRIFTCORAL, runId);
});

test.afterAll(async () => {
  if (fixture) await removeListingFixture(admin, fixture.id, [DRIFTCORAL, MINTRUNNER]);
});

test.afterEach(async ({}, testInfo) => {
  const failed = testInfo.status !== testInfo.expectedStatus;
  for (const device of devices.splice(0)) {
    if (!failed) continue;
    const label = device.trainer.handle;
    await testInfo.attach(`${label}-console`, { body: device.problems.join('\n') || '(no errors)', contentType: 'text/plain' });
    await device.page
      .screenshot({ path: testInfo.outputPath(`${label}.png`) })
      .then(() => testInfo.attach(`${label}-screen`, { path: testInfo.outputPath(`${label}.png`), contentType: 'image/png' }))
      .catch(() => undefined);
    console.log(`[${label}] browser problems:\n${device.problems.join('\n') || '(none)'}`);
    console.log(`[${label}] toasts seen: ${JSON.stringify(await device.toasts().catch(() => []))}`);
  }
});

test('two-device trade: offer → live inbox → lock → handshake → both confirm', async ({ browser, baseURL }) => {
  if (!fixture) throw new Error('The listing fixture was not created.');
  if (!baseURL) throw new Error('baseURL is not configured.');
  const listing = fixture;
  const origin = new URL(baseURL).origin;

  const seller = await openDevice(browser, origin, DRIFTCORAL);
  const buyer = await openDevice(browser, origin, MINTRUNNER);
  let chatId = '';

  await test.step('Seller (DriftCoral) opens the inbox', async () => {
    await seller.page.getByRole('tab', { name: 'Chats' }).click();
    await expect(seller.page.getByText('Your Chats', { exact: true })).toBeVisible();
    // Nobody has made an offer on the new listing yet.
    await expect(shown(seller.page.getByText(listing.name, { exact: true }))).toHaveCount(0);
  });

  await test.step('Buyer (MintRunner) finds the listing in the feed and makes an offer', async () => {
    await openListing(buyer.page, listing.name);
    await buyer.page.getByRole('button', { name: 'Make Offer' }).click();
    await buyer.page.getByRole('radio', { name: listing.wanted }).click();
    await buyer.page.getByRole('button', { name: 'Send offer' }).click();

    // `open_offer` returned a chat id and the app navigated straight to it.
    await expect(buyer.page).toHaveURL(/\/chats\/[0-9a-f-]{36}$/);
    chatId = buyer.page.url().split('/').pop() ?? '';
    await expect(shown(buyer.page.getByText(DRIFTCORAL.handle, { exact: true })).first()).toBeVisible();
    await expect(shown(buyer.page.getByText(listing.wanted)).first()).toBeVisible();
  });

  await test.step('Buyer sends a test message', async () => {
    await buyer.page.getByRole('textbox', { name: 'Message', exact: true }).fill(TEST_MESSAGE);
    await buyer.page.getByRole('button', { name: 'Send message' }).click();
    await expect(shown(buyer.page.getByText(TEST_MESSAGE))).toBeVisible();
    await expect(buyer.page.getByText('Sending…')).toHaveCount(0); // the server confirmed it: no longer pending
    await expect(buyer.page.getByText('Not sent · Tap to retry')).toHaveCount(0);
  });

  const inboxRow = seller.page
    .getByRole('button', { name: `Chat with ${MINTRUNNER.handle}`, exact: false })
    .filter({ hasText: TEST_MESSAGE });

  await test.step('Seller sees the offer and the message in the inbox with no refresh', async () => {
    await expect(shown(seller.page.getByText(listing.name, { exact: true }))).toBeVisible();
    await expect(inboxRow).toBeVisible();
    await expect(inboxRow).toHaveAccessibleName(/unread/);
  });

  await test.step('Seller opens the chat and clicks "Accept Trade (Lock)"', async () => {
    await inboxRow.click();
    await expect(seller.page).toHaveURL(new RegExp(`/chats/${chatId}$`));
    await expect(shown(seller.page.getByText(TEST_MESSAGE))).toBeVisible();
    await seller.page.getByRole('button', { name: 'Accept Trade (Lock)' }).click();
  });

  await test.step('Seller: the Handshake opens with real friend codes', async () => {
    await expect(handshake(seller.page)).toBeVisible();
    await expect(seller.page.getByText(MINTRUNNER.friendCode)).toBeVisible();
    await expect(seller.page.getByText(DRIFTCORAL.friendCode)).toBeVisible();
  });

  await test.step('Buyer: the lock arrives live and the Handshake opens by itself', async () => {
    await expect(handshake(buyer.page)).toBeVisible();
    await expect(buyer.page.getByText(DRIFTCORAL.friendCode)).toBeVisible();
    await expect(buyer.page.getByText(MINTRUNNER.friendCode)).toBeVisible();
  });

  await test.step('Buyer: back in the chat, the "Trade Locked" banner is showing', async () => {
    await buyer.page.getByRole('button', { name: 'Return to chat' }).click();
    await expect(handshake(buyer.page)).toBeHidden();
    await expect(shown(buyer.page.getByText('TRADE LOCKED', { exact: true }))).toBeVisible();
    await expect(buyer.page.getByText(`${DRIFTCORAL.handle} accepted your offer. Meet within 24h.`)).toBeVisible();
    // The buyer cannot lock or unlock (D1); the action row says who holds the lock, and reopens the Handshake.
    await buyer.page.getByRole('button', { name: 'Locked by seller' }).click();
    await expect(handshake(buyer.page)).toBeVisible();
  });

  await test.step('Buyer clicks "Mark Trade Completed" and waits for the seller (D2)', async () => {
    await buyer.page.getByRole('button', { name: 'Mark Trade Completed' }).click();
    await expect(buyer.page.getByRole('button', { name: `Waiting for ${DRIFTCORAL.handle} to confirm` })).toBeDisabled();
    await expect(buyer.page.getByRole('button', { name: 'Withdraw confirmation' })).toBeVisible();
  });

  await test.step('Seller sees the buyer\'s confirmation live, confirms, and the trade completes for both', async () => {
    const confirm = seller.page.getByRole('button', { name: new RegExp(`${MINTRUNNER.handle} confirmed`) });
    await expect(confirm).toBeVisible();
    await confirm.click();
    for (const device of [seller, buyer]) {
      // A success toast only lives a couple of seconds, so read what was recorded rather than race it.
      await expect
        .poll(async () => (await device.toasts()).find((toast) => toast.text === 'Trade completed.')?.visible, {
          message: `${device.trainer.handle} should have seen the "Trade completed." toast`,
        })
        .toBe(true);
      await expect(handshake(device.page)).toBeHidden();
    }
  });

  await test.step('Both trainers are sent back a screen, and the completed offer is gone', async () => {
    // The Handshake's `onCompleted` goes back a screen: the seller to the inbox, the buyer to the feed the offer was made from.
    await expect(shown(seller.page.getByText('Your Chats', { exact: true }))).toBeVisible();
    await expect(shown(buyer.page.getByText('Near you', { exact: true }))).toBeVisible();
    // The listing was traded, so it has left the buyer's feed without a refresh (`listing_status`).
    await expect(shown(buyer.page.getByText(listing.name, { exact: true }))).toHaveCount(0);

    await buyer.page.getByRole('tab', { name: 'Chats' }).click();
    await expect(shown(buyer.page.getByText('Your Chats', { exact: true }))).toBeVisible();
    for (const device of [seller, buyer]) {
      // The chat is archived for both trainers on completion (`confirm_trade`), so the offer is gone from the inbox.
      await expect(shown(device.page.getByText(listing.name, { exact: true }))).toHaveCount(0);
    }
  });

  await test.step('The server agrees: one completed trade, the listing closed, the chat completed', async () => {
    const { data: row } = await admin.from('listings').select('status').eq('id', listing.id).single();
    expect(row?.status).toBe('completed');

    const { data: trades } = await admin.from('completed_trades').select('seller_id, buyer_id, chat_id').eq('listing_id', listing.id);
    expect(trades).toHaveLength(1);
    expect(trades?.[0]).toMatchObject({ seller_id: DRIFTCORAL.id, buyer_id: MINTRUNNER.id, chat_id: chatId });

    const { data: chat } = await admin.from('chats').select('status').eq('id', chatId).single();
    expect(chat?.status).toBe('completed');
  });

  await test.step('Neither device ever reloaded the page', async () => {
    for (const device of [seller, buyer]) {
      expect(await device.page.evaluate(() => performance.timeOrigin), `${device.trainer.handle} reloaded`).toBe(device.bootedAt);
    }
  });
});
