import { type Object3D, Vector3 } from 'three';

/** A pinch node's own scale and place, and the points it is scaled about (parent frame). */
export interface PinchNode {
  node: Object3D;
  scale: Vector3;
  position: Vector3;
  /** Scaled about `up` when enlarging and about `down` when reducing. */
  pivots: { up: Vector3; down: Vector3 };
}

/**
 * Prepares scaling `node` about `pivot` (in the frame of `root`, the scene: Y out of the page)
 * when enlarging and about the point on the page below it when reducing, so the scene stays on
 * the page; without a pivot, about the node's own origin (as the original PinchScale did).
 */
export function pinchNode(
  root: Object3D,
  node: Object3D,
  pivot: readonly [number, number, number] | undefined,
): PinchNode {
  const base = { node, scale: node.scale.clone(), position: node.position.clone() };
  if (!pivot || !node.parent) {
    return { ...base, pivots: { up: base.position.clone(), down: base.position.clone() } };
  }
  root.updateMatrixWorld(true);
  const rootToParent = node.parent.matrixWorld.clone().invert().multiply(root.matrixWorld);
  return {
    ...base,
    pivots: {
      up: new Vector3(pivot[0], pivot[1], pivot[2]).applyMatrix4(rootToParent),
      down: new Vector3(pivot[0], 0, pivot[2]).applyMatrix4(rootToParent),
    },
  };
}

/** Sets the node's scale to `factor` times its own, about its pivot. */
export function scalePinchNode(pinch: PinchNode, factor: number): void {
  const pivot = factor >= 1 ? pinch.pivots.up : pinch.pivots.down;
  pinch.node.scale.copy(pinch.scale).multiplyScalar(factor);
  // The uniform scale commutes with the node's rotation: only its place relative to the pivot
  // is scaled.
  pinch.node.position.copy(pinch.position).sub(pivot).multiplyScalar(factor).add(pivot);
}
