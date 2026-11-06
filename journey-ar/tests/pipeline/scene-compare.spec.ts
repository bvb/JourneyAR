import { expect, test } from '@playwright/test';
import { existsSync, mkdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import type { ReferenceFile } from '../../src/dev/reference';

// Renders every exported scene with three.js from the camera of its Unity reference render and
// saves the side-by-side page to tools/.out/compare/<id>.png for visual comparison.
const OUT = fileURLToPath(new URL('../../../tools/.out/', import.meta.url));
const REFERENCE = `${OUT}reference/reference.json`;
const COMPARE = `${OUT}compare/`;

const reference: ReferenceFile | null = existsSync(REFERENCE)
  ? (JSON.parse(readFileSync(REFERENCE, 'utf8')) as ReferenceFile)
  : null;

test('reference renders exist', () => {
  expect(reference, 'run `npm run unity:render` and `npm run unity:export` first').not.toBeNull();
});

for (const target of reference?.targets ?? []) {
  test(`${target.id}: three.js next to the Unity reference`, async ({ page }) => {
    const errors: string[] = [];
    page.on('pageerror', (error) => errors.push(error.message));
    page.on('console', (message) => {
      if (message.type() === 'error') errors.push(message.text());
    });

    await page.goto(`/scene-preview.html?scene=${target.id}`);
    await page.waitForFunction(() => window.__preview !== undefined, null, { timeout: 30_000 });
    const state = await page.evaluate(() => window.__preview);

    mkdirSync(COMPARE, { recursive: true });
    await page.screenshot({ path: `${COMPARE}${target.id}.png`, fullPage: true });
    const difference = state?.difference;
    if (difference) {
      console.log(
        `${target.id}: mean difference ${difference.meanAbs.toFixed(1)}/255, ` +
          `${(difference.over32 * 100).toFixed(1)}% of pixels differ by more than 32`,
      );
    }

    expect(state?.error).toBeUndefined();
    expect(state?.ready).toBe(true);
    expect(state?.triangles).toBeGreaterThan(0);
    expect(state?.unknownShaders).toEqual([]);
    expect(errors).toEqual([]);
    // All scenes measured at 0.9–2.6/255 mean and at most 0.3% strongly differing pixels when the
    // material conversion was finished; these limits catch regressions, not noise.
    expect(difference?.meanAbs).toBeLessThan(4);
    expect(difference?.over32).toBeLessThan(0.01);
  });
}
