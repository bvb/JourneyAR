import { describe, expect, it } from 'vitest';
import {
  FULL_RATE_SEARCH_MS,
  SEARCH_INTERVAL_MS,
  SearchPacer,
} from '../../src/tracking/search-pacer';

/** Frames at 30 fps from `from` to `to` ms that the pacer lets through (processing each). */
function run(pacer: SearchPacer, from: number, to: number, tracked: (t: number) => boolean) {
  const passed: number[] = [];
  for (let t = from; t < to; t += 1000 / 30) {
    if (!pacer.shouldProcess(t)) continue;
    passed.push(t);
    pacer.processed(t, tracked(t));
  }
  return passed;
}

describe('SearchPacer', () => {
  it('searches on every frame for a second after the start, then every 200 ms', () => {
    const pacer = new SearchPacer();
    pacer.reset(0);
    const first = run(pacer, 0, FULL_RATE_SEARCH_MS, () => false);
    expect(first.length).toBe(30);
    const later = run(pacer, FULL_RATE_SEARCH_MS, FULL_RATE_SEARCH_MS + 2000, () => false);
    expect(later.length).toBeGreaterThanOrEqual(8);
    expect(later.length).toBeLessThanOrEqual(2000 / SEARCH_INTERVAL_MS);
    for (let i = 1; i < later.length; i += 1) {
      expect(later[i]! - later[i - 1]!).toBeGreaterThanOrEqual(SEARCH_INTERVAL_MS);
    }
  });

  it('processes every frame while a page is tracked, and for a second after it is lost', () => {
    const pacer = new SearchPacer();
    pacer.reset(0);
    run(pacer, 0, 3000, () => false);
    // Found at the first search after 3 s (at most 200 ms later), tracked until 5 s: every frame.
    const tracked = run(pacer, 3000, 5000, (t) => t < 5000);
    expect(tracked.length).toBeGreaterThanOrEqual(60 - SEARCH_INTERVAL_MS / (1000 / 30) - 1);
    for (let i = 1; i < tracked.length; i += 1) {
      expect(tracked[i]! - tracked[i - 1]!).toBeLessThan(SEARCH_INTERVAL_MS + 1);
    }
    const tail = tracked.filter((t) => t >= 3000 + SEARCH_INTERVAL_MS);
    expect(tail.length).toBeGreaterThanOrEqual(53);
    // Lost at 5 s: full rate for a second, then paced.
    const lost = run(pacer, 5000, 7000, () => false);
    const grace = lost.filter((t) => t < 5000 + FULL_RATE_SEARCH_MS);
    expect(grace.length).toBeGreaterThanOrEqual(29);
    expect(lost.length - grace.length).toBeLessThanOrEqual(1000 / SEARCH_INTERVAL_MS + 1);
  });
});
