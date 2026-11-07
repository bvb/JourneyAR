import { type Page, expect, test } from '@playwright/test';
import { SPATIAL } from '../../src/audio/loop-bounds';
import { collectErrors } from './helpers';

/** Gain of the inverse distance model (as the app's PannerNode is set up). */
function distanceGainAt(distance: number): number {
  const d = Math.min(Math.max(distance, SPATIAL.refDistance), SPATIAL.maxDistance);
  return (
    SPATIAL.refDistance / (SPATIAL.refDistance + SPATIAL.rolloffFactor * (d - SPATIAL.refDistance))
  );
}

// Scene sound through the embedded virtual camera (?source=canvas). The levels come from two
// analysers in the audio graph: before ("dry") and after ("wet") the spatialization, so their
// ratio is the gain the distance and direction apply, whatever the music does.

async function start(page: Page): Promise<string[]> {
  const errors = collectErrors(page);
  await page.goto('/?source=canvas');
  await page.getByRole('button', { name: 'Старт' }).click();
  await page.waitForFunction(() => window.__journey?.tracking.ready === true, null, {
    timeout: 60_000,
  });
  return errors;
}

async function showPage(page: Page, id: string | null, distance = 300): Promise<void> {
  await page.evaluate(
    async ({ id, distance }) => {
      window.__vcam!.setPose({ target: [0, 0], distance, tilt: 0, azimuth: 0, roll: 0 });
      await window.__vcam!.setPage(id);
    },
    { id, distance },
  );
}

const audio = (page: Page) => page.evaluate(() => window.__journey!.audio!);

test('plays the track of the found page from the start and stops it when the page is lost', async ({
  page,
}) => {
  test.setTimeout(90_000);
  const errors = await start(page);
  expect((await audio(page)).unlocked).toBe(true);

  await showPage(page, 'architecture');
  await expect
    .poll(async () => (await audio(page)).playing, { timeout: 30_000 })
    .toBe('architecture');
  await expect.poll(async () => (await audio(page)).levels.wet).toBeGreaterThan(0.001);
  await expect
    .poll(async () => (await audio(page)).position, { timeout: 10_000 })
    .toBeGreaterThan(2.5);

  // Lost: the sound fades out at once.
  await showPage(page, null);
  await expect.poll(async () => (await audio(page)).playing).toBeNull();
  await expect.poll(async () => (await audio(page)).levels.wet).toBeLessThan(0.0001);

  // Found again: the track starts from the beginning (it had played for more than 2.5 s).
  await showPage(page, 'architecture');
  await expect
    .poll(async () => (await audio(page)).playing, { timeout: 30_000 })
    .toBe('architecture');
  expect((await audio(page)).position).toBeLessThan(1.5);
  expect(errors).toEqual([]);
});

test('turns the volume down smoothly as the camera moves away', async ({ page }) => {
  test.setTimeout(90_000);
  await start(page);
  await showPage(page, 'creature', 300);
  await expect.poll(async () => (await audio(page)).playing, { timeout: 30_000 }).toBe('creature');
  await expect.poll(async () => (await audio(page)).levels.dry).toBeGreaterThan(0.002);

  const samples = await page.evaluate(async () => {
    const vcam = window.__vcam!;
    const journey = window.__journey!;
    const frame = () => new Promise(requestAnimationFrame);
    const out: { time: number; distance: number; ratio: number; position: number }[] = [];
    // Steady at 30 cm, then 3 s moving away to 90 cm, then steady.
    for (let i = 0; i < 30; i += 1) await frame();
    const start = performance.now();
    for (;;) {
      const k = Math.min((performance.now() - start) / 3000, 1);
      vcam.setPose({ distance: 300 + 600 * k });
      await frame();
      const state = journey.audio!;
      if (state.levels.dry > 0.002) {
        out.push({
          time: performance.now() / 1000,
          distance: state.distance ?? 0,
          ratio: state.levels.wet / state.levels.dry,
          position: state.position,
        });
      }
      if (performance.now() - start > 4000) break;
    }
    return out;
  });

  const first = samples.slice(0, 5);
  const last = samples.slice(-5);
  const mean = (list: typeof samples) => list.reduce((s, x) => s + x.ratio, 0) / list.length;
  // Full volume at reading distance; about 0.45 at 90 cm (inverse model, rolloff 0.6).
  expect(mean(first)).toBeGreaterThan(0.9);
  expect(mean(last)).toBeGreaterThan(0.35);
  expect(mean(last)).toBeLessThan(0.6);
  // Smooth: the volume follows the distance continuously, so at every frame it matches the
  // inverse model for the current distance (within the 0.1 s glide), whatever the frame timing;
  // and the track kept playing (no restart; the audio clock advances in blocks, so two frames
  // may see the same time).
  for (const sample of samples) {
    const expected = distanceGainAt(sample.distance);
    expect(Math.abs(sample.ratio - expected)).toBeLessThan(0.12);
  }
  for (let i = 1; i < samples.length; i += 1) {
    expect(samples[i]!.position).toBeGreaterThanOrEqual(samples[i - 1]!.position);
  }
  expect(samples.at(-1)!.position - samples[0]!.position).toBeGreaterThan(3);
});
