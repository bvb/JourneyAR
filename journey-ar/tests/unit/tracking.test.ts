import { describe, expect, it } from 'vitest';
import { DEFAULT_FIELD_OF_VIEW, parseTrackingOptions } from '../../src/config/tracking-options';
import { DEFAULT_SMOOTHING } from '../../src/tracking/pose-smoother';
import { cameraParamBytes, focalForFov, processingSize } from '../../src/tracking/camera-params';

describe('cameraParamBytes', () => {
  it('writes an ARToolKit version 4 camera file (176 bytes, big-endian)', () => {
    const view = new DataView(cameraParamBytes({ width: 640, height: 480, focal: 522 }).buffer);
    expect(view.byteLength).toBe(176);
    expect([view.getInt32(0), view.getInt32(4)]).toEqual([640, 480]);
    const doubles = Array.from({ length: 21 }, (_, i) => view.getFloat64(8 + i * 8));
    // Projection matrix rows: [f 0 cx 0], [0 f cy 0], [0 0 1 0].
    expect(doubles.slice(0, 12)).toEqual([522, 0, 319.5, 0, 0, 522, 239.5, 0, 0, 0, 1, 0]);
    // No distortion: k1 k2 p1 p2 = 0, then fx fy x0 y0 and scale 1.
    expect(doubles.slice(12)).toEqual([0, 0, 0, 0, 522, 522, 319.5, 239.5, 1]);
  });
});

describe('focalForFov', () => {
  it('matches the virtual camera default (63 degrees on 640 px)', () => {
    expect(focalForFov(640, 63)).toBeCloseTo(522, 0);
    expect(focalForFov(640, 90)).toBeCloseTo(320);
  });
});

describe('processingSize', () => {
  it('scales the long side to 640 and keeps the proportions', () => {
    expect(processingSize(1280, 720)).toEqual({ width: 640, height: 360 });
    expect(processingSize(1920, 1440)).toEqual({ width: 640, height: 480 });
    expect(processingSize(720, 1280)).toEqual({ width: 360, height: 640 });
  });

  it('never scales up', () => {
    expect(processingSize(320, 240)).toEqual({ width: 320, height: 240 });
  });
});

describe('parseTrackingOptions', () => {
  it('defaults to the native filter and a phone field of view', () => {
    expect(parseTrackingOptions('')).toEqual({
      fieldOfView: DEFAULT_FIELD_OF_VIEW,
      filter: 'native',
      smoothing: DEFAULT_SMOOTHING,
    });
  });

  it('reads ?fov= and ?filter=', () => {
    const options = parseTrackingOptions('?fov=70&filter=oneeuro&smooth=off');
    expect(options.fieldOfView).toBe(70);
    expect(options.smoothing).toBeNull();
    expect(options.filter).toMatchObject({ type: 'oneEuro' });
  });

  it('rejects an unknown filter', () => {
    expect(() => parseTrackingOptions('?filter=kalman')).toThrow('Unknown filter');
  });
});
