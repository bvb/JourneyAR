import { describe, expect, it } from 'vitest';
import { ScenePlacement } from '../../src/interaction/scene-placement';

const PAGE = { halfWidth: 150, halfHeight: 110 };

describe('ScenePlacement', () => {
  it('scales by the finger distance ratio within the limits', () => {
    const placement = new ScenePlacement({ min: 1, max: 3.2 }, PAGE);
    placement.scaleBegin();
    placement.scaleChange(2);
    expect(placement.scale).toBe(2);
    placement.scaleChange(5);
    expect(placement.scale).toBe(3.2);
    placement.scaleChange(0.5);
    expect(placement.scale).toBe(1);
  });

  it('keeps the size after the gesture and continues from it on the next one', () => {
    const placement = new ScenePlacement({ min: 0.7, max: 4 }, PAGE);
    placement.scaleBegin();
    placement.scaleChange(1.2);
    placement.scaleEnd();
    expect(placement.scale).toBeCloseTo(1.2);
    placement.scaleBegin();
    placement.scaleChange(1.1);
    expect(placement.scale).toBeCloseTo(1.32);
    placement.scaleChange(0.1);
    expect(placement.scale).toBe(0.7);
  });

  it('moves the scene on the page within the page, a larger area when enlarged', () => {
    const placement = new ScenePlacement({ min: 0.7, max: 4 }, PAGE);
    placement.moveBy(30, -20);
    placement.moveBy(10, 5);
    expect(placement.offset).toEqual([40, -15]);
    placement.moveBy(1000, -1000);
    expect(placement.offset).toEqual([150, -110]);
    placement.scaleBegin();
    placement.scaleChange(2);
    placement.moveBy(1000, -1000);
    expect(placement.offset).toEqual([300, -220]);
    // Made smaller again, the scene comes back within the smaller area.
    placement.scaleChange(1);
    expect(placement.offset).toEqual([150, -110]);
    placement.scaleChange(0.7);
    expect(placement.offset).toEqual([150, -110]);
  });

  it('goes back to the original size and place on reset', () => {
    const placement = new ScenePlacement({ min: 1, max: 3 }, PAGE);
    placement.scaleChange(2.5);
    placement.moveBy(12, 34);
    placement.reset();
    expect(placement.scale).toBe(1);
    expect(placement.offset).toEqual([0, 0]);
  });

  it('ignores invalid input', () => {
    const placement = new ScenePlacement({ min: 1, max: 3 }, PAGE);
    placement.scaleBegin();
    placement.scaleChange(Number.NaN);
    placement.scaleChange(0);
    placement.moveBy(Number.NaN, 1);
    placement.moveBy(1, Number.POSITIVE_INFINITY);
    expect(placement.scale).toBe(1);
    expect(placement.offset).toEqual([0, 0]);
  });
});
