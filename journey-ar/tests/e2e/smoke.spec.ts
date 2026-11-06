import { expect, test } from '@playwright/test';

test('renders the three.js scene without errors', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(message.text());
  });
  page.on('response', (response) => {
    if (response.status() >= 400) errors.push(`HTTP ${response.status()} ${response.url()}`);
  });

  await page.goto('/');
  await expect(page.locator('canvas#scene')).toBeVisible();
  await page.waitForFunction(() => (window.__journey?.framesRendered ?? 0) > 10);

  const hooks = await page.evaluate(() => window.__journey);
  expect(hooks?.ready).toBe(true);
  expect(hooks?.webglVersion).toBe(2);
  expect(hooks?.source).toEqual({ kind: 'camera' });
  expect(errors).toEqual([]);
});

test('switches the frame source with the URL parameter', async ({ page }) => {
  await page.goto('/?source=canvas');
  await page.waitForFunction(() => window.__journey?.ready === true);
  expect(await page.evaluate(() => window.__journey?.source)).toEqual({ kind: 'canvas' });
});
