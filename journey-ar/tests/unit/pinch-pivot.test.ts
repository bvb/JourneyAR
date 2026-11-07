import { Euler, Group, Matrix4, Object3D, Vector3 } from 'three';
import { describe, expect, it } from 'vitest';
import { pinchNode, scalePinchNode } from '../../src/scenes/pinch-pivot';

/** A scene root with a transformed parent and a rotated, scaled node, as in the GLB files. */
function scene() {
  const root = new Group();
  const parent = new Object3D();
  parent.position.set(-0.02, -0.06, -0.015);
  parent.rotation.set(0.1, -0.4, 0.05);
  parent.scale.setScalar(0.007);
  const node = new Object3D();
  node.position.set(8.2, 57.6, 6);
  node.rotation.copy(new Euler(-0.3, 1.1, 0.2));
  node.scale.setScalar(2.8);
  root.add(parent);
  parent.add(node);
  return { root, node };
}

/** Where a point of the scene (root frame) attached to the node goes after the node changes. */
function follow(root: Object3D, node: Object3D, point: Vector3, change: () => void): Vector3 {
  root.updateMatrixWorld(true);
  const local = point.clone().applyMatrix4(new Matrix4().copy(node.matrixWorld).invert());
  change();
  root.updateMatrixWorld(true);
  return local.applyMatrix4(node.matrixWorld);
}

describe('pinch pivot', () => {
  const pivot: [number, number, number] = [-0.0074, 0.3316, 0.0366];

  it('keeps the pivot in place when enlarging', () => {
    const { root, node } = scene();
    const pinch = pinchNode(root, node, pivot);
    const moved = follow(root, node, new Vector3(...pivot), () => scalePinchNode(pinch, 3));
    expect(moved.distanceTo(new Vector3(...pivot))).toBeLessThan(1e-9);
    expect(node.scale.x).toBeCloseTo(8.4);
  });

  it('keeps the point on the page below the pivot in place when reducing', () => {
    const { root, node } = scene();
    const pinch = pinchNode(root, node, pivot);
    const ground = new Vector3(pivot[0], 0, pivot[2]);
    const moved = follow(root, node, ground, () => scalePinchNode(pinch, 0.7));
    expect(moved.distanceTo(ground)).toBeLessThan(1e-9);
  });

  it('scales about the node origin without a pivot, and returns to the original at 1', () => {
    const { root, node } = scene();
    const position = node.position.clone();
    const pinch = pinchNode(root, node, undefined);
    scalePinchNode(pinch, 2);
    expect(node.position).toEqual(position);
    const withPivot = pinchNode(root, node, pivot);
    scalePinchNode(withPivot, 2.5);
    scalePinchNode(withPivot, 1);
    expect(node.position.distanceTo(withPivot.position)).toBeLessThan(1e-12);
    expect(node.scale.x).toBeCloseTo(withPivot.scale.x);
  });
});
