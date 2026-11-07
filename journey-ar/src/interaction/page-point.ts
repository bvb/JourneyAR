import { Matrix4, Vector3 } from 'three';

const cameraToPage = new Matrix4();
const origin = new Vector3();
const direction = new Vector3();

/**
 * The point of the page plane (page frame, mm, z = 0) seen at a point of the view: where the ray
 * from the camera through (ndcX, ndcY) (normalized device coordinates, -1..1, Y up) meets the
 * page. `pageToCamera` is the page pose (page frame -> camera frame, the camera at the origin);
 * `projectionInverse` the inverse of the camera's projection. Null when the ray does not meet
 * the plane in front of the camera, or meets it further than `maxDistance` mm from the page
 * centre (a ray close to the horizon).
 */
export function pagePointAt(
  ndcX: number,
  ndcY: number,
  pageToCamera: Matrix4,
  projectionInverse: Matrix4,
  maxDistance = 3000,
): Vector3 | null {
  cameraToPage.copy(pageToCamera).invert();
  origin.set(0, 0, 0).applyMatrix4(cameraToPage);
  direction.set(ndcX, ndcY, -1).applyMatrix4(projectionInverse).applyMatrix4(cameraToPage);
  direction.sub(origin);
  if (Math.abs(direction.z) < 1e-9) return null;
  const t = -origin.z / direction.z;
  if (!(t > 0)) return null;
  const point = origin.clone().addScaledVector(direction, t);
  return Math.hypot(point.x, point.y) <= maxDistance ? point : null;
}
