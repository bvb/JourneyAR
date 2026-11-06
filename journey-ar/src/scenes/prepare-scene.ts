import {
  AmbientLight,
  type AnimationClip,
  type BufferAttribute,
  Color,
  Float32BufferAttribute,
  type Light,
  type Material,
  type Mesh,
  type Object3D,
  PointLight,
  SpotLight,
  type Texture,
} from 'three';
import type { GLTF } from 'three/addons/loaders/GLTFLoader.js';
import { UNITY_DECAY } from './legacy-rendering';
import { createUnityMaterial, isUnityMaterial, type UnityMaterialExtras } from './unity-materials';
import { unityOffsetToThree } from './unity-space';

/** A component as written by the Unity exporter into node extras. */
interface UnityComponent {
  type: string;
  [field: string]: unknown;
}

export interface PrepareOptions {
  /**
   * Multiplier for direct and ambient light on lit materials. 1 matches Unity 6 (the reference
   * renders); the original Unity 4 build doubled direct light.
   */
  lightScale?: number;
}

export interface PreparedScene {
  /** Scene content in the target's local frame (target width = 1 unit, page in the XZ plane). */
  root: Object3D;
  animations: AnimationClip[];
  /** Shader names that have no dedicated conversion (rendered with a Lambert fallback). */
  unknownShaders: string[];
  /** Advances script-driven effects (UV scrolling) by `deltaSeconds`. */
  update(deltaSeconds: number): void;
}

function componentsOf(object: Object3D): UnityComponent[] {
  const components = object.userData['unityComponents'];
  return Array.isArray(components) ? (components as UnityComponent[]) : [];
}

function meshesOf(object: Object3D): Mesh[] {
  const meshes: Mesh[] = [];
  object.traverse((child) => {
    if ((child as Mesh).isMesh) meshes.push(child as Mesh);
  });
  return meshes;
}

/**
 * Vertex colours as the original shaders saw them. UnityGLTF writes RGB converted to linear
 * space; the gamma workflow needs the raw values. Alpha is kept: the transparent fixed-function
 * shader multiplies it in (verified against isolated renders of the mist and blob shadows).
 */
function restoreVertexColors(meshes: Mesh[]): void {
  const done = new Map<BufferAttribute, BufferAttribute>();
  const toGamma = (c: number) => (c <= 0.0031308 ? c * 12.92 : 1.055 * c ** (1 / 2.4) - 0.055);
  for (const mesh of meshes) {
    const colors = mesh.geometry.getAttribute('color') as BufferAttribute | undefined;
    if (!colors) continue;
    let gamma = done.get(colors);
    if (!gamma) {
      const size = colors.itemSize;
      const values = new Float32Array(colors.count * size);
      for (let i = 0; i < colors.count; i++) {
        values[i * size] = toGamma(colors.getX(i));
        values[i * size + 1] = toGamma(colors.getY(i));
        values[i * size + 2] = toGamma(colors.getZ(i));
        if (size === 4) values[i * size + 3] = colors.getW(i);
      }
      gamma = new Float32BufferAttribute(values, size);
      done.set(colors, gamma);
    }
    mesh.geometry.setAttribute('color', gamma);
  }
}

/** Replaces the materials created by GLTFLoader with conversions of the original Unity ones. */
async function convertMaterials(gltf: GLTF, meshes: Mesh[]): Promise<string[]> {
  const cache = new Map<string, Promise<{ material: Material; known: boolean }>>();
  const unknown = new Set<string>();
  for (const mesh of meshes) {
    const source = mesh.material as Material;
    if (!isUnityMaterial(source.userData)) continue;
    const extras = source.userData as UnityMaterialExtras;
    const vertexColors = mesh.geometry.hasAttribute('color');
    const key = `${extras.unityMaterial}|${extras.unityShader}|${source.uuid}|${vertexColors}`;
    let pending = cache.get(key);
    if (!pending) {
      pending = createUnityMaterial(extras, { parser: gltf.parser, vertexColors });
      cache.set(key, pending);
    }
    const { material, known } = await pending;
    if (!known) unknown.add(extras.unityShader);
    material.userData = { ...extras };
    mesh.material = material;
  }
  return [...unknown];
}

/** Sets the lights GLTFLoader created from KHR_lights_punctual to the original Unity values. */
function convertLights(root: Object3D, lightScale: number): void {
  const lights: Light[] = [];
  root.traverse((object) => {
    if ((object as Light).isLight) lights.push(object as Light);
  });
  for (const light of lights) {
    const source = [
      ...componentsOf(light),
      ...(light.parent ? componentsOf(light.parent) : []),
    ].find((c) => c.type === 'Light');
    if (!source) continue;
    const [r = 1, g = 1, b = 1] = (source['color'] as number[] | undefined) ?? [];
    light.color = new Color(r, g, b);
    // Unity: albedo * colour * intensity * N·L; three.js divides diffuse by PI.
    light.intensity = Math.PI * Number(source['intensity'] ?? 1) * lightScale;
    if (light instanceof PointLight || light instanceof SpotLight) {
      light.distance = Number(source['range'] ?? 0);
      light.decay = UNITY_DECAY;
    }
  }
}

interface UvScroll {
  texture: Texture;
  rate: [number, number];
  scale: [number, number];
}

/** The meshes a node renders with, in Unity submesh (= glTF primitive) order. */
function primitivesOf(object: Object3D, gltf: GLTF): Mesh[] {
  if ((object as Mesh).isMesh) return [object as Mesh];
  return object.children.filter(
    (child) =>
      (child as Mesh).isMesh && gltf.parser.associations.get(child)?.primitives !== undefined,
  ) as Mesh[];
}

/**
 * AnimatedUVs_* scripts scroll a texture of one renderer: uvOffset += rate * dt, written to
 * renderer.materials[materialIndex] (a per-renderer copy, replacing the material's own offset),
 * so the material is cloned here too.
 */
function collectUvScrolls(gltf: GLTF): UvScroll[] {
  type Mapped = Material & { map?: Texture | null };
  const scrolls: UvScroll[] = [];
  gltf.scene.traverse((object) => {
    for (const component of componentsOf(object)) {
      if (!component.type.startsWith('AnimatedUVs') || component['enabled'] === false) continue;
      const mesh = primitivesOf(object, gltf)[Number(component['materialIndex'] ?? 0)];
      if (!mesh || component['textureName'] !== '_MainTex') continue;
      const material = (mesh.material as Mapped).clone() as Mapped;
      if (!material.map) continue;
      material.map = material.map.clone();
      mesh.material = material;
      const [x = 0, y = 0] = (component['uvAnimationRate'] as number[] | undefined) ?? [];
      scrolls.push({
        texture: material.map,
        rate: [x, y],
        scale: [material.map.repeat.x, material.map.repeat.y],
      });
    }
  });
  return scrolls;
}

/**
 * Turns a GLB exported from the Unity scene into renderable content: original materials,
 * lights and ambient, gamma vertex colours and UV scrolling.
 */
export async function prepareUnityScene(
  gltf: GLTF,
  options: PrepareOptions = {},
): Promise<PreparedScene> {
  const lightScale = options.lightScale ?? 1;
  const root = gltf.scene;
  const meshes = meshesOf(root);

  restoreVertexColors(meshes);
  const unknownShaders = await convertMaterials(gltf, meshes);
  convertLights(root, lightScale);

  const [r = 0, g = 0, b = 0] = (root.userData['ambient'] as number[] | undefined) ?? [];
  root.add(new AmbientLight(new Color(r, g, b), Math.PI * lightScale));

  const scrolls = collectUvScrolls(gltf);
  let elapsed = 0;
  return {
    root,
    animations: gltf.animations,
    unknownShaders,
    update(deltaSeconds: number) {
      elapsed += deltaSeconds;
      for (const { texture, rate, scale } of scrolls) {
        // Repeat wrapping: only the fractional part of the offset matters.
        const offset: [number, number] = [(rate[0] * elapsed) % 1, (rate[1] * elapsed) % 1];
        texture.offset.fromArray(unityOffsetToThree(offset, scale));
      }
    },
  };
}
