import { describe, expect, it } from 'vitest';
import { PinchScale, SNAP_BACK_SECONDS } from '../../src/interaction/pinch-scale';

describe('PinchScale', () => {
  it('scales by the finger distance ratio within the limits', () => {
    const pinch = new PinchScale({ min: 1, max: 3.2, snapBack: false });
    pinch.begin();
    pinch.change(2);
    expect(pinch.factor).toBe(2);
    pinch.change(5);
    expect(pinch.factor).toBe(3.2);
    pinch.change(0.5);
    expect(pinch.factor).toBe(1);
  });

  it('continues from the current size on the next gesture', () => {
    const pinch = new PinchScale({ min: 0.7, max: 1.4, snapBack: false });
    pinch.begin();
    pinch.change(1.2);
    pinch.end();
    pinch.begin();
    pinch.change(1.1);
    expect(pinch.factor).toBeCloseTo(1.32);
    pinch.change(0.5);
    expect(pinch.factor).toBe(0.7);
  });

  it('returns to the initial size after the gesture with snapBack', () => {
    const pinch = new PinchScale({ min: 1, max: 2, snapBack: true });
    pinch.begin();
    pinch.change(1.8);
    pinch.end();
    expect(pinch.tick(SNAP_BACK_SECONDS / 2)).toBe(true);
    expect(pinch.factor).toBeGreaterThan(1);
    expect(pinch.factor).toBeLessThan(1.8);
    pinch.tick(SNAP_BACK_SECONDS);
    expect(pinch.factor).toBe(1);
    expect(pinch.tick(0.1)).toBe(false);
  });

  it('keeps the size without snapBack, and reset goes back to 1', () => {
    const pinch = new PinchScale({ min: 1, max: 3, snapBack: false });
    pinch.begin();
    pinch.change(2.5);
    pinch.end();
    expect(pinch.tick(1)).toBe(false);
    expect(pinch.factor).toBe(2.5);
    pinch.reset();
    expect(pinch.factor).toBe(1);
  });

  it('ignores invalid ratios', () => {
    const pinch = new PinchScale({ min: 1, max: 3, snapBack: false });
    pinch.begin();
    pinch.change(Number.NaN);
    pinch.change(0);
    expect(pinch.factor).toBe(1);
  });
});
