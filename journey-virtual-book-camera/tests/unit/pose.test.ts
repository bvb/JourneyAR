import { Matrix4, Vector3 } from 'three';
import { describe, expect, it } from 'vitest';
import {
  type CameraPose,
  DEFAULT_FRAME,
  DEFAULT_POSE,
  cameraMatrix,
  focalLength,
  horizontalFov,
  modelViewMatrix,
  pageInView,
  projectPoint,
  verticalFov,
} from '../../src/core/pose';

const pose = (patch: Partial<CameraPose>): CameraPose => ({ ...DEFAULT_POSE, ...patch });
const centre = [(DEFAULT_FRAME.width - 1) / 2, (DEFAULT_FRAME.height - 1) / 2];

function expectClose(actual: number[], expected: number[], digits = 6) {
  expect(actual.length).toBe(expected.length);
  actual.forEach((value, i) => expect(value).toBeCloseTo(expected[i]!, digits));
}

describe('camera pose', () => {
  it('looks straight down onto the page from the front', () => {
    const modelView = modelViewMatrix(pose({ target: [10, -20], distance: 300 }));
    expectClose(modelView.toArray(), new Matrix4().makeTranslation(-10, 20, -300).toArray());
  });

  it('tilts towards the page bottom and keeps the target in the frame centre', () => {
    const p = pose({ target: [30, 40], distance: 400, tilt: 30 });
    const eye = new Vector3().setFromMatrixPosition(cameraMatrix(p));
    expectClose(eye.toArray(), [30, 40 - 400 * Math.sin(Math.PI / 6), 400 * Math.cos(Math.PI / 6)]);
    expectClose(projectPoint(modelViewMatrix(p), DEFAULT_FRAME, [30, 40, 0])!, centre);
  });

  it('shows the page top at the top of the frame at azimuth 0 and roll 0', () => {
    const [, v] = projectPoint(modelViewMatrix(pose({ tilt: 20 })), DEFAULT_FRAME, [0, 50, 0])!;
    expect(v).toBeLessThan(centre[1]!);
  });

  it('turns the frame with the azimuth: at 90 degrees the page left is at the top', () => {
    const [u, v] = projectPoint(
      modelViewMatrix(pose({ azimuth: 90 })),
      DEFAULT_FRAME,
      [-50, 0, 0],
    )!;
    expect(u).toBeCloseTo(centre[0]!);
    expect(v).toBeLessThan(centre[1]!);
  });

  it('turns the page clockwise in the frame with a positive roll', () => {
    const [u, v] = projectPoint(modelViewMatrix(pose({ roll: 90 })), DEFAULT_FRAME, [0, 50, 0])!;
    expect(u).toBeGreaterThan(centre[0]!);
    expect(v).toBeCloseTo(centre[1]!);
  });

  it('is a rigid transform', () => {
    const m = modelViewMatrix(
      pose({ target: [5, 6], distance: 250, tilt: 40, azimuth: 33, roll: -12 }),
    );
    expect(m.determinant()).toBeCloseTo(1);
  });
});

describe('projection', () => {
  it('takes the field of view along the long side, whatever the proportions', () => {
    expect(focalLength({ width: 640, height: 480, fov: 90 })).toBeCloseTo(320);
    expect(focalLength({ width: 480, height: 640, fov: 90 })).toBeCloseTo(320);
    expect(horizontalFov(DEFAULT_FRAME)).toBeCloseTo(63);
    expect(horizontalFov({ width: 1280, height: 720, fov: 63 })).toBeCloseTo(63);
    expect(verticalFov({ width: 1280, height: 720, fov: 63 })).toBeCloseTo(38.0, 1);
  });

  it('maps a point 100 mm right at 300 mm to f/3 pixels right of the centre', () => {
    const [u] = projectPoint(modelViewMatrix(DEFAULT_POSE), DEFAULT_FRAME, [100, 0, 0])!;
    expect(u - centre[0]!).toBeCloseTo(focalLength(DEFAULT_FRAME) / 3);
  });

  it('returns null behind the camera', () => {
    expect(projectPoint(modelViewMatrix(DEFAULT_POSE), DEFAULT_FRAME, [0, 0, 400])).toBeNull();
  });

  it('measures how much of the page is in the frame', () => {
    expect(pageInView(modelViewMatrix(pose({ distance: 600 })), DEFAULT_FRAME)).toBe(1);
    expect(pageInView(modelViewMatrix(pose({ target: [600, 0] })), DEFAULT_FRAME)).toBe(0);
    const partial = pageInView(modelViewMatrix(pose({ distance: 150 })), DEFAULT_FRAME);
    expect(partial).toBeGreaterThan(0.1);
    expect(partial).toBeLessThan(0.6);
  });
});
