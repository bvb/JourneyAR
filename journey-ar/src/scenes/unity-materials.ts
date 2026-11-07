import {
  AddEquation,
  AdditiveBlending,
  ClampToEdgeWrapping,
  Color,
  CustomBlending,
  DataTexture,
  DoubleSide,
  type Material,
  Matrix3,
  MeshBasicMaterial,
  MeshLambertMaterial,
  MeshPhongMaterial,
  MeshStandardMaterial,
  MirroredRepeatWrapping,
  NearestFilter,
  NoColorSpace,
  OneFactor,
  RepeatWrapping,
  ShaderMaterial,
  type Texture,
  type Wrapping,
} from 'three';
import type { GLTFParser } from 'three/addons/loaders/GLTFLoader.js';
import { unityOffsetToThree } from './unity-space';

/** A texture property as written by the Unity exporter into material extras. */
export interface UnityTextureRef {
  texture: string;
  /** glTF texture index. */
  index: number | null;
  scale: [number, number];
  offset: [number, number];
  wrapU: string;
  wrapV: string;
  filter: string;
}

export type UnityPropertyValue = number | number[] | UnityTextureRef | null;

/** Material extras written by the Unity exporter: the original shader and its properties. */
export interface UnityMaterialExtras {
  unityMaterial: string;
  unityShader: string;
  properties: Record<string, UnityPropertyValue>;
}

export interface MaterialContext {
  parser: GLTFParser;
  /** Whether the mesh using the material has vertex colours. */
  vertexColors: boolean;
}

// Unity's lightmap and "double" combiners multiply by 1 and 2; three.js divides indirect light
// by PI, so lightmaps need an intensity of PI to come out as a plain multiplication.
const LIGHTMAP_INTENSITY = Math.PI;

export function isUnityMaterial(userData: Record<string, unknown>): boolean {
  return typeof userData['unityShader'] === 'string';
}

function isTextureRef(value: UnityPropertyValue | undefined): value is UnityTextureRef {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function colorOf(props: UnityMaterialExtras['properties'], name: string, factor = 1): Color {
  const value = props[name];
  const [r = 1, g = 1, b = 1] = Array.isArray(value) ? value : [];
  // Raw gamma-space values: the renderer runs in Unity's gamma workflow.
  return new Color(r * factor, g * factor, b * factor);
}

function alphaOf(props: UnityMaterialExtras['properties'], name: string): number {
  const value = props[name];
  return Array.isArray(value) ? (value[3] ?? 1) : 1;
}

function numberOf(
  props: UnityMaterialExtras['properties'],
  name: string,
  fallback: number,
): number {
  const value = props[name];
  return typeof value === 'number' ? value : fallback;
}

const WRAPPING: Record<string, Wrapping> = {
  Repeat: RepeatWrapping,
  Clamp: ClampToEdgeWrapping,
  Mirror: MirroredRepeatWrapping,
  MirrorOnce: MirroredRepeatWrapping,
};

/**
 * A material texture: a clone of the GLB texture with Unity's tiling/offset, wrap and filter
 * applied (the clone shares the image).
 */
async function textureOf(
  ctx: MaterialContext,
  props: UnityMaterialExtras['properties'],
  name: string,
  channel = 0,
): Promise<Texture | null> {
  const ref = props[name];
  if (!isTextureRef(ref) || ref.index === null) return null;
  const source = (await ctx.parser.getDependency('texture', ref.index)) as Texture;
  const texture = source.clone();
  texture.name = ref.texture;
  texture.colorSpace = NoColorSpace;
  texture.wrapS = WRAPPING[ref.wrapU] ?? RepeatWrapping;
  texture.wrapT = WRAPPING[ref.wrapV] ?? RepeatWrapping;
  if (ref.filter === 'Point') texture.magFilter = NearestFilter;
  texture.repeat.set(ref.scale[0], ref.scale[1]);
  texture.offset.fromArray(unityOffsetToThree(ref.offset, ref.scale));
  texture.channel = channel;
  texture.needsUpdate = true;
  return texture;
}

/**
 * Lambert material whose albedo is multiplied by a detail texture on the second UV set, times
 * two ("MyShaders/Diffuse Detail 2 UV sets").
 */
function withDetail(material: MeshLambertMaterial, detail: Texture | null): MeshLambertMaterial {
  if (!detail) return material;
  detail.updateMatrix();
  const detailTransform = new Matrix3().copy(detail.matrix);
  material.onBeforeCompile = (shader) => {
    shader.uniforms['detailMap'] = { value: detail };
    shader.uniforms['detailTransform'] = { value: detailTransform };
    shader.vertexShader = shader.vertexShader
      .replace(
        '#include <common>',
        '#include <common>\n#ifndef USE_UV1\nattribute vec2 uv1;\n#endif\nuniform mat3 detailTransform;\nvarying vec2 vDetailUv;',
      )
      .replace(
        '#include <uv_vertex>',
        '#include <uv_vertex>\nvDetailUv = ( detailTransform * vec3( uv1, 1.0 ) ).xy;',
      );
    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <common>',
        '#include <common>\nuniform sampler2D detailMap;\nvarying vec2 vDetailUv;',
      )
      .replace(
        '#include <map_fragment>',
        '#include <map_fragment>\ndiffuseColor.rgb *= texture2D( detailMap, vDetailUv ).rgb * 2.0;',
      );
  };
  material.customProgramCacheKey = () => 'unity-diffuse-detail';
  return material;
}

function whiteTexture(): Texture {
  const texture = new DataTexture(new Uint8Array([255, 255, 255, 255]), 1, 1);
  texture.needsUpdate = true;
  return texture;
}

/**
 * The "Shield" shader of the original build (restored by tools/unity/additions): an additive,
 * double-sided glow whose brightness follows the facing ratio |view . normal| through a ramp
 * texture, times a surface texture and the tint (Blend One One, no depth write).
 */
function shieldMaterial(
  name: string,
  surface: Texture,
  ramp: Texture,
  tint: Color,
  tintAlpha: number,
  offset: number,
): ShaderMaterial {
  surface.updateMatrix();
  return new ShaderMaterial({
    name,
    uniforms: {
      surfaceTex: { value: surface },
      surfaceTransform: { value: new Matrix3().copy(surface.matrix) },
      rampTex: { value: ramp },
      tint: { value: tint },
      tintAlpha: { value: tintAlpha },
      offset: { value: offset },
    },
    vertexShader: /* glsl */ `
      uniform mat3 surfaceTransform;
      uniform float offset;
      varying vec2 vSurfaceUv;
      varying float vFacing;
      void main() {
        vec4 viewPosition = modelViewMatrix * vec4(position, 1.0);
        vec3 viewNormal = normalize(normalMatrix * normal);
        vFacing = abs(dot(normalize(-viewPosition.xyz), viewNormal));
        // glTF flips V against Unity: Unity's v + _Offset is v - offset here.
        vSurfaceUv = (surfaceTransform * vec3(uv.x, uv.y - offset, 1.0)).xy;
        gl_Position = projectionMatrix * viewPosition;
      }`,
    fragmentShader: /* glsl */ `
      uniform sampler2D surfaceTex;
      uniform sampler2D rampTex;
      uniform vec3 tint;
      uniform float tintAlpha;
      varying vec2 vSurfaceUv;
      varying float vFacing;
      void main() {
        vec4 ramp = texture2D(rampTex, vec2(vFacing, 0.5)) * tintAlpha;
        vec4 color = texture2D(surfaceTex, vSurfaceUv) * ramp * vec4(tint, tintAlpha);
        gl_FragColor = vec4(color.rgb, ramp.r);
      }`,
    transparent: true,
    depthWrite: false,
    side: DoubleSide,
    blending: CustomBlending,
    blendEquation: AddEquation,
    blendSrc: OneFactor,
    blendDst: OneFactor,
  });
}

/**
 * Builds the three.js material that reproduces a Unity material, from the original shader name
 * and properties. Unlit shaders map to MeshBasicMaterial, legacy lit ones to Lambert/Phong.
 * Faces are culled like in Unity (no shader of the scenes disables culling).
 */
export async function createUnityMaterial(
  extras: UnityMaterialExtras,
  ctx: MaterialContext,
): Promise<{ material: Material; known: boolean }> {
  const p = extras.properties;
  const name = extras.unityMaterial;
  const map = await textureOf(ctx, p, '_MainTex');

  switch (extras.unityShader) {
    // Fixed function, lighting off: texture * vertex colour * _Color * 2.
    case 'Mobile/Vertex Colored':
      return {
        known: true,
        material: new MeshBasicMaterial({
          name,
          map,
          color: colorOf(p, '_Color', 2),
          vertexColors: ctx.vertexColors,
        }),
      };

    // Same, alpha blended, no depth write, alpha test "Greater 0". Unity's "double" combiner
    // doubles alpha as well (texture alpha * vertex alpha * _Color.a * 2); measured against
    // renders of the mist and the blob shadows.
    case 'Mobile/Transparent/Vertex Color':
      return {
        known: true,
        material: new MeshBasicMaterial({
          name,
          map,
          color: colorOf(p, '_Color', 2),
          opacity: alphaOf(p, '_Color') * 2,
          vertexColors: ctx.vertexColors,
          transparent: true,
          depthWrite: false,
          alphaTest: 0.001,
        }),
      };

    // Fixed function: lightmap (second UV set) * _Color * texture.
    case 'Mobile/Legacy/Lightmap/Lightmap Only':
      return {
        known: true,
        material: new MeshBasicMaterial({
          name,
          map,
          color: colorOf(p, '_Color'),
          lightMap: await textureOf(ctx, p, '_LightMap', 1),
          lightMapIntensity: LIGHTMAP_INTENSITY,
        }),
      };

    case 'Mobile/Particles/Additive Culled':
      return {
        known: true,
        material: new MeshBasicMaterial({
          name,
          map,
          color: colorOf(p, '_TintColor', 2),
          opacity: Math.min(1, alphaOf(p, '_TintColor') * 2),
          vertexColors: ctx.vertexColors,
          transparent: true,
          depthWrite: false,
          blending: AdditiveBlending,
          alphaTest: 0.01,
        }),
      };

    case 'Unlit/Texture':
    case 'Mobile/Unlit (Supports Lightmap)':
      return { known: true, material: new MeshBasicMaterial({ name, map }) };

    case 'Legacy Shaders/Diffuse':
    case 'Mobile/Diffuse':
      return {
        known: true,
        material: new MeshLambertMaterial({ name, map, color: colorOf(p, '_Color') }),
      };

    case 'Legacy Shaders/Transparent/Cutout/Diffuse':
      return {
        known: true,
        material: new MeshLambertMaterial({
          name,
          map,
          color: colorOf(p, '_Color'),
          alphaTest: numberOf(p, '_Cutoff', 0.5),
        }),
      };

    case 'Mobile/Bumped Diffuse':
      return {
        known: true,
        material: new MeshLambertMaterial({
          name,
          map,
          normalMap: await textureOf(ctx, p, '_BumpMap'),
        }),
      };

    case 'MyShaders/Diffuse Detail 2 UV sets':
      return {
        known: true,
        material: withDetail(
          new MeshLambertMaterial({ name, map, color: colorOf(p, '_Color') }),
          await textureOf(ctx, p, '_Detail', 1),
        ),
      };

    // Legacy lightmapped: emission = lightmap * albedo, plus regular lighting.
    case 'Legacy Shaders/Lightmapped/Specular':
      return {
        known: true,
        material: new MeshPhongMaterial({
          name,
          map,
          color: colorOf(p, '_Color'),
          specular: colorOf(p, '_SpecColor'),
          shininess: numberOf(p, '_Shininess', 0.078125) * 128,
          lightMap: await textureOf(ctx, p, '_LightMap', 1),
          lightMapIntensity: LIGHTMAP_INTENSITY,
        }),
      };

    case 'Shield':
      return {
        known: true,
        material: shieldMaterial(
          name,
          (await textureOf(ctx, p, '_SurfaceTex')) ?? whiteTexture(),
          (await textureOf(ctx, p, '_RampTex')) ?? whiteTexture(),
          colorOf(p, '_Color'),
          alphaOf(p, '_Color'),
          numberOf(p, '_Offset', 0),
        ),
      };

    case 'Standard':
      return {
        known: true,
        material: new MeshStandardMaterial({
          name,
          map,
          color: colorOf(p, '_Color'),
          roughness: 1 - numberOf(p, '_Glossiness', 0.5),
          metalness: numberOf(p, '_Metallic', 0),
        }),
      };

    default:
      return {
        known: false,
        material: new MeshLambertMaterial({ name, map, color: colorOf(p, '_Color') }),
      };
  }
}
