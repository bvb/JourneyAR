import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { type PreparedScene, type PrepareOptions, prepareUnityScene } from './prepare-scene';

/**
 * Loads an AR scene exported from Unity (one GLB per image target), ready to render with a
 * renderer set up by `configureLegacyRendering`.
 */
export async function loadScene(url: string, options?: PrepareOptions): Promise<PreparedScene> {
  const gltf = await new GLTFLoader().loadAsync(url);
  return prepareUnityScene(gltf, options);
}
