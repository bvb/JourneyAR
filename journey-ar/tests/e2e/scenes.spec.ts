import { type Page, expect, test } from '@playwright/test';
import { collectErrors } from './helpers';

// The AR scenes on the tracked page, through the embedded virtual camera (?source=canvas).

const SCENES = ['character', 'creature', 'landscape', 'architecture', 'sequence'];
const VIEW = { target: [0, 0] as [number, number], distance: 450, tilt: 35, azimuth: 0, roll: 0 };

async function start(page: Page): Promise<string[]> {
  const errors = collectErrors(page);
  await page.goto('/?source=canvas');
  await page.getByRole('button', { name: 'Старт' }).click();
  await page.waitForFunction(() => window.__journey?.tracking.ready === true, null, {
    timeout: 60_000,
  });
  return errors;
}

async function showPage(page: Page, id: string | null): Promise<void> {
  await page.evaluate(
    async ({ id, view }) => {
      window.__vcam!.setPose(view);
      await window.__vcam!.setPage(id);
    },
    { id, view: VIEW },
  );
}

test('shows the scene of every page on it', async ({ page }, info) => {
  test.setTimeout(120_000);
  const errors = await start(page);
  for (const id of SCENES) {
    await showPage(page, id);
    await page.waitForFunction(
      (id) => window.__journey!.scenes.active === id && window.__journey!.scenes.shown,
      id,
      { timeout: 30_000 },
    );
    await page.waitForFunction(() => window.__journey!.trianglesRendered > 1000);
    await info.attach(`ar-${id}`, { body: await page.screenshot(), contentType: 'image/png' });
  }
  expect(errors).toEqual([]);
});

test('hides the scene in the frame the page is lost and restarts it on return', async ({
  page,
}) => {
  test.setTimeout(60_000);
  await start(page);
  await showPage(page, 'creature');
  await page.waitForFunction(() => window.__journey!.scenes.shown, null, { timeout: 30_000 });
  await page.waitForFunction(() => window.__journey!.scenes.time > 1.5);

  // Lose the page: the scene goes in the same update as the tracker's "lost".
  const lost = await page.evaluate(async () => {
    const journey = window.__journey!;
    await window.__vcam!.setPage(null);
    await new Promise<void>((resolve) => {
      const check = () =>
        journey.tracking.scene === null ? resolve() : requestAnimationFrame(check);
      check();
    });
    const atLoss = { ...journey.scenes };
    await new Promise(requestAnimationFrame);
    await new Promise(requestAnimationFrame);
    return { atLoss, triangles: journey.trianglesRendered };
  });
  expect(lost.atLoss).toMatchObject({ active: null, shown: false });
  expect(lost.triangles).toBe(0);

  // Back to the page: the animations start again from the beginning.
  await showPage(page, 'creature');
  await page.waitForFunction(() => window.__journey!.scenes.shown, null, { timeout: 10_000 });
  expect(await page.evaluate(() => window.__journey!.scenes.time)).toBeLessThan(0.5);
});
