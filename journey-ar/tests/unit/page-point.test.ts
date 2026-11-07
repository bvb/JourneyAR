import { Matrix4, PerspectiveCamera, Quaternion, Vector3 } from 'three';
import { describe, expect, it } from 'vitest';
import { pagePointAt } from '../../src/interaction/page-point';

const camera = new PerspectiveCamera(50, 9 / 16, 10, 5000);
const projection = camera.projectionMatrix;
const inverse = camera.projectionMatrixInverse;

/** Page 400 mm in front of the camera, tilted back by `tilt` degrees about its X axis. */
function pose(tilt: number, x = 0, y = 0): Matrix4 {
  const rotation = new Quaternion().setFromAxisAngle(new Vector3(1, 0, 0), (-tilt * Math.PI) / 180);
  return new Matrix4().compose(new Vector3(x, y, -400), rotation, new Vector3(1, 1, 1));
}

function project(point: Vector3, pageToCamera: Matrix4): [number, number] {
  const ndc = point.clone().applyMatrix4(pageToCamera).applyMatrix4(projection);
  return [ndc.x, ndc.y];
}

describe('pagePointAt', () => {
  it('finds the page point seen at a point of the view', () => {
    for (const [tilt, x, y] of [
      [0, 0, 0],
      [40, 20, -30],
      [65, -50, 10],
    ] as const) {
      const pageToCamera = pose(tilt, x, y);
      for (const point of [
        new Vector3(0, 0, 0),
        new Vector3(120, -80, 0),
        new Vector3(-60, 90, 0),
      ]) {
        const [nx, ny] = project(point, pageToCamera);
        const found = pagePointAt(nx, ny, pageToCamera, inverse);
        expect(found).not.toBeNull();
        expect(found!.distanceTo(point)).toBeLessThan(1e-6);
      }
    }
  });

  it('is null where the view does not see the page plane', () => {
    // Tilted 80 degrees: the top of the view looks above the horizon of the page plane.
    const pageToCamera = pose(80);
    expect(pagePointAt(0, 0.95, pageToCamera, inverse)).toBeNull();
    // Seen from behind the camera's back: the page is behind the camera.
    const behind = new Matrix4().makeTranslation(0, 0, 400);
    expect(pagePointAt(0, 0, behind, inverse)).toBeNull();
  });
});
