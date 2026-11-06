import { describe, expect, it } from 'vitest';
import { unityOffsetToThree, unityToThree } from '../../src/scenes/unity-space';

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

describe('unityOffsetToThree', () => {
  // Values UnityGLTF itself wrote into KHR_texture_transform for the exported materials.
  it('matches UnityGLTF for tiled textures', () => {
    expect(unityOffsetToThree([0, 0], [10, 10])).toEqual([0, -9]);
    expect(unityOffsetToThree([0, 0], [15, 15])).toEqual([0, -14]);
  });

  it('keeps U offsets and mirrors V offsets', () => {
    expect(unityOffsetToThree([-0.2916667, 0], [1, 1])).toEqual([-0.2916667, 0]);
    expect(unityOffsetToThree([0, 0.25], [1, 1])).toEqual([0, -0.25]);
  });
});
