import { type Page, expect, test } from '@playwright/test';
import { collectErrors } from './helpers';

// The interface: the app icons and the Start/Stop button with the loading progress on its rim.

const button = (page: Page) => page.locator('#start');

/** The button as drawn: state classes, the picture's filter, the rim width and its progress. */
function buttonLook(page: Page) {
  return page.evaluate(() => {
    const element = document.querySelector<HTMLButtonElement>('#start')!;
    const arc = getComputedStyle(element.querySelector('.arc')!);
    return {
      label: element.getAttribute('aria-label'),
      on: element.classList.contains('on'),
      loading: element.classList.contains('loading'),
      logoFilter: getComputedStyle(element.querySelector('.logo')!).filter,
      rim: parseFloat(arc.strokeWidth),
      dash: arc.strokeDasharray,
      offset: parseFloat(arc.strokeDashoffset),
    };
  });
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
  for (const href of [...links, '/browserconfig.xml', '/logo.svg', '/mstile-150x150.png']) {
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

test('shows the start state, the loading progress and the stop state on one button', async ({
  page,
}) => {
  test.setTimeout(90_000);
  const errors = collectErrors(page);
  await page.goto('/?source=canvas');
  await page.waitForFunction(() => window.__journey?.ready === true);

  // Idle: a thin whole rim, the picture as it is, at the bottom in the middle. (The dev server
  // adds the styles by script, so they may still be easing in.)
  await expect
    .poll(() => buttonLook(page))
    .toMatchObject({
      label: 'Старт',
      on: false,
      loading: false,
      logoFilter: 'none',
      rim: 2,
      dash: 'none',
    });
  await expect(button(page).locator('img.logo')).toBeVisible();
  const box = (await button(page).boundingBox())!;
  const viewport = page.viewportSize()!;
  expect(Math.abs(box.x + box.width / 2 - viewport.width / 2)).toBeLessThan(1);
  expect(box.y + box.height).toBeGreaterThan(viewport.height - 140);

  // Started: the picture inverts, the rim is thicker and shows the loading progress, which only
  // grows until everything is loaded.
  await page.getByRole('button', { name: 'Старт' }).click();
  // The picture inverts with a short transition.
  await expect
    .poll(() => buttonLook(page))
    .toMatchObject({ on: true, label: 'Стоп', logoFilter: 'invert(1)' });
  const fractions: number[] = [];
  await expect
    .poll(
      async () => {
        const loading = await page.evaluate(() => window.__journey!.loading!);
        fractions.push(loading.fraction);
        return loading.complete;
      },
      { timeout: 60_000, intervals: [100] },
    )
    .toBe(true);
  for (let i = 1; i < fractions.length; i += 1) {
    expect(fractions[i]).toBeGreaterThanOrEqual(fractions[i - 1]!);
  }
  expect(fractions.at(-1)).toBe(1);
  await expect
    .poll(() => buttonLook(page))
    .toMatchObject({ on: true, loading: false, rim: 5, dash: 'none' });

  // Stopped: back to the start state.
  await page.getByRole('button', { name: 'Стоп' }).click();
  await expect.poll(() => buttonLook(page)).toMatchObject({ label: 'Старт', on: false, rim: 2 });
  expect(errors).toEqual([]);
});

test('draws the loaded part on the rim while loading', async ({ page, context }) => {
  test.setTimeout(90_000);
  // Slow downloads, so the loading state lasts.
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
  await page.getByRole('button', { name: 'Старт' }).click();
  await expect.poll(async () => (await buttonLook(page)).loading).toBe(true);
  await expect
    .poll(() => page.evaluate(() => window.__journey!.loading!.fraction), { timeout: 30_000 })
    .toBeGreaterThan(0.05);
  const fraction = await page.evaluate(() => window.__journey!.loading!.fraction);
  const look = await buttonLook(page);
  expect(look).toMatchObject({ loading: true, rim: 5, dash: '100px' });
  // The arc (path length 100) shows the loaded part; it eases to the value in 0.3 s.
  await expect
    .poll(async () => (await buttonLook(page)).offset)
    .toBeLessThanOrEqual(100 * (1 - fraction) + 0.5);
  expect(look.offset).toBeGreaterThan(5);
});
