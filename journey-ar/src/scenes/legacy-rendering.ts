import {
  type BufferGeometry,
  type Camera,
  LinearSRGBColorSpace,
  type Object3D,
  ShaderChunk,
  Vector3,
  type WebGLRenderer,
} from 'three';

/**
 * `decay` value for point and spot lights that selects Unity's legacy attenuation instead of
 * three.js' physical falloff (see `installUnityAttenuation`).
 */
export const UNITY_DECAY = -1;

const ATTENUATION_SIGNATURE =
  'float getDistanceAttenuation( const in float lightDistance, const in float cutoffDistance, const in float decayExponent ) {';

// Unity's built-in light attenuation texture: 1 / (1 + 25 d²) with d = distance / range,
// faded linearly to zero over the last part of the range (d² from 0.64 to 1).
const UNITY_ATTENUATION = `
float unityLegacyAttenuation( const in float lightDistance, const in float range ) {
	float d2 = pow2( lightDistance / range );
	float attenuation = 1.0 / ( 1.0 + 25.0 * d2 );
	return attenuation * saturate( 1.0 - ( d2 - 0.64 ) / 0.36 );
}
`;

function installUnityAttenuation(): void {
  const chunk = ShaderChunk.lights_pars_begin;
  if (chunk.includes('unityLegacyAttenuation')) return;
  if (!chunk.includes(ATTENUATION_SIGNATURE)) {
    throw new Error('three.js lights chunk changed: cannot install Unity light attenuation');
  }
  ShaderChunk.lights_pars_begin = chunk.replace(
    ATTENUATION_SIGNATURE,
    `${UNITY_ATTENUATION}\n${ATTENUATION_SIGNATURE}\n\tif ( decayExponent < 0.0 ) return unityLegacyAttenuation( lightDistance, cutoffDistance );`,
  );
}

interface SortItem {
  id: number;
  object: Object3D;
  geometry: BufferGeometry | null;
  groupOrder: number;
  renderOrder: number;
}

/**
 * Transparent sort like Unity's: back to front by the distance from the camera to the centre of
 * the object's bounds. three.js sorts by the object origin, which for many of the exported meshes
 * lies far from the geometry and puts layers in a different order.
 */
function unityTransparentSort(camera: Camera): (a: SortItem, b: SortItem) => number {
  const cameraPosition = new Vector3();
  const center = new Vector3();
  const distance = (item: SortItem): number => {
    const geometry = item.geometry;
    if (!geometry) return 0;
    if (!geometry.boundingSphere) geometry.computeBoundingSphere();
    center.copy(geometry.boundingSphere!.center).applyMatrix4(item.object.matrixWorld);
    cameraPosition.setFromMatrixPosition(camera.matrixWorld);
    return center.distanceToSquared(cameraPosition);
  };
  return (a, b) =>
    a.groupOrder - b.groupOrder ||
    a.renderOrder - b.renderOrder ||
    distance(b) - distance(a) ||
    a.id - b.id;
}

/**
 * Configures a renderer for content made in Unity's gamma colour space. Textures and colours
 * are used as stored (no sRGB decoding) and the output is not encoded, so the shader maths runs
 * on gamma values exactly like the original. Also installs Unity's point light attenuation and
 * transparent sorting. Call before the first render.
 */
export function configureLegacyRendering(renderer: WebGLRenderer, camera: Camera): void {
  renderer.outputColorSpace = LinearSRGBColorSpace;
  renderer.setTransparentSort(unityTransparentSort(camera));
  installUnityAttenuation();
}
