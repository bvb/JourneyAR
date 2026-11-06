import { Vector3 } from 'three';

export type Vec3 = readonly [number, number, number];

/**
 * Converts a point or direction from Unity's left-handed coordinates to glTF / three.js.
 * UnityGLTF mirrors the X axis (SchemaExtensions.CoordinateSpaceConversionScale = (-1, 1, 1)),
 * so data from Unity must use the same convention to line up with the exported GLB files.
 */
export function unityToThree([x, y, z]: Vec3): Vector3 {
  return new Vector3(-x, y, z);
}
