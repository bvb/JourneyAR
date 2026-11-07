import { describe, expect, it } from 'vitest';
import { LoadProgress } from '../../src/ui/load-progress';

describe('LoadProgress', () => {
  it('counts the received bytes of all tasks', () => {
    const progress = new LoadProgress();
    progress.expect('model:a', 800);
    progress.expect('audio:a', 200);
    expect(progress.fraction).toBe(0);
    progress.update('model:a', 400);
    expect(progress.fraction).toBeCloseTo(0.4);
    progress.done('audio:a');
    expect(progress.fraction).toBeCloseTo(0.6);
    expect(progress.complete).toBe(false);
    progress.done('model:a');
    expect(progress.fraction).toBe(1);
    expect(progress.complete).toBe(true);
  });

  it('only grows, within the expected size, and ignores unknown tasks', () => {
    const progress = new LoadProgress();
    progress.expect('a', 100);
    progress.update('a', 60);
    progress.update('a', 30);
    expect(progress.fraction).toBeCloseTo(0.6);
    progress.update('a', 500);
    expect(progress.fraction).toBe(1);
    progress.update('b', 10);
    progress.expect('a', 1000);
    expect(progress.fraction).toBe(1);
  });

  it('is complete with nothing expected, and tells its listeners about changes', () => {
    const progress = new LoadProgress();
    expect(progress.fraction).toBe(1);
    expect(progress.complete).toBe(true);
    let calls = 0;
    const stop = progress.subscribe(() => (calls += 1));
    progress.expect('a', 10);
    progress.update('a', 5);
    progress.update('a', 5);
    progress.done('a');
    progress.done('a');
    expect(calls).toBe(3);
    stop();
    progress.expect('b', 10);
    expect(calls).toBe(3);
  });
});
