import { describe, expect, it } from 'vitest';
import { PendingLoads } from '../../src/ui/pending-loads';

describe('PendingLoads', () => {
  it('is complete when every expected load has finished', () => {
    const loads = new PendingLoads();
    expect(loads.complete).toBe(true);
    loads.add('nft');
    loads.add('model:a');
    expect(loads.count).toBe(2);
    loads.done('nft');
    expect(loads.complete).toBe(false);
    loads.done('model:a');
    expect(loads.complete).toBe(true);
  });

  it('does not expect a finished load again, and ignores repeats', () => {
    const loads = new PendingLoads();
    loads.done('audio:a');
    loads.add('audio:a');
    loads.add('audio:b');
    loads.add('audio:b');
    expect(loads.count).toBe(1);
  });

  it('tells its listeners about changes', () => {
    const loads = new PendingLoads();
    let calls = 0;
    const stop = loads.subscribe(() => (calls += 1));
    loads.add('a');
    loads.add('a');
    loads.done('a');
    loads.done('a');
    expect(calls).toBe(2);
    stop();
    loads.add('b');
    expect(calls).toBe(2);
  });
});
