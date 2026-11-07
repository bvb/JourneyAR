import { type Page, expect, test } from '@playwright/test';
import { COLLAPSE_AFTER_EXPAND_MS } from '../../src/ui/start-button';
import { collectErrors, pressStop } from './helpers';

// The interface: the app icons, the Journey picture before the camera runs, and the Start/Stop
// button (a light round its rim while loading, a red rim after an error).

const WHITE = 'rgb(255, 255, 255)';
const RED = 'rgb(255, 59, 48)';

const button = (page: Page) => page.locator('#start');

/** The button and the screen as drawn. */
function look(page: Page) {
  return page.evaluate(() => {
    const element = document.querySelector<HTMLButtonElement>('#start')!;
    const rim = getComputedStyle(element.querySelector('.rim')!);
    const spark = getComputedStyle(element.querySelector('.spark')!);
    return {
      label: element.getAttribute('aria-label'),
      on: element.classList.contains('on'),
      loading: element.classList.contains('loading'),
      error: element.classList.contains('error'),
      logoFilter: getComputedStyle(element.querySelector('.logo')!).filter,
      rim: parseFloat(rim.strokeWidth),
      rimColor: rim.stroke,
      spark: Number(spark.opacity),
      sparkAnimation: spark.animationName,
      canvas: getComputedStyle(document.querySelector('#scene')!).visibility,
      background: getComputedStyle(document.body).backgroundImage,
      collapsed: element.classList.contains('collapsed'),
      size: [element.offsetWidth, element.offsetHeight],
      fill: getComputedStyle(element).backgroundColor,
    };
  });
}

async function start(page: Page): Promise<void> {
  await page.getByRole('button', { name: 'Старт' }).click();
}

test('serves the app icons for the browsers', async ({ page, request }) => {
  await page.goto('/');
  const links = await page.evaluate(() =>
    [...document.querySelectorAll<HTMLLinkElement>('link[rel*="icon"], link[rel="manifest"]')].map(
      (link) => link.getAttribute('href')!,
    ),
  );
  expect(links).toEqual(
    expect.arrayContaining([
      '/favicon.ico',
      '/favicon-32x32.png',
      '/favicon-16x16.png',
      '/apple-touch-icon.png',
      '/site.webmanifest',
      '/safari-pinned-tab.svg',
    ]),
  );
  for (const href of [...links, '/browserconfig.xml', '/logo.svg', '/background.jpg']) {
    expect((await request.get(href)).status(), href).toBe(200);
  }
  const manifest = (await (await request.get('/site.webmanifest')).json()) as {
    name: string;
    icons: { src: string }[];
  };
  expect(manifest.name).toBe('Journey AR');
  for (const icon of manifest.icons) {
    expect((await request.get(`/${icon.src}`)).status(), icon.src).toBe(200);
  }
});

test('shows the Journey picture until the camera runs, and the button states', async ({ page }) => {
  test.setTimeout(90_000);
  const errors = collectErrors(page);
  await page.goto('/?source=canvas');
  await page.waitForFunction(() => window.__journey?.ready === true);

  // Idle: a thin white rim, the picture as it is, at the bottom in the middle; behind it the
  // Journey picture, as high as the window. (The dev server adds the styles by script, so they
  // may still be easing in.)
  await expect
    .poll(() => look(page))
    .toMatchObject({
      label: 'Старт',
      on: false,
      loading: false,
      error: false,
      logoFilter: 'none',
      rim: 2,
      rimColor: WHITE,
      spark: 0,
      canvas: 'hidden',
    });
  expect((await look(page)).background).toContain('/background.jpg');
  expect(await page.evaluate(() => getComputedStyle(document.body).backgroundSize)).toBe(
    'auto 100%',
  );
  await expect(button(page).locator('img.logo')).toBeVisible();
  const box = (await button(page).boundingBox())!;
  const viewport = page.viewportSize()!;
  expect(Math.abs(box.x + box.width / 2 - viewport.width / 2)).toBeLessThan(1);
  expect(box.y + box.height).toBeGreaterThan(viewport.height - 140);
  // No text on screen besides the button.
  expect(await page.locator('#status').count()).toBe(0);

  // Started: the picture inverts and the rim is thicker; the camera picture replaces the
  // Journey picture; once everything is loaded, the light stops and the rim is whole.
  await start(page);
  await expect
    .poll(() => look(page))
    .toMatchObject({ on: true, label: 'Стоп', logoFilter: 'invert(1)', rim: 5 });
  await expect.poll(async () => (await look(page)).canvas).toBe('visible');
  await expect
    .poll(() => page.evaluate(() => window.__journey!.loading!.complete), { timeout: 60_000 })
    .toBe(true);
  await expect
    .poll(() => look(page))
    .toMatchObject({ loading: false, rim: 5, rimColor: WHITE, spark: 0, error: false });

  // Stopped: back to the start state and the Journey picture.
  await pressStop(page);
  await expect
    .poll(() => look(page))
    .toMatchObject({ label: 'Старт', on: false, rim: 2, canvas: 'hidden' });
  expect(errors).toEqual([]);
});

test('runs a light round the rim while loading', async ({ page, context }) => {
  test.setTimeout(90_000);
  // Slow downloads, so the loading lasts.
  const cdp = await context.newCDPSession(page);
  await cdp.send('Network.enable');
  await cdp.send('Network.setCacheDisabled', { cacheDisabled: true });
  await page.goto('/?source=canvas');
  await page.waitForFunction(() => window.__journey?.ready === true);
  await cdp.send('Network.emulateNetworkConditions', {
    offline: false,
    latency: 20,
    downloadThroughput: 3e6,
    uploadThroughput: 1e6,
  });
  await start(page);
  await expect
    .poll(() => look(page))
    .toMatchObject({ loading: true, rim: 5, spark: 1, sparkAnimation: 'spark-travel' });
  // The rim under the light is faint.
  expect((await look(page)).rimColor).toBe('rgba(255, 255, 255, 0.3)');
  expect(await page.evaluate(() => window.__journey!.loading!.pending)).toBeGreaterThan(0);
});

test(
  'turns the rim red on an error and logs it, until the next Start',
  { tag: '@regression' },
  async ({ page }) => {
    test.setTimeout(90_000);
    const logged: string[] = [];
    page.on('console', (message) => {
      if (message.type() === 'error') logged.push(message.text());
    });
    // A scene that cannot load.
    await page.route('**/models/sequence.glb', (route) => route.fulfill({ status: 404 }));
    await page.goto('/?source=canvas');
    await page.waitForFunction(() => window.__journey?.ready === true);
    await start(page);
    await expect
      .poll(() => look(page), { timeout: 60_000 })
      .toMatchObject({ error: true, rimColor: RED });
    expect(logged.some((text) => text.startsWith('Scene:'))).toBe(true);
    expect(await page.locator('#status').count()).toBe(0);

    // Loaded (the failed scene counts as done): the bar it folds into is red.
    await expect
      .poll(() => look(page), { timeout: 60_000 })
      .toMatchObject({ collapsed: true, fill: 'rgba(255, 59, 48, 0.75)' });

    // A new Start: the earlier error is no longer shown.
    await pressStop(page);
    await start(page);
    await expect.poll(() => look(page)).toMatchObject({ error: false, rimColor: WHITE, on: true });
  },
);

test('turns the rim red when the camera cannot start', async ({ page }) => {
  const logged: string[] = [];
  page.on('console', (message) => {
    if (message.type() === 'error') logged.push(message.text());
  });
  await page.goto('/?source=video&src=/__recordings/missing.webm');
  await page.waitForFunction(() => window.__journey?.ready === true);
  await start(page);
  await expect
    .poll(() => look(page))
    .toMatchObject({
      label: 'Старт',
      on: false,
      error: true,
      rim: 2,
      rimColor: RED,
      canvas: 'hidden',
    });
  expect(await page.evaluate(() => window.__journey!.sourceState)).toBe('error');
  expect(logged.some((text) => text.startsWith('Camera:'))).toBe(true);
});

test(
  'starts and stops again and again with a quiet console and no error',
  { tag: '@regression' },
  async ({ page }) => {
    test.setTimeout(120_000);
    const messages: string[] = [];
    const keep = (type: string, text: string) => {
      // The browser's own notes: the dev server, GPU driver performance hints (Chromium).
      if (type === 'debug' || text.includes('GL Driver Message')) return;
      messages.push(`${type}: ${text}`);
    };
    page.on('console', (message) => keep(message.type(), message.text()));
    page.on('pageerror', (error) => keep('pageerror', error.message));
    page.on('worker', (worker) =>
      worker.on('console', (message) => keep(`worker ${message.type()}`, message.text())),
    );
    await page.goto('/?source=canvas');
    await page.waitForFunction(() => window.__journey?.ready === true);
    for (let i = 0; i < 3; i += 1) {
      await start(page);
      // The virtual camera exists once the source has started.
      await page.waitForFunction(() => window.__vcam !== undefined);
      await page.evaluate(async () => {
        window.__vcam!.setPose({ target: [0, 0], distance: 420, tilt: 30, azimuth: 0, roll: 0 });
        await window.__vcam!.setPage('creature');
      });
      await page.waitForFunction(() => window.__journey!.tracking.scene === 'creature', null, {
        timeout: 60_000,
      });
      // Stopped while the tracker is busy with frames.
      await pressStop(page);
      await expect.poll(() => look(page)).toMatchObject({ on: false, error: false });
    }
    await page.waitForTimeout(2500);
    expect((await look(page)).error).toBe(false);
    // Neither the tracker core's diagnostics nor errors.
    expect(messages).toEqual([]);
  },
);

test(
  'folds into a bar once loaded, and unfolds on a tap or an upward swipe',
  { tag: '@regression' },
  async ({ page }) => {
    test.setTimeout(120_000);
    const errors = collectErrors(page);
    await page.goto('/?source=canvas');
    await page.waitForFunction(() => window.__journey?.ready === true);
    await start(page);
    await expect
      .poll(() => page.evaluate(() => window.__journey!.loading!.complete), { timeout: 60_000 })
      .toBe(true);

    // Folded: a small translucent bar at the bottom in the middle, still running.
    await expect
      .poll(() => look(page), { timeout: 5000 })
      .toMatchObject({ collapsed: true, label: 'Показать кнопку', size: [64, 6] });
    expect((await look(page)).fill).toBe('rgba(255, 255, 255, 0.55)');
    expect(await page.evaluate(() => window.__journey!.sourceState)).toBe('running');
    const bar = (await page.locator('#start').boundingBox())!;
    expect(Math.abs(bar.x + bar.width / 2 - page.viewportSize()!.width / 2)).toBeLessThan(1);

    // A tap unfolds it (and does not stop); without a press it folds again after 3 s.
    await page.locator('#start').click();
    await expect
      .poll(() => look(page))
      .toMatchObject({ collapsed: false, label: 'Стоп', size: [76, 76], on: true });
    const unfolded = Date.now();
    expect(await page.evaluate(() => window.__journey!.sourceState)).toBe('running');
    await expect.poll(async () => (await look(page)).collapsed, { timeout: 6000 }).toBe(true);
    expect(Date.now() - unfolded).toBeGreaterThan(COLLAPSE_AFTER_EXPAND_MS - 300);

    // An upward swipe on the bar unfolds it too; the click ending the swipe does not stop.
    const box = (await page.locator('#start').boundingBox())!;
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.down();
    await page.mouse.move(box.x + box.width / 2, box.y - 40, { steps: 6 });
    await page.mouse.up();
    await expect.poll(() => look(page)).toMatchObject({ collapsed: false, label: 'Стоп' });
    expect(await page.evaluate(() => window.__journey!.sourceState)).toBe('running');

    // Pressed while unfolded: stops, and stays a button.
    await page.waitForTimeout(500);
    await page.getByRole('button', { name: 'Стоп' }).click();
    await expect
      .poll(() => look(page))
      .toMatchObject({ collapsed: false, label: 'Старт', on: false });
    await page.waitForTimeout(COLLAPSE_AFTER_EXPAND_MS + 500);
    expect((await look(page)).collapsed).toBe(false);
    expect(errors).toEqual([]);
  },
);
