import { type Page, expect } from '@playwright/test';

/** Collects page errors and console errors of a page (its workers included). */
export function collectErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('console', (message) => {
    const text = message.text();
    if (message.type() === 'error') errors.push(text);
  });
  return errors;
}

/** A relay room of its own for a test, so parallel WebRTC tests do not meet. */
export function uniqueRoom(prefix: string): string {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

/**
 * Presses Stop: once started and loaded, the button is folded into a bar, which a first press
 * unfolds (and presses right after unfolding do not count).
 */
export async function pressStop(page: Page): Promise<void> {
  await expect(async () => {
    const button = page.locator('#start');
    if ((await button.getAttribute('aria-label')) === 'Показать кнопку') await button.click();
    await page.getByRole('button', { name: 'Стоп' }).click({ timeout: 1000 });
    expect(await page.evaluate(() => window.__journey?.sourceState)).not.toBe('running');
  }).toPass({ timeout: 15_000 });
}
