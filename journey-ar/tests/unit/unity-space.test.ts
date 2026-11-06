import { describe, expect, it } from 'vitest';
import { unityToThree } from '../../src/scenes/unity-space';

describe('unityToThree', () => {
  it('mirrors the X axis like UnityGLTF', () => {
    expect(unityToThree([1, 2, 3]).toArray()).toEqual([-1, 2, 3]);
  });

  it('keeps the page in the XZ plane and Y as up', () => {
    const corner = unityToThree([0.5, 0, -0.367]);
    expect(corner.x).toBeCloseTo(-0.5);
    expect(corner.y).toBe(0);
    expect(corner.z).toBeCloseTo(-0.367);
    expect(unityToThree([0, 1, 0]).y).toBe(1);
  });
});
