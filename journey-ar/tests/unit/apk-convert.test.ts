import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  dropUnneededKeys,
  evaluateCurve,
  sampleTimes,
  type CurveKey,
} from '../../../tools/apk/curves.mjs';
import { readVuforiaTargets } from '../../../tools/assets/vuforia.mjs';

const APK = fileURLToPath(
  new URL('../../../original-sources/Journey-AR-Viewer.1.0.apk', import.meta.url),
);

describe('legacy animation curves (tools/apk/curves.mjs)', () => {
  const key = (time: number, value: number, slope: number | string): CurveKey => ({
    time,
    value,
    inSlope: slope,
    outSlope: slope,
  });

  it('evaluates Hermite segments: slopes equal to the secant give a straight line', () => {
    const keys = [key(0, 0, 2), key(1, 2, 2)];
    expect(evaluateCurve(keys, 0.25)).toBeCloseTo(0.5, 6);
    expect(evaluateCurve(keys, 0.5)).toBeCloseTo(1, 6);
  });

  it('eases between keys with flat slopes and holds outside the keys', () => {
    const keys = [key(0, 0, 0), key(1, 1, 0)];
    expect(evaluateCurve(keys, 0.5)).toBeCloseTo(0.5, 6);
    expect(evaluateCurve(keys, 0.25)).toBeCloseTo(0.15625, 6);
    expect(evaluateCurve(keys, -1)).toBe(0);
    expect(evaluateCurve(keys, 2)).toBe(1);
  });

  it('steps on infinite slopes (written as "inf" by read-apk.py)', () => {
    const keys = [key(0, 3, 'inf'), key(1, 5, 'inf')];
    expect(evaluateCurve(keys, 0.99)).toBe(3);
  });

  it('evaluates components of vector keys', () => {
    const keys: CurveKey[] = [
      { time: 0, value: { x: 0, y: 10 }, inSlope: { x: 1, y: 0 }, outSlope: { x: 1, y: 0 } },
      { time: 1, value: { x: 1, y: 10 }, inSlope: { x: 1, y: 0 }, outSlope: { x: 1, y: 0 } },
    ];
    expect(evaluateCurve(keys, 0.5, 'x')).toBeCloseTo(0.5, 6);
    expect(evaluateCurve(keys, 0.5, 'y')).toBe(10);
  });

  it('samples clips at 30 fps with the last sample at the end (as UnityGLTF did)', () => {
    const times = sampleTimes(12.5, 30);
    expect(times).toHaveLength(376);
    expect(times[1]).toBeCloseTo(1 / 30, 6);
    expect(times.at(-1)).toBe(12.5);
    expect(sampleTimes(1.25, 30)).toHaveLength(39);
  });

  it('drops samples equal to both neighbours, keeping the ends', () => {
    const times = [0, 1, 2, 3, 4, 5];
    const values = [[0], [0], [0], [1], [1], [1]];
    expect(dropUnneededKeys(times, values)).toEqual({
      times: [0, 2, 3, 5],
      values: [[0], [0], [1], [1]],
    });
    expect(dropUnneededKeys([0, 1, 2], [[4], [4], [4]]).times).toEqual([0, 2]);
  });
});

describe('Vuforia dataset read from the original APK (tools/assets/vuforia.mjs)', () => {
  it('has the six targets of the app, 200 units wide, with their textures', () => {
    const targets = readVuforiaTargets(APK);
    expect(targets.map((t) => t.name).sort()).toEqual([
      'Architecture',
      'Character',
      'Creature',
      'Landscape',
      'Sequence',
      'daqri',
    ]);
    for (const target of targets) {
      expect(target.size[0]).toBe(200);
      // JPEG signature.
      expect(target.texture.subarray(0, 2)).toEqual(Buffer.from([0xff, 0xd8]));
    }
  });
});
