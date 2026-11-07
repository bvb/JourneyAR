import { type CDPSession, type Page, expect, test } from '@playwright/test';

// Pinch to scale the shown scene, through the embedded virtual camera (?source=canvas).
// Touch is emulated with the DevTools protocol (two touch points), which Edge and Chromium both
// turn into pointer events like a real touch screen.

test.use({ hasTouch: true });

const VIEW = { target: [0, 0] as [number, number], distance: 450, tilt: 35, azimuth: 0, roll: 0 };

async function showScene(page: Page, id: string): Promise<void> {
  await page.evaluate(
    async ({ id, view }) => {
      window.__vcam!.setPose(view);
      await window.__vcam!.setPage(id);
    },
    { id, view: VIEW },
  );
  await page.waitForFunction(
    (id) => window.__journey!.scenes.active === id && window.__journey!.scenes.shown,
    id,
    {
      timeout: 30_000,
    },
  );
}

async function start(page: Page): Promise<void> {
  await page.goto('/?source=canvas');
  await page.getByRole('button', { name: 'Старт' }).click();
  await page.waitForFunction(() => window.__journey?.tracking.ready === true, null, {
    timeout: 60_000,
  });
}

/** Two fingers moving apart from `from` to `to` px around the screen centre. */
async function pinch(page: Page, cdp: CDPSession, from: number, to: number, release = true) {
  const { width, height } = page.viewportSize()!;
  const cx = width / 2;
  const cy = height / 3;
  const points = (d: number) => [
    { x: cx - d / 2, y: cy, id: 0 },
    { x: cx + d / 2, y: cy, id: 1 },
  ];
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: points(from) });
  for (let i = 1; i <= 10; i += 1) {
    await cdp.send('Input.dispatchTouchEvent', {
      type: 'touchMove',
      touchPoints: points(from + ((to - from) * i) / 10),
    });
  }
  if (release) await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
}

const scale = (page: Page) => page.evaluate(() => window.__journey!.scenes.scale);

test('scales the scene with two fingers within its limits', async ({ page }) => {
  test.setTimeout(90_000);
  await start(page);
  await showScene(page, 'architecture');
  const cdp = await page.context().newCDPSession(page);

  await pinch(page, cdp, 100, 200);
  await expect.poll(() => scale(page)).toBeCloseTo(2, 1);
  // Architecture allows up to 3.22 times its size (the original PinchScale limits).
  await pinch(page, cdp, 100, 400);
  await expect.poll(() => scale(page)).toBeCloseTo(3.222, 2);
  // It keeps the size after the fingers leave (no snap back for this scene).
  await page.waitForTimeout(600);
  expect(await scale(page)).toBeCloseTo(3.222, 2);

  // A new detection of the page starts again from the original size.
  await page.evaluate(() => window.__vcam!.setPage(null));
  await page.waitForFunction(() => window.__journey!.scenes.active === null);
  await showScene(page, 'architecture');
  expect(await scale(page)).toBe(1);
});

test('returns to the original size after the gesture where the original did', async ({ page }) => {
  test.setTimeout(90_000);
  await start(page);
  await showScene(page, 'character');
  const cdp = await page.context().newCDPSession(page);

  await pinch(page, cdp, 100, 180, false);
  // Pointer moves are delivered once per frame: wait for the last one.
  await expect.poll(() => scale(page)).toBeCloseTo(1.8, 1);
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  await expect.poll(() => scale(page)).toBe(1);
});

test('scales with the mouse wheel and a trackpad pinch on a PC', async ({ page }) => {
  test.setTimeout(90_000);
  await start(page);
  await showScene(page, 'sequence');
  const { width, height } = page.viewportSize()!;
  await page.mouse.move(width / 2, height / 3);
  await page.mouse.wheel(0, -300);
  await expect.poll(() => scale(page)).toBeGreaterThan(1.4);
  await page.mouse.wheel(0, 2000);
  await expect.poll(() => scale(page)).toBe(1);

  // A trackpad pinch arrives as ctrl+wheel; the browser must not zoom the page.
  await page.keyboard.down('Control');
  await page.mouse.wheel(0, -40);
  await page.keyboard.up('Control');
  await expect.poll(() => scale(page)).toBeGreaterThan(1.3);
  expect(await page.evaluate(() => window.visualViewport?.scale ?? 1)).toBe(1);
});
