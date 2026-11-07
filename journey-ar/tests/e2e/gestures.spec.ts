import { type CDPSession, type Page, expect, test } from '@playwright/test';

// Placing the shown scene (pinch to scale, drag to move, double tap to reset), through the
// embedded virtual camera (?source=canvas). Touch is emulated with the DevTools protocol, which
// Edge and Chromium both turn into pointer events like a real touch screen.

test.use({ hasTouch: true });

const VIEW = { target: [0, 0] as [number, number], distance: 450, tilt: 35, azimuth: 0, roll: 0 };

interface Point {
  x: number;
  y: number;
}

async function showScene(page: Page, id: string): Promise<void> {
  await page.evaluate(
    async ({ id, view }) => {
      window.__vcam!.setPose(view);
      await window.__vcam!.setPage(id);
    },
    { id, view: VIEW },
  );
  try {
    await page.waitForFunction(
      (id) => window.__journey!.scenes.active === id && window.__journey!.scenes.shown,
      id,
      { timeout: 30_000 },
    );
  } catch (error) {
    // Say where it got stuck: tracking, loading or showing.
    const state = await page.evaluate(() => {
      const j = window.__journey!;
      return {
        scenes: j.scenes,
        tracking: {
          scene: j.tracking.scene,
          error: j.tracking.error,
          processed: j.tracking.processed,
          events: j.tracking.events.slice(-6),
        },
        videoFrames: j.videoFrames,
        vcam: window.__vcam!.getPage(),
      };
    });
    throw new Error(`Scene "${id}" not shown: ${JSON.stringify(state)}`, { cause: error });
  }
}

async function hidePage(page: Page): Promise<void> {
  await page.evaluate(() => window.__vcam!.setPage(null));
  await page.waitForFunction(() => window.__journey!.scenes.active === null);
}

async function start(page: Page): Promise<void> {
  await page.goto('/?source=canvas');
  await page.getByRole('button', { name: 'Старт' }).click();
  await page.waitForFunction(() => window.__journey?.tracking.ready === true, null, {
    timeout: 60_000,
  });
}

const touch = (cdp: CDPSession, type: 'touchStart' | 'touchMove' | 'touchEnd', points: Point[]) =>
  cdp.send('Input.dispatchTouchEvent', {
    type,
    touchPoints: points.map((p, id) => ({ x: p.x, y: p.y, id })),
  });

/** Two fingers moving apart from `from` to `to` px around a point of the screen. */
async function pinch(page: Page, cdp: CDPSession, from: number, to: number, release = true) {
  const { width, height } = page.viewportSize()!;
  const cx = width / 2;
  const cy = height / 3;
  const points = (d: number) => [
    { x: cx - d / 2, y: cy },
    { x: cx + d / 2, y: cy },
  ];
  await touch(cdp, 'touchStart', points(from));
  for (let i = 1; i <= 10; i += 1) {
    await touch(cdp, 'touchMove', points(from + ((to - from) * i) / 10));
  }
  if (release) await touch(cdp, 'touchEnd', []);
}

/** One finger dragged from `from` to `to`. */
async function drag(cdp: CDPSession, from: Point, to: Point) {
  await touch(cdp, 'touchStart', [from]);
  for (let i = 1; i <= 12; i += 1) {
    const k = i / 12;
    await touch(cdp, 'touchMove', [
      { x: from.x + (to.x - from.x) * k, y: from.y + (to.y - from.y) * k },
    ]);
  }
  await touch(cdp, 'touchEnd', []);
}

async function doubleTap(cdp: CDPSession, at: Point) {
  for (let i = 0; i < 2; i += 1) {
    await touch(cdp, 'touchStart', [at]);
    await touch(cdp, 'touchEnd', []);
  }
}

const placement = (page: Page) =>
  page.evaluate(() => {
    const { scale, offset } = window.__journey!.scenes;
    return { scale, offset };
  });
const scale = async (page: Page) => (await placement(page)).scale;

/**
 * Screen position (CSS px) of a page point (mm), from the virtual camera's exact pose: its
 * frame is shown cropped to cover the window.
 */
function screenOf(page: Page, point: [number, number, number]): Promise<Point> {
  return page.evaluate((point) => {
    const pixel = window.__vcam!.project(point)!;
    const [fw, fh] = window.__journey!.videoSize!;
    const { innerWidth: w, innerHeight: h } = window;
    const k = Math.max(w / fw, h / fh);
    return { x: (pixel[0] - fw / 2) * k + w / 2, y: (pixel[1] - fh / 2) * k + h / 2 };
  }, point);
}

test(
  'scales the scene with two fingers within its limits and keeps the size',
  { tag: '@regression' },
  async ({ page }) => {
    test.setTimeout(90_000);
    await start(page);
    await showScene(page, 'architecture');
    const cdp = await page.context().newCDPSession(page);

    await pinch(page, cdp, 100, 200);
    // Pointer moves are delivered once per frame: wait for the last one.
    await expect.poll(() => scale(page)).toBeCloseTo(2, 1);
    // Architecture allows up to 3.22 times its size (the original PinchScale limits).
    await pinch(page, cdp, 100, 400);
    await expect.poll(() => scale(page)).toBeCloseTo(3.222, 2);
    await page.waitForTimeout(600);
    expect(await scale(page)).toBeCloseTo(3.222, 2);

    // A new detection of the page keeps the size.
    await hidePage(page);
    await showScene(page, 'architecture');
    expect(await scale(page)).toBeCloseTo(3.222, 2);
  },
);

test(
  'keeps the size where the original snapped back, and Landscape grows 3 times',
  { tag: '@regression' },
  async ({ page }) => {
    test.setTimeout(90_000);
    await start(page);
    await showScene(page, 'character');
    const cdp = await page.context().newCDPSession(page);
    await pinch(page, cdp, 100, 180);
    await expect.poll(() => scale(page)).toBeCloseTo(1.8, 1);
    await page.waitForTimeout(600);
    expect(await scale(page)).toBeCloseTo(1.8, 1);

    await hidePage(page);
    await showScene(page, 'landscape');
    expect(await scale(page)).toBe(1);
    await pinch(page, cdp, 60, 400);
    await expect.poll(() => scale(page)).toBe(3);
    // Each scene keeps its own size.
    await hidePage(page);
    await showScene(page, 'character');
    expect(await scale(page)).toBeCloseTo(1.8, 1);
  },
);

test('moves the scene along the page with a finger, and a double tap puts it back', async ({
  page,
}) => {
  test.setTimeout(90_000);
  await start(page);
  await showScene(page, 'creature');
  const cdp = await page.context().newCDPSession(page);
  // Let the shown pose settle on the page.
  await page.waitForTimeout(1000);

  // The page point under the finger follows it: the scene's point that was under the finger
  // (the page centre) ends up under the finger again.
  const from = await screenOf(page, [0, 0, 0]);
  const to = { x: from.x + 70, y: from.y - 90 };
  await drag(cdp, from, to);
  await expect.poll(async () => (await placement(page)).offset[1]).toBeGreaterThan(10);
  await page.waitForTimeout(300);
  const { offset } = await placement(page);
  const moved = await screenOf(page, [offset[0], offset[1], 0]);
  expect(Math.hypot(moved.x - to.x, moved.y - to.y)).toBeLessThan(10);
  // Right on the screen is right on the page, up the screen is up the page (the camera looks
  // at the page from below its bottom edge).
  expect(offset[0]).toBeGreaterThan(10);

  // Kept across detections, with the size.
  await pinch(page, cdp, 100, 150);
  await expect.poll(() => scale(page)).toBeCloseTo(1.5, 1);
  await hidePage(page);
  await showScene(page, 'creature');
  expect(await placement(page)).toEqual({ scale: expect.closeTo(1.5, 1), offset });

  await doubleTap(cdp, to);
  await expect.poll(() => placement(page)).toEqual({ scale: 1, offset: [0, 0] });
});

test(
  'scales with the mouse wheel or a trackpad pinch, and moves with the mouse on a PC',
  { tag: '@regression' },
  async ({ page }) => {
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

    await page.mouse.down();
    await page.mouse.move(width / 2 - 80, height / 3, { steps: 8 });
    await page.mouse.up();
    await expect.poll(async () => (await placement(page)).offset[0]).toBeLessThan(-10);
    await page.mouse.dblclick(width / 2, height / 3);
    await expect.poll(() => placement(page)).toEqual({ scale: 1, offset: [0, 0] });
  },
);
