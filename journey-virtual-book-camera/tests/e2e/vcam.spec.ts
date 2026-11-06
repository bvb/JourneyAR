import { type Page, expect, test } from '@playwright/test';
import { readFileSync, rmSync, statSync } from 'node:fs';
import path from 'node:path';

/** Opens the virtual camera, collecting page errors, console errors and failed requests. */
async function open(page: Page): Promise<string[]> {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(message.text());
  });
  page.on('response', (response) => {
    if (response.status() >= 400) errors.push(`HTTP ${response.status()} ${response.url()}`);
  });
  await page.goto('/');
  await page.waitForFunction(() => window.__vcam?.ready === true);
  return errors;
}

test('starts with the first page and renders frames', async ({ page }) => {
  const errors = await open(page);
  const state = await page.evaluate(() => ({
    pages: window.__vcam!.pages,
    page: window.__vcam!.getPage(),
    frame: window.__vcam!.getFrame(),
  }));
  expect(state.pages).toEqual(['character', 'creature', 'landscape', 'architecture', 'sequence']);
  expect(state.page).toBe('character');
  expect(state.frame).toMatchObject({ width: 640, height: 480 });
  await page.waitForFunction(() => window.__vcam!.framesRendered > 10);
  expect(errors).toEqual([]);
});

// The rendered page must be exactly where the ground truth puts it: the white margins of the
// Creature page lie inside the projected page corners, the dark table just outside them.
test('renders the page where the ground truth says', async ({ page }) => {
  await open(page);
  const samples = await page.evaluate(async () => {
    const vcam = window.__vcam!;
    vcam.setPaused(true);
    await vcam.setPage('creature');
    vcam.setFrame({ width: 640, height: 480, fov: 49.4 });
    vcam.setPose({ target: [0, -5], distance: 420, tilt: 30, azimuth: 15, roll: 10 });
    vcam.renderFrame();
    const copy = document.createElement('canvas');
    copy.width = 640;
    copy.height = 480;
    const ctx = copy.getContext('2d')!;
    ctx.drawImage(vcam.canvas, 0, 0);
    const luminance = (point: [number, number, number]) => {
      const [u, v] = vcam.project(point)!;
      const [r, g, b] = ctx.getImageData(Math.round(u), Math.round(v), 1, 1).data;
      return (r! + g! + b!) / 3;
    };
    // Top-left, bottom-left and bottom-right corners are white margins on this page.
    const corners: [number, number][] = [
      [-151.5, 113],
      [-151.5, -113],
      [151.5, -113],
    ];
    return corners.map(([x, y]) => ({
      inside: luminance([x - Math.sign(x) * 8, y - Math.sign(y) * 8, 0]),
      outside: luminance([x + Math.sign(x) * 8, y + Math.sign(y) * 8, 0]),
    }));
  });
  for (const { inside, outside } of samples) {
    expect(inside).toBeGreaterThan(200);
    expect(outside).toBeLessThan(150);
  }
});

test('reports the page leaving the frame and frames without a page', async ({ page }) => {
  await open(page);
  const result = await page.evaluate(async () => {
    const vcam = window.__vcam!;
    await vcam.setPage('landscape');
    vcam.setPose({ target: [0, 0], distance: 600, tilt: 0, azimuth: 0, roll: 0 });
    const whole = vcam.getGroundTruth().pageInView;
    vcam.setPose({ target: [600, 0], distance: 300 });
    const outside = vcam.getGroundTruth().pageInView;
    vcam.setPose({ target: [0, 0] });
    await vcam.setPage(null);
    const truth = vcam.getGroundTruth();
    return { whole, outside, page: truth.page, empty: truth.pageInView };
  });
  expect(result).toEqual({ whole: 1, outside: 0, page: null, empty: 0 });
});

test('switches pages with the keys 0-5 and the buttons', async ({ page }) => {
  await open(page);
  await page.keyboard.press('4');
  await expect.poll(() => page.evaluate(() => window.__vcam!.getPage())).toBe('architecture');
  await page.keyboard.press('0');
  await expect.poll(() => page.evaluate(() => window.__vcam!.getPage())).toBeNull();
  await page.getByRole('button', { name: /Sequence/ }).click();
  await expect.poll(() => page.evaluate(() => window.__vcam!.getPage())).toBe('sequence');
});

test('moves the camera with the presets and the fields', async ({ page }) => {
  await open(page);
  await page.getByRole('button', { name: '45°' }).click();
  expect(await page.evaluate(() => window.__vcam!.getPose())).toMatchObject({
    tilt: 45,
    distance: 400,
  });
  const distance = page.getByRole('spinbutton', { name: 'Расстояние, мм' });
  await distance.fill('520');
  await distance.press('Enter');
  expect(await page.evaluate(() => window.__vcam!.getPose().distance)).toBe(520);
});

test('records a clip with the ground truth of every frame', async ({ page }) => {
  await open(page);
  const saved = await page.evaluate(async () => {
    const vcam = window.__vcam!;
    await vcam.setPage('architecture');
    vcam.startRecording();
    const start = performance.now();
    await new Promise<void>((resolve) => {
      const step = () => {
        const t = (performance.now() - start) / 1000;
        vcam.setPose({ distance: 350, tilt: 20, azimuth: -20 + 30 * t, roll: 0 });
        if (t < 1.5) requestAnimationFrame(step);
        else resolve();
      };
      step();
    });
    return vcam.stopRecording('e2e-recording');
  });
  expect(saved.frames).toBeGreaterThan(20);
  expect(saved.seconds).toBeGreaterThan(1.2);

  // Saved by the dev server next to its ground truth; removed again so the test leaves no trace.
  const root = path.resolve('..');
  const video = path.join(root, saved.path);
  const truth = video.replace(/\.webm$/, '.json');
  try {
    expect(statSync(video).size).toBeGreaterThan(10_000);
    const samples = JSON.parse(readFileSync(truth, 'utf8')).samples as { modelView: number[] }[];
    expect(samples.length).toBe(saved.frames);
    expect(samples[0]!.modelView).toHaveLength(16);
  } finally {
    rmSync(video, { force: true });
    rmSync(truth, { force: true });
  }
});
