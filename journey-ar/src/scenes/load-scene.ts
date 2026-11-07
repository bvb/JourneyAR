import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js';
import { type PreparedScene, type PrepareOptions, prepareUnityScene } from './prepare-scene';

/**
 * Loads an AR scene exported from Unity (one GLB per image target), ready to render with a
 * renderer set up by `configureLegacyRendering`. The published scenes are compressed
 * (EXT_meshopt_compression, KHR_mesh_quantization, EXT_texture_webp: tools/assets/optimize.mjs).
 */
export async function loadScene(url: string, options?: PrepareOptions): Promise<PreparedScene> {
  const gltf = await new GLTFLoader().setMeshoptDecoder(MeshoptDecoder).loadAsync(url);
  return prepareUnityScene(gltf, options);
}
