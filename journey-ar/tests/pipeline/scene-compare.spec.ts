import { expect, test } from '@playwright/test';
import { existsSync, mkdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import type { ReferenceFile } from '../../src/dev/reference';

// Renders every scene with three.js from the camera of its Unity reference render and saves the
// side-by-side page to tools/.out/compare/: the Unity export as it is (<id>.png) and the scene
// as published to the app, optimized (<id>-published.png; tools/assets/optimize.mjs).
const OUT = fileURLToPath(new URL('../../../tools/.out/', import.meta.url));
const REFERENCE = `${OUT}reference/reference.json`;
const COMPARE = `${OUT}compare/`;

const reference: ReferenceFile | null = existsSync(REFERENCE)
  ? (JSON.parse(readFileSync(REFERENCE, 'utf8')) as ReferenceFile)
  : null;

const PUBLISHED = new Set(
  existsSync(fileURLToPath(new URL('../../assets/scenes.json', import.meta.url)))
    ? (
        JSON.parse(
          readFileSync(fileURLToPath(new URL('../../assets/scenes.json', import.meta.url)), 'utf8'),
        ) as { scenes: { id: string }[] }
      ).scenes.map((scene) => scene.id)
    : [],
);

test('reference renders exist', () => {
  expect(reference, 'run `npm run unity:render` and `npm run unity:export` first').not.toBeNull();
});

const variants = (id: string) => [
  { name: 'export', query: '', file: `${id}.png` },
  ...(PUBLISHED.has(id)
    ? [{ name: 'published', query: `&src=/models/${id}.glb`, file: `${id}-published.png` }]
    : []),
];

for (const target of reference?.targets ?? []) {
  for (const variant of variants(target.id)) {
    test(`${target.id} (${variant.name}): three.js next to the Unity reference`, async ({
      page,
    }) => {
      const errors: string[] = [];
      page.on('pageerror', (error) => errors.push(error.message));
      page.on('console', (message) => {
        if (message.type() === 'error') errors.push(message.text());
      });

      await page.goto(`/scene-preview.html?scene=${target.id}${variant.query}`);
      await page.waitForFunction(() => window.__preview !== undefined, null, { timeout: 30_000 });
      const state = await page.evaluate(() => window.__preview);

      mkdirSync(COMPARE, { recursive: true });
      await page.screenshot({ path: `${COMPARE}${variant.file}`, fullPage: true });
      const difference = state?.difference;
      if (difference) {
        console.log(
          `${target.id} (${variant.name}): mean difference ${difference.meanAbs.toFixed(2)}/255, ` +
            `${(difference.over32 * 100).toFixed(2)}% of pixels differ by more than 32`,
        );
      }

      expect(state?.error).toBeUndefined();
      expect(state?.ready).toBe(true);
      expect(state?.triangles).toBeGreaterThan(0);
      expect(state?.unknownShaders).toEqual([]);
      expect(errors).toEqual([]);
      // All scenes measured at 0.9–2.6/255 mean and at most 0.3% strongly differing pixels when
      // the material conversion was finished; these limits catch regressions, not noise.
      expect(difference?.meanAbs).toBeLessThan(4);
      expect(difference?.over32).toBeLessThan(0.01);
    });
  }
}
