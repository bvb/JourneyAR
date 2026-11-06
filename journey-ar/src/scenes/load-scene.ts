import type { AnimationClip, Object3D } from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

export interface LoadedScene {
  /** Scene content in the target's local frame (target width = 1 unit, page in the XZ plane). */
  root: Object3D;
  animations: AnimationClip[];
}

/** Loads an AR scene exported from Unity (one GLB per image target). */
export async function loadScene(url: string): Promise<LoadedScene> {
  const gltf = await new GLTFLoader().loadAsync(url);
  return { root: gltf.scene, animations: gltf.animations };
}
