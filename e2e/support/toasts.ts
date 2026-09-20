import type { Page } from '@playwright/test';

export interface ToastSighting {
  text: string;
  /** Whether it was ever laid out and not `visibility: hidden`, i.e. the same test Playwright's `toBeVisible` applies. */
  visible: boolean;
}

/**
 * Toasts live a couple of seconds, and only the newest `<ToastHost>` renders them, so polling for one on screen
 * can race its lifetime. This records every `role="alert"` that enters the DOM, and whether it was ever
 * visible, so a test can assert "the toast appeared" without depending on timing. Attach before `page.goto`.
 */
export async function recordToasts(page: Page) {
  await page.addInitScript(() => {
    const seen: { text: string; visible: boolean }[] = [];
    (window as unknown as { __toasts: typeof seen }).__toasts = seen;
    const scan = () => {
      for (const node of Array.from(document.querySelectorAll('[role="alert"]'))) {
        const el = node as HTMLElement;
        const text = el.textContent?.trim();
        if (!text) continue;
        const visible = el.getClientRects().length > 0 && getComputedStyle(el).visibility !== 'hidden';
        const known = seen.find((toast) => toast.text === text);
        if (!known) seen.push({ text, visible });
        else if (visible) known.visible = true;
      }
    };
    new MutationObserver(scan).observe(document, { subtree: true, childList: true, characterData: true, attributes: true });
  });

  return {
    seen: (): Promise<ToastSighting[]> =>
      page.evaluate(() => (window as unknown as { __toasts?: ToastSighting[] }).__toasts ?? []),
  };
}
