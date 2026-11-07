import { describe, expect, it } from 'vitest';
import { PageSelector } from '../../src/tracking/page-selector';

const good = (scene: string) => ({ scene, error: 0.3 });
const bad = (scene: string) => ({ scene, error: 1.6 });

describe('PageSelector', () => {
  it('reports found and lost pages', () => {
    const selector = new PageSelector();
    expect(selector.select([good('a')]).transitions).toEqual([{ type: 'found', scene: 'a' }]);
    expect(selector.select([good('a')]).transitions).toEqual([]);
    expect(selector.select([]).transitions).toEqual([{ type: 'lost', scene: 'a' }]);
  });

  it('keeps the tracked page while it tracks well', () => {
    const selector = new PageSelector();
    selector.select([good('a')]);
    const selection = selector.select([good('a'), good('b')]);
    expect(selection.candidate?.scene).toBe('a');
    expect(selection.verify).toBe(false);
  });

  it('searches for other pages when the tracked one keeps a high error', () => {
    const selector = new PageSelector();
    selector.select([good('a')]);
    const verify = Array.from({ length: 5 }, () => selector.select([bad('a')]).verify);
    expect(verify).toEqual([false, false, false, false, true]);
  });

  it('switches to another page found while the tracked one is suspicious', () => {
    const selector = new PageSelector();
    selector.select([good('a')]);
    for (let i = 0; i < 5; i += 1) selector.select([bad('a')]);
    const selection = selector.select([bad('a'), good('b')]);
    expect(selection.candidate?.scene).toBe('b');
    expect(selection.transitions).toEqual([
      { type: 'lost', scene: 'a' },
      { type: 'found', scene: 'b' },
    ]);
    expect(selection.verify).toBe(false);
  });

  it('stops searching once the page tracks well again', () => {
    const selector = new PageSelector();
    selector.select([good('a')]);
    for (let i = 0; i < 5; i += 1) selector.select([bad('a')]);
    let verify = true;
    for (let i = 0; i < 30; i += 1) verify = selector.select([good('a')]).verify;
    expect(verify).toBe(false);
  });
});
