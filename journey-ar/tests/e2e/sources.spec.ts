import { type Page, expect, test } from '@playwright/test';
import { collectErrors, uniqueRoom } from './helpers';

const VCAM_URL = 'https://localhost:5174/';
const RECORDING = 'vcam-architecture-orbit';

/** Mean luminance (0-255) of what the app's video element currently shows. */
function videoLuminance(page: Page): Promise<number> {
  return page.evaluate(() => {
    const video = document.querySelector<HTMLVideoElement>('#video')!;
    const canvas = document.createElement('canvas');
    canvas.width = 64;
    canvas.height = 48;
    const ctx = canvas.getContext('2d', { willReadFrequently: true })!;
    ctx.drawImage(video, 0, 0, 64, 48);
    const data = ctx.getImageData(0, 0, 64, 48).data;
    let sum = 0;
    for (let i = 0; i < data.length; i += 4) sum += (data[i]! + data[i + 1]! + data[i + 2]!) / 3;
    return sum / (64 * 48);
  });
}

async function startSource(page: Page): Promise<void> {
  await page.getByRole('button', { name: 'Старт' }).click();
  await page.waitForFunction(
    () => window.__journey?.sourceState === 'running' && window.__journey.videoFrames > 5,
  );
}

test('does not start the camera before the user presses Start', async ({ page }) => {
  await page.goto('/');
  await page.waitForFunction(() => window.__journey?.ready === true);
  expect(await page.evaluate(() => window.__journey?.sourceState)).toBe('idle');
  await expect(page.getByRole('button', { name: 'Старт' })).toBeVisible();
});

test('plays the embedded virtual camera with ?source=canvas', async ({ page }) => {
  const errors = collectErrors(page);
  await page.goto('/?source=canvas');
  await startSource(page);
  expect(await page.evaluate(() => window.__journey?.videoSize)).toEqual([640, 480]);

  // The stream follows the virtual camera: a page close up is bright, the bare table dark.
  await page.evaluate(async () => {
    await window.__vcam!.setPage('creature');
    window.__vcam!.setPose({ target: [0, 0], distance: 250, tilt: 0, azimuth: 0, roll: 0 });
  });
  await expect.poll(() => videoLuminance(page)).toBeGreaterThan(150);
  await page.evaluate(() => window.__vcam!.setPage(null));
  await expect.poll(() => videoLuminance(page)).toBeLessThan(110);

  await page.getByRole('button', { name: 'Стоп' }).click();
  expect(await page.evaluate(() => window.__journey?.sourceState)).toBe('idle');
  expect(errors).toEqual([]);
});

test('plays a recording with ?source=video', async ({ page }) => {
  const errors = collectErrors(page);
  await page.goto(`/?source=video&src=/__recordings/${RECORDING}.webm`);
  await startSource(page);
  expect(await page.evaluate(() => window.__journey?.videoSize)).toEqual([640, 480]);
  expect(await videoLuminance(page)).toBeGreaterThan(100);
  expect(errors).toEqual([]);
});

test('receives the virtual camera over WebRTC with ?source=webrtc', async ({ browser }) => {
  const context = await browser.newContext({ ignoreHTTPSErrors: true });
  const room = uniqueRoom('webrtc');
  const vcam = await context.newPage();
  await vcam.goto(`${VCAM_URL}?room=${room}`);
  await vcam.waitForFunction(() => window.__vcam?.ready === true);

  const app = await context.newPage();
  const errors = collectErrors(app);
  await app.goto(`https://localhost:5173/?source=webrtc&room=${room}`);
  await startSource(app);
  expect(await app.evaluate(() => window.__journey?.videoSize)).toEqual([640, 480]);

  await vcam.evaluate(async () => {
    await window.__vcam!.setPage('creature');
    window.__vcam!.setPose({ target: [0, 0], distance: 250, tilt: 0, azimuth: 0, roll: 0 });
  });
  await expect.poll(() => videoLuminance(app)).toBeGreaterThan(150);
  await vcam.evaluate(() => window.__vcam!.setPage(null));
  await expect.poll(() => videoLuminance(app)).toBeLessThan(110);
  expect(errors).toEqual([]);
  await context.close();
});
