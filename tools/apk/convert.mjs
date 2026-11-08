// Converts the scenes of the original app, read from its APK by read-apk.py, into one GLB per
// image target (tools/.out/export/<id>.glb) and export-report.json: the input of
// assets/publish.mjs. Written for this APK only (the 2012 build, Unity 3.5.5f3).
//
// The output keeps the format of the former Unity export (UnityGLTF 2.24 with the Journey
// exporter's extras), which the app and the publishing step are built on:
// - the active children of each IT_* root are the glTF roots, in the target's local frame
//   (target width = 1 unit, page in the XZ plane); X is mirrored (Unity is left-handed);
// - a node with an enabled renderer gets a mesh named after it, one primitive per submesh;
//   triangle strips become triangle lists, non-unit normals are normalized; UV v is flipped,
//   vertex colours are written in linear space;
// - lights as KHR_lights_punctual (a light node's rotation turned to look down -Z, its children
//   under an extra "<name>-flipped" node); skins with the mesh bind poses;
// - legacy animation curves sampled at 30 fps (linear), keys equal to both neighbours dropped;
// - extras: the original shader and all its properties on materials (textures by glTF index,
//   with Unity tiling/offset, wrap and filter), lights, audio sources and script fields on nodes,
//   ambient light on the scene.
// Fixes the Unity project used to need are made here: the materials get the render queue of
// their shader, the built-in shaders their Unity 5+ names, ARGB4444 textures their channel order
// (read-apk.py).
//
// First runs read-apk.py on the APK (Python with UnityPy: npm run apk:setup), unless
// --skip-read is given.
// Usage: node apk/convert.mjs [--skip-read] [--in=<read-apk output>] [--out=<export dir>]
import { Document, NodeIO } from '@gltf-transform/core';
import {
  KHRLightsPunctual,
  KHRMaterialsUnlit,
  KHRTextureTransform,
} from '@gltf-transform/extensions';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';
import { APK_OUT, ORIGINAL_APK, PIPELINE_OUT, PYTHON } from '../config.mjs';
import { patchGlbJson } from '../assets/glb.mjs';
import { ApkData } from './apk-data.mjs';
import { curveNumber, dropUnneededKeys, evaluateCurve, sampleTimes } from './curves.mjs';

const option = (name) =>
  process.argv.find((a) => a.startsWith(`--${name}=`))?.slice(name.length + 3);
const inDir = path.resolve(option('in') ?? APK_OUT);
const outDir = path.resolve(option('out') ?? path.join(PIPELINE_OUT, 'export'));

if (!process.argv.includes('--skip-read')) {
  if (!existsSync(PYTHON)) throw new Error(`No Python at ${PYTHON}; run npm run apk:setup`);
  const reader = fileURLToPath(new URL('read-apk.py', import.meta.url));
  console.log(`reading   ${path.relative(process.cwd(), ORIGINAL_APK)}`);
  const read = spawnSync(PYTHON, ['-I', reader, ORIGINAL_APK, inDir], { stdio: 'inherit' });
  if (read.status !== 0) throw new Error(`read-apk.py failed (exit code ${read.status})`);
}

const BAKING_FPS = 30;
const JPEG_QUALITY = 90;
const EDITOR_ONLY_TAG = 3;
// Built-in shaders were renamed in Unity 5; the app knows them by the new names.
const BUILTIN_SHADER_NAMES = {
  Diffuse: 'Legacy Shaders/Diffuse',
  'Transparent/Cutout/Diffuse': 'Legacy Shaders/Transparent/Cutout/Diffuse',
};
const QUEUES = {
  Background: 1000,
  Geometry: 2000,
  AlphaTest: 2450,
  Transparent: 3000,
  Overlay: 4000,
};
const LIGHT_TYPES = ['Spot', 'Directional', 'Point'];
const RENDER_MODES = ['Auto', 'ForcePixel', 'ForceVertex'];
const WRAP_MODES = ['Repeat', 'Clamp'];
const FILTER_MODES = ['Point', 'Bilinear', 'Trilinear'];
const CLIP_WRAP_MODES = { 0: 'Default', 1: 'Once', 2: 'Loop', 4: 'PingPong', 8: 'ClampForever' };
const GL = { LINEAR: 9729, LINEAR_MIPMAP_LINEAR: 9987, NEAREST: 9728, CLAMP_TO_EDGE: 33071 };

const apk = new ApkData(inDir);

/** Shortest decimal that is the same 32-bit float (Unity writes floats like this). */
function f32(x) {
  if (typeof x !== 'number' || !Number.isFinite(x)) return x;
  const f = Math.fround(x);
  for (let p = 1; p <= 9; p += 1) {
    const s = Number(f.toPrecision(p));
    if (Math.fround(s) === f) return s;
  }
  return f;
}
const vec = (v, keys) => keys.map((k) => f32(v[k]));
const color = (c) => vec(c, ['r', 'g', 'b', 'a']);
const toLinear = (c) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);

// --- Unity -> glTF space (X mirrored) ---------------------------------------------------------

const position = (p) => [f32(-p.x), f32(p.y), f32(p.z)];
const scale = (s) => [f32(s.x), f32(s.y), f32(s.z)];
function quatMultiply(a, b) {
  const [ax, ay, az, aw] = a;
  const [bx, by, bz, bw] = b;
  return [
    aw * bx + ax * bw + ay * bz - az * by,
    aw * by - ax * bz + ay * bw + az * bx,
    aw * bz + ax * by - ay * bx + az * bw,
    aw * bw - ax * bx - ay * by - az * bz,
  ];
}
/** Rotation to glTF; lights look down +Z in Unity and -Z in glTF (turned about Y). */
function rotation(q, light = false) {
  let r = [q.x ?? q[0], q.y ?? q[1], q.z ?? q[2], q.w ?? q[3]];
  if (light) r = quatMultiply(r, [0, -1, 0, 0]);
  const len = Math.hypot(...r) || 1;
  return [f32(r[0] / len), f32(-r[1] / len), f32(-r[2] / len), f32(r[3] / len)];
}
/** A Unity matrix (e00..e33, row-major) mirrored in X, as a column-major glTF array. */
function matrix(m) {
  const s = [-1, 1, 1, 1];
  const out = new Float32Array(16);
  for (let r = 0; r < 4; r += 1) {
    for (let c = 0; c < 4; c += 1) out[c * 4 + r] = s[r] * m[`e${r}${c}`] * s[c];
  }
  return out;
}

// --- Shaders ----------------------------------------------------------------------------------

const shaderCache = new Map();
/** Name, properties (with defaults), RenderType and render queue of a shader from its source. */
function shaderInfo(ref) {
  const shader = apk.get(ref);
  if (!shader) throw new Error('Material without a shader');
  if (shaderCache.has(shader.id)) return shaderCache.get(shader.id);
  const text = shader.data.m_Script;
  const originalName = /Shader\s+"([^"]+)"/.exec(text)?.[1];
  const block = /Properties\s*\{([\s\S]*?)\n\s*\}/.exec(text)?.[1] ?? '';
  const properties = [];
  const pattern =
    /^\s*(?:\[[^\]]*\]\s*)*(\w+)\s*\(\s*"[^"]*"\s*,\s*(Color|Vector|Float|Int|Range\s*\([^)]*\)|2D|3D|Cube|Rect)\s*\)\s*=\s*([^\n]*)$/gm;
  for (const [, name, type, value] of block.matchAll(pattern)) {
    const kind = type.startsWith('Range') ? 'Float' : type;
    let fallback = null;
    if (kind === 'Color' || kind === 'Vector') {
      fallback = value
        .replace(/[()\s]/g, '')
        .split(',')
        .map(Number);
    } else if (kind === 'Float' || kind === 'Int') {
      fallback = Number(value.trim());
    }
    properties.push({
      name,
      kind: ['2D', '3D', 'Cube', 'Rect'].includes(kind) ? 'Texture' : kind,
      fallback,
    });
  }
  const tag = (name) => new RegExp(`"${name}"\\s*=\\s*"([^"]+)"`, 'i').exec(text)?.[1];
  const queueTag = tag('Queue');
  let queue = 2000;
  if (queueTag) {
    const [, base, offset] = /^(\w+)([+-]\d+)?$/.exec(queueTag) ?? [];
    const key = Object.keys(QUEUES).find((k) => k.toLowerCase() === base?.toLowerCase());
    queue = (QUEUES[key] ?? 2000) + Number(offset ?? 0);
  }
  const builtin = shader.id.startsWith('unity default resources:');
  const info = {
    name: builtin ? (BUILTIN_SHADER_NAMES[originalName] ?? originalName) : originalName,
    properties,
    renderType: tag('RenderType') ?? '',
    queue,
  };
  shaderCache.set(shader.id, info);
  return info;
}

// --- Scene traversal --------------------------------------------------------------------------

function componentsOf(gameObject, type) {
  return apk.components(gameObject).filter((c) => c.type === type);
}
const firstOf = (gameObject, type) => componentsOf(gameObject, type)[0] ?? null;
const isActive = (gameObject) => Boolean(gameObject.data.m_IsActive);
const enabled = (component) => Boolean(component?.data.m_Enabled);
const exported = (gameObject) => isActive(gameObject) && gameObject.data.m_Tag !== EDITOR_ONLY_TAG;

/** Descendants (with the given objects themselves) whose whole chain is active. */
function activeTree(gameObjects) {
  const out = [];
  const visit = (go) => {
    if (!isActive(go)) return;
    out.push(go);
    for (const child of apk.children(go)) visit(child);
  };
  for (const go of gameObjects) visit(go);
  return out;
}

/** Transform.Find: a path of child names, separated by "/". */
function findPath(gameObject, target) {
  let current = gameObject;
  for (const name of target.split('/').filter(Boolean)) {
    current = apk.children(current).find((child) => child.data.m_Name === name);
    if (!current) return null;
  }
  return current;
}

// --- Meshes -----------------------------------------------------------------------------------

function meshData(meshRef) {
  const mesh = apk.get(meshRef);
  if (!mesh) return null;
  const decoded = mesh.decoded;
  const normals = apk.array(decoded.normals);
  let normalized = false;
  let fixedNormals = normals;
  if (normals) {
    let bad = false;
    for (let i = 0; i < normals.length; i += 3) {
      const sq = normals[i] ** 2 + normals[i + 1] ** 2 + normals[i + 2] ** 2;
      if (Math.abs(sq - 1) > 1e-3) bad = true;
    }
    if (bad) {
      normalized = true;
      fixedNormals = new Float32Array(normals.length);
      for (let i = 0; i < normals.length; i += 3) {
        const len = Math.hypot(normals[i], normals[i + 1], normals[i + 2]);
        if (len > 1e-6) {
          for (let k = 0; k < 3; k += 1) fixedNormals[i + k] = normals[i + k] / len;
        } else fixedNormals.set([0, 1, 0], i);
      }
    }
  }
  return {
    id: mesh.id,
    name: mesh.data.m_Name,
    decoded,
    normals: fixedNormals,
    normalized,
    strips: mesh.data.m_SubMeshes.some((s) => s.isTriStrip),
    submeshes: decoded.submeshes.map((view) => apk.array(view)),
    bindPoses: mesh.data.m_BindPose ?? [],
  };
}

function trianglesOf(mesh) {
  return mesh ? mesh.submeshes.reduce((sum, indices) => sum + indices.length / 3, 0) : 0;
}

// --- Conversion of one target -----------------------------------------------------------------

class TargetConverter {
  constructor(root) {
    this.root = root;
    this.document = new Document();
    this.document.createBuffer();
    this.lights = this.document.createExtension(KHRLightsPunctual);
    this.unlit = this.document.createExtension(KHRMaterialsUnlit);
    this.transform = this.document.createExtension(KHRTextureTransform);
    this.nodes = new Map(); // GameObject id -> glTF node
    this.meshes = new Map(); // mesh id + materials -> glTF mesh
    this.accessors = new Map(); // mesh id -> shared vertex accessors
    this.materials = new Map(); // material id -> glTF material
    this.textures = new Map(); // texture id -> glTF texture
    this.skinned = [];
    this.animated = [];
    this.targetScale = root.data && apk.transform(root).data.m_LocalScale.x;
  }

  async convert(id) {
    const scene = this.document.createScene(id);
    const children = apk.children(this.root);
    const roots = children.filter(exported);
    for (const child of roots) scene.addChild(await this.node(child));
    const rs = apk.renderSettings;
    scene.setExtras({
      unityColorSpace: 'Gamma',
      ambientMode: 'Flat',
      ambient: color(rs.m_AmbientLight),
      fog: Boolean(rs.m_Fog),
    });
    for (const go of this.skinned) this.skin(go);
    const clips = this.animations(roots);
    this.report = this.describe(id, children, roots, clips);
    // Only the extensions the scene uses.
    const root = this.document.getRoot();
    if (root.listNodes().every((node) => !node.getExtension('KHR_lights_punctual')))
      this.lights.dispose();
    if (root.listMaterials().every((m) => !m.getExtension('KHR_materials_unlit')))
      this.unlit.dispose();
    return this.document;
  }

  async node(gameObject) {
    const transform = apk.transform(gameObject).data;
    const light = firstOf(gameObject, 'Light');
    const node = this.document
      .createNode(gameObject.data.m_Name)
      .setTranslation(position(transform.m_LocalPosition))
      .setRotation(rotation(transform.m_LocalRotation, Boolean(light && enabled(light))))
      .setScale(scale(transform.m_LocalScale));
    this.nodes.set(gameObject.id, node);
    if (light && enabled(light))
      node.setExtension('KHR_lights_punctual', this.light(light, gameObject));

    const mesh = await this.mesh(gameObject);
    if (mesh) node.setMesh(mesh);
    if (firstOf(gameObject, 'Animation')) this.animated.push(gameObject);
    const smr = firstOf(gameObject, 'SkinnedMeshRenderer');
    if (smr && mesh) this.skinned.push(gameObject);

    const children = apk.children(gameObject).filter(exported);
    if (children.length > 0) {
      let parent = node;
      if (light && enabled(light)) {
        parent = this.document
          .createNode(`${gameObject.data.m_Name}-flipped`)
          .setRotation([0, -1, 0, 0]);
        node.addChild(parent);
      }
      for (const child of children) parent.addChild(await this.node(child));
    }
    const extras = this.componentExtras(gameObject);
    if (extras) node.setExtras(extras);
    return node;
  }

  light(component, gameObject) {
    const d = component.data;
    const type = LIGHT_TYPES[d.m_Type];
    const linear = [toLinear(d.m_Color.r), toLinear(d.m_Color.g), toLinear(d.m_Color.b)].map(f32);
    const light = this.lights
      .createLight(gameObject.data.m_Name)
      .setType(type.toLowerCase())
      .setColor(linear);
    const intensity = d.m_Intensity * Math.PI;
    if (type === 'Spot') {
      light.setIntensity(f32(((intensity * intensity) / 4) * Math.SQRT2));
      light.setRange(f32(d.m_Range));
      light.setOuterConeAngle(f32(((d.m_SpotAngle / 2) * Math.PI) / 180));
      light.setInnerConeAngle(f32((((d.m_SpotAngle / 2) * Math.PI) / 180) * 0.8));
    } else {
      light.setIntensity(f32(intensity * d.m_Intensity));
      if (type === 'Point') light.setRange(f32(d.m_Range));
    }
    return light;
  }

  /** Light, AudioSource and script components of a node (the exporter's DescribeComponents). */
  componentExtras(gameObject) {
    const components = [];
    for (const light of componentsOf(gameObject, 'Light')) {
      const d = light.data;
      components.push({
        type: 'Light',
        enabled: enabled(light),
        lightType: LIGHT_TYPES[d.m_Type],
        color: color(d.m_Color),
        intensity: f32(d.m_Intensity),
        range: f32(d.m_Range / this.targetScale),
        spotAngle: f32(d.m_SpotAngle),
        renderMode: RENDER_MODES[d.m_RenderMode] ?? 'Auto',
      });
    }
    for (const source of componentsOf(gameObject, 'AudioSource')) {
      const d = source.data;
      const clip = apk.get(d.m_audioClip);
      components.push({
        type: 'AudioSource',
        clip: clip ? clip.data.m_Name : null,
        clipPath: clip ? clip.file : null,
        volume: f32(d.m_Volume),
        loop: Boolean(d.Loop),
        playOnAwake: Boolean(d.m_PlayOnAwake),
        // Unity 3.5 kept 2D/3D on the clip.
        spatialBlend: clip?.data.m_3D ? 1 : 0,
      });
    }
    for (const behaviour of componentsOf(gameObject, 'MonoBehaviour')) {
      const type = apk.scriptName(behaviour);
      const d = behaviour.data;
      if (d.unknownLayout) {
        throw new Error(
          `${gameObject.data.m_Name}: script ${type} has no field layout in read-apk.py`,
        );
      }
      const fields = { type, enabled: Boolean(d.m_Enabled) };
      for (const [key, value] of Object.entries(d)) {
        if (key.startsWith('m_')) continue;
        if (value && typeof value === 'object' && 'x' in value)
          fields[key] = vec(value, Object.keys(value));
        else fields[key] = f32(value);
      }
      components.push(fields);
    }
    return components.length === 0 ? null : { unityComponents: components };
  }

  async mesh(gameObject) {
    const filter = firstOf(gameObject, 'MeshFilter');
    const renderer = firstOf(gameObject, 'MeshRenderer');
    const skinned = firstOf(gameObject, 'SkinnedMeshRenderer');
    let meshRef;
    let materialRefs;
    if (filter && renderer && enabled(renderer)) {
      meshRef = filter.data.m_Mesh;
      materialRefs = renderer.data.m_Materials;
    } else if (skinned && enabled(skinned)) {
      meshRef = skinned.data.m_Mesh;
      materialRefs = skinned.data.m_Materials;
    } else return null;
    const materials = materialRefs.map((ref) => apk.get(ref));
    if (!materials.some(Boolean)) return null;
    const data = meshData(meshRef);
    if (!data) return null;

    const key = `${data.id}|${materials.map((m) => m?.id ?? '').join(',')}`;
    if (this.meshes.has(key)) return this.meshes.get(key);

    const accessors = this.vertexAccessors(
      data,
      skinned && enabled(skinned) && !(filter && renderer && enabled(renderer)),
    );
    const mesh = this.document.createMesh(gameObject.data.m_Name);
    const count = Math.max(data.submeshes.length, materials.length);
    for (let i = 0; i < count; i += 1) {
      const material = materials[i % materials.length];
      const submesh = i % data.submeshes.length;
      if (!material || data.submeshes[submesh].length === 0) continue;
      const primitive = this.document.createPrimitive().setIndices(this.indices(data, submesh));
      for (const [semantic, accessor] of Object.entries(accessors))
        primitive.setAttribute(semantic, accessor);
      primitive.setMaterial(await this.material(material));
      mesh.addPrimitive(primitive);
    }
    this.meshes.set(key, mesh);
    return mesh;
  }

  vertexAccessors(data, withSkin) {
    if (this.accessors.has(data.id)) return this.accessors.get(data.id);
    const { decoded } = data;
    const doc = this.document;
    const buffer = doc.getRoot().listBuffers()[0];
    const make = (array, type) =>
      doc.createAccessor().setArray(array).setType(type).setBuffer(buffer);
    const accessors = {};
    const positions = apk.array(decoded.positions);
    const p = new Float32Array(positions);
    for (let i = 0; i < p.length; i += 3) p[i] = -p[i];
    accessors.POSITION = make(p, 'VEC3');
    if (data.normals) {
      const n = new Float32Array(data.normals);
      for (let i = 0; i < n.length; i += 3) n[i] = -n[i];
      accessors.NORMAL = make(n, 'VEC3');
    }
    const tangents = apk.array(decoded.tangents);
    if (tangents) {
      const t = new Float32Array(tangents);
      for (let i = 0; i < t.length; i += 4) {
        t[i] = -t[i];
        // A few degenerate tangents have w = 0; Unity reads them as +1 (glTF needs +-1).
        t[i + 3] = t[i + 3] < 0 ? 1 : -1;
      }
      accessors.TANGENT = make(t, 'VEC4');
    }
    for (const [view, semantic] of [
      ['uv0', 'TEXCOORD_0'],
      ['uv1', 'TEXCOORD_1'],
    ]) {
      const uv = apk.array(decoded[view]);
      if (!uv) continue;
      const out = new Float32Array(uv);
      for (let i = 1; i < out.length; i += 2) out[i] = 1 - out[i];
      accessors[semantic] = make(out, 'VEC2');
    }
    const colors = apk.array(decoded.colors);
    if (colors) {
      const out = new Float32Array(colors.length);
      for (let i = 0; i < colors.length; i += 4) {
        for (let k = 0; k < 3; k += 1) out[i + k] = toLinear(colors[i + k] / 255);
        out[i + 3] = colors[i + 3] / 255;
      }
      accessors.COLOR_0 = make(out, 'VEC4');
    }
    if (withSkin && decoded.weights) {
      accessors.JOINTS_0 = make(new Uint16Array(apk.array(decoded.joints)), 'VEC4');
      accessors.WEIGHTS_0 = make(new Float32Array(apk.array(decoded.weights)), 'VEC4');
    }
    this.accessors.set(data.id, accessors);
    return accessors;
  }

  indices(data, submesh) {
    const source = data.submeshes[submesh];
    let max = 0;
    for (const i of source) if (i > max) max = i;
    const Type = max < 256 ? Uint8Array : max < 65536 ? Uint16Array : Uint32Array;
    const out = new Type(source.length);
    // Winding reversed with the mirrored X: (a, b, c) -> (c, b, a).
    for (let i = 0; i < source.length; i += 3) {
      out[i] = source[i + 2];
      out[i + 1] = source[i + 1];
      out[i + 2] = source[i];
    }
    return this.document
      .createAccessor()
      .setArray(out)
      .setType('SCALAR')
      .setBuffer(this.document.getRoot().listBuffers()[0]);
  }

  async texture(ref) {
    const texture = apk.get(ref);
    if (!texture) return null;
    if (this.textures.has(texture.id)) return this.textures.get(texture.id);
    const png = readFileSync(apk.path(texture.png));
    const { isOpaque } = await sharp(png).stats();
    const image = isOpaque
      ? await sharp(png).removeAlpha().jpeg({ quality: JPEG_QUALITY }).toBuffer()
      : await sharp(png).png().toBuffer();
    const gltfTexture = this.document
      .createTexture(texture.data.m_Name)
      .setImage(new Uint8Array(image))
      .setMimeType(isOpaque ? 'image/jpeg' : 'image/png');
    const settings = texture.data.m_TextureSettings ?? {};
    const entry = {
      texture: gltfTexture,
      unity: texture,
      wrap: WRAP_MODES[settings.m_WrapMode] ?? 'Repeat',
      filter: FILTER_MODES[settings.m_FilterMode] ?? 'Bilinear',
      mipmaps: Boolean(texture.data.m_MipMap),
    };
    this.textures.set(texture.id, entry);
    return entry;
  }

  sampler(info, entry) {
    info.setMinFilter(entry.mipmaps ? GL.LINEAR_MIPMAP_LINEAR : GL.LINEAR);
    if (entry.wrap === 'Clamp') info.setWrapS(GL.CLAMP_TO_EDGE).setWrapT(GL.CLAMP_TO_EDGE);
  }

  async material(materialObject) {
    if (this.materials.has(materialObject.id)) return this.materials.get(materialObject.id);
    const d = materialObject.data;
    const shader = shaderInfo(d.m_Shader);
    const saved = d.m_SavedProperties;
    const lookup = (list, name) => list.find(([key]) => (key.name ?? key) === name)?.[1];
    const material = this.document.createMaterial(d.m_Name);

    // The glTF fields UnityGLTF derives (the app rebuilds the material from the extras).
    const has = (name) => shader.properties.some((p) => p.name === name);
    const colorOf = (name) => {
      const c = lookup(saved.m_Colors, name);
      return c ? color(c) : shader.properties.find((p) => p.name === name)?.fallback?.map(f32);
    };
    if (shader.renderType === 'TransparentCutout' || shader.queue === 2450) {
      material.setAlphaMode('MASK');
      const cutoff = lookup(saved.m_Floats, '_Cutoff');
      if (cutoff !== undefined) material.setAlphaCutoff(f32(cutoff));
    } else if (shader.renderType === 'Transparent') {
      material.setAlphaMode('BLEND');
    }
    const unlit = /unlit/i.test(shader.name);
    if (has('_MainTex')) {
      const env = lookup(saved.m_TexEnvs, '_MainTex');
      const entry = env ? await this.texture(env.m_Texture) : null;
      if (entry) {
        material.setBaseColorTexture(entry.texture);
        const info = material.getBaseColorTextureInfo();
        this.sampler(info, entry);
        const transform = this.transform.createTransform().setTexCoord(0);
        const [sx, sy] = [env.m_Scale.x, env.m_Scale.y];
        const [ox, oy] = [env.m_Offset.x, 1 - sy - env.m_Offset.y];
        if (ox !== 0 || oy !== 0) transform.setOffset([f32(ox), f32(oy)]);
        if (sx !== 1 || sy !== 1) transform.setScale([f32(sx), f32(sy)]);
        info.setExtension('KHR_texture_transform', transform);
      }
      const base = has('_Color') ? colorOf('_Color') : null;
      if (base && base.some((v) => v !== 1)) {
        material.setBaseColorFactor([...base.slice(0, 3).map((v) => f32(toLinear(v))), base[3]]);
      }
      if (unlit) material.setExtension('KHR_materials_unlit', this.unlit.createUnlit());
      else material.setMetallicFactor(0).setDoubleSided(true);
    }

    const properties = {};
    for (const property of shader.properties) {
      if (property.kind === 'Color' || property.kind === 'Vector') {
        const c = lookup(saved.m_Colors, property.name);
        properties[property.name] = c ? color(c) : property.fallback.map(f32);
      } else if (property.kind === 'Float' || property.kind === 'Int') {
        const f = lookup(saved.m_Floats, property.name);
        properties[property.name] = f32(f ?? property.fallback);
      } else {
        const env = lookup(saved.m_TexEnvs, property.name);
        const entry = env ? await this.texture(env.m_Texture) : null;
        properties[property.name] = entry
          ? {
              texture: entry.unity.data.m_Name,
              index: null,
              image: this.document.getRoot().listTextures().indexOf(entry.texture),
              scale: vec(env.m_Scale, ['x', 'y']),
              offset: vec(env.m_Offset, ['x', 'y']),
              wrapU: entry.wrap,
              wrapV: entry.wrap,
              filter: entry.filter,
            }
          : null;
      }
    }
    material.setExtras({
      unityMaterial: d.m_Name,
      unityShader: shader.name,
      renderQueue: shader.queue,
      properties,
    });
    this.materials.set(materialObject.id, material);
    return material;
  }

  skin(gameObject) {
    const smr = firstOf(gameObject, 'SkinnedMeshRenderer');
    const data = meshData(smr.data.m_Mesh);
    const bones = smr.data.m_Bones.map((ref) => apk.get(apk.get(ref)?.data.m_GameObject));
    if (bones.length === 0 || bones.length !== data.bindPoses.length) return;
    if (!bones.every((bone) => bone && this.nodes.has(bone.id))) return;
    const matrices = new Float32Array(16 * bones.length);
    data.bindPoses.forEach((m, i) => matrices.set(matrix(m), i * 16));
    const skin = this.document.createSkin();
    for (const bone of bones) skin.addJoint(this.nodes.get(bone.id));
    skin.setInverseBindMatrices(
      this.document
        .createAccessor()
        .setArray(matrices)
        .setType('MAT4')
        .setBuffer(this.document.getRoot().listBuffers()[0]),
    );
    this.nodes.get(gameObject.id).setSkin(skin);
  }

  /** Clips of an Animation component: its list, and the default clip if it is not in it. */
  clipsOf(animation) {
    const refs = [...animation.data.m_Animations];
    const main = animation.data.m_Animation;
    if (main?.$ref && !refs.some((ref) => ref?.$ref === main.$ref)) refs.push(main);
    return refs.map((ref) => apk.get(ref)).filter(Boolean);
  }

  /** Legacy clips sampled like UnityGLTF; returns what the report lists about them. */
  animations(roots) {
    const exportedClips = new Map(); // clip id -> glTF animation
    const names = new Map();
    for (const go of this.animated) {
      const animation = firstOf(go, 'Animation');
      for (const clip of this.clipsOf(animation)) {
        const channels = this.clipChannels(go, clip);
        if (channels.length === 0) continue;
        let gltfAnimation = exportedClips.get(clip.id);
        if (!gltfAnimation) {
          const base = clip.data.m_Name;
          const n = names.get(base) ?? 0;
          names.set(base, n + 1);
          gltfAnimation = this.document.createAnimation(n === 0 ? base : `${base}_${n}`);
          exportedClips.set(clip.id, gltfAnimation);
        }
        for (const channel of channels) this.addChannel(gltfAnimation, channel);
      }
    }
    return activeTree(roots)
      .flatMap((go) => componentsOf(go, 'Animation').map((animation) => ({ go, animation })))
      .flatMap(({ go, animation }) =>
        this.clipsOf(animation).map((clip) => this.describeClip(go, animation, clip)),
      );
  }

  clipLength(clip) {
    const d = clip.data;
    const curves = [
      ...d.m_RotationCurves,
      ...d.m_PositionCurves,
      ...d.m_ScaleCurves,
      ...d.m_FloatCurves,
    ];
    const times = curves.flatMap((c) => c.curve.m_Curve.map((k) => k.time));
    return times.length ? Math.max(...times) - Math.min(0, ...times) : 0;
  }

  clipChannels(go, clip) {
    const d = clip.data;
    const length = this.clipLength(clip);
    const channels = [];
    for (const [curves, target] of [
      [d.m_PositionCurves, 'translation'],
      [d.m_RotationCurves, 'rotation'],
      [d.m_ScaleCurves, 'scale'],
    ]) {
      for (const curve of curves) {
        const targetGo = findPath(go, curve.path);
        if (!targetGo || !this.nodes.has(targetGo.id)) continue;
        const light = firstOf(targetGo, 'Light');
        channels.push({
          node: this.nodes.get(targetGo.id),
          target,
          ...bake(curve.curve.m_Curve, length, target, Boolean(light && enabled(light))),
        });
      }
    }
    return channels;
  }

  addChannel(animation, channel) {
    const buffer = this.document.getRoot().listBuffers()[0];
    const sampler = this.document
      .createAnimationSampler()
      .setInput(
        this.document.createAccessor().setArray(channel.times).setType('SCALAR').setBuffer(buffer),
      )
      .setOutput(
        this.document
          .createAccessor()
          .setArray(channel.values)
          .setType(channel.target === 'rotation' ? 'VEC4' : 'VEC3')
          .setBuffer(buffer),
      )
      .setInterpolation(channel.interpolation);
    animation.addSampler(sampler);
    animation.addChannel(
      this.document
        .createAnimationChannel()
        .setTargetNode(channel.node)
        .setTargetPath(channel.target)
        .setSampler(sampler),
    );
  }

  describeClip(go, animation, clip) {
    const d = clip.data;
    let curves = 0;
    let bound = 0;
    for (const [list, size] of [
      [d.m_RotationCurves, 4],
      [d.m_PositionCurves, 3],
      [d.m_ScaleCurves, 3],
    ]) {
      for (const curve of list) {
        curves += size;
        if (findPath(go, curve.path)) bound += size;
      }
    }
    curves += d.m_FloatCurves.length;
    return {
      node: go.data.m_Name,
      name: d.m_Name,
      length: f32(this.clipLength(clip)),
      legacy: true,
      wrapMode: CLIP_WRAP_MODES[d.m_WrapMode] ?? String(d.m_WrapMode),
      isDefault: animation.data.m_Animation?.$ref === clip.id,
      curves,
      boundTransformCurves: bound,
      otherBoundCurves: [],
    };
  }

  describe(id, children, roots, clips) {
    const tree = activeTree(roots);
    const all = [];
    const visitAll = (go) => {
      all.push(go);
      for (const child of apk.children(go)) visitAll(child);
    };
    for (const go of roots) visitAll(go);
    const behaviour = componentsOf(this.root, 'MonoBehaviour').find((b) => b.data.mTrackableName);
    const meshes = new Map();
    let meshRenderers = 0;
    let skinnedMeshRenderers = 0;
    let triangles = 0;
    for (const go of tree) {
      const filter = firstOf(go, 'MeshFilter');
      const renderer = firstOf(go, 'MeshRenderer');
      const smr = firstOf(go, 'SkinnedMeshRenderer');
      const filterMesh = filter ? meshData(filter.data.m_Mesh) : null;
      const smrMesh = smr ? meshData(smr.data.m_Mesh) : null;
      if (filterMesh) meshes.set(filterMesh.id, filterMesh);
      if (smrMesh) meshes.set(smrMesh.id, smrMesh);
      if (renderer && enabled(renderer)) {
        if (filterMesh) meshRenderers += 1;
        triangles += trianglesOf(filterMesh);
      }
      if (smr && enabled(smr)) {
        if (smrMesh) skinnedMeshRenderers += 1;
        triangles += trianglesOf(smrMesh);
      }
    }
    return {
      id,
      trackable: behaviour.data.mTrackableName,
      root: this.root.data.m_Name,
      aspectRatio: f32(behaviour.data.mAspectRatio),
      file: `${id}.glb`,
      meshRenderers,
      skinnedMeshRenderers,
      lights: tree.filter((go) => componentsOf(go, 'Light').some(enabled)).length,
      audioSources: tree.reduce((sum, go) => sum + componentsOf(go, 'AudioSource').length, 0),
      particleSystems: tree.reduce((sum, go) => sum + componentsOf(go, 'ParticleSystem').length, 0),
      inactiveObjects:
        all.filter((go) => !tree.includes(go)).length + children.length - roots.length,
      triangles,
      triangleStripMeshes: [...meshes.values()].filter((m) => m.strips).length,
      fixedNormalMeshes: [...meshes.values()].filter((m) => m.normalized).length,
      clips,
    };
  }
}

// --- Curves -----------------------------------------------------------------------------------

/** A curve sampled like UnityGLTF's BakePropertyAnimation, in glTF space. */
function bake(keys, length, target, light) {
  const components = target === 'rotation' ? ['x', 'y', 'z', 'w'] : ['x', 'y', 'z'];
  const constant = keys.every((k) =>
    components.every((c) => !Number.isFinite(curveNumber(k.inSlope[c]))),
  );
  const times = sampleTimes(length, BAKING_FPS);
  const values = times.map((time) => {
    const v = components.map((c) => Math.fround(evaluateCurve(keys, time, c)));
    if (target === 'rotation') return rotation(v, light);
    if (target === 'translation') return [Math.fround(-v[0]), v[1], v[2]];
    return v;
  });
  const kept = dropUnneededKeys(times, values);
  return {
    times: new Float32Array(kept.times),
    values: new Float32Array(kept.values.flat()),
    interpolation: constant ? 'STEP' : 'LINEAR',
  };
}

// --- Main -------------------------------------------------------------------------------------

/** Points the material extras at glTF textures of their images (adding missing textures). */
function linkTextures(json) {
  json.textures ??= [];
  json.samplers ??= [];
  const bySource = new Map();
  json.textures.forEach((texture, index) => {
    if (!bySource.has(texture.source)) bySource.set(texture.source, index);
  });
  for (const material of json.materials ?? []) {
    for (const value of Object.values(material.extras?.properties ?? {})) {
      if (!value || typeof value !== 'object' || !('image' in value)) continue;
      let index = bySource.get(value.image);
      if (index === undefined) {
        const sampler = { minFilter: GL.LINEAR_MIPMAP_LINEAR };
        let samplerIndex = json.samplers.findIndex(
          (s) => JSON.stringify(s) === JSON.stringify(sampler),
        );
        if (samplerIndex < 0) samplerIndex = json.samplers.push(sampler) - 1;
        index =
          json.textures.push({
            sampler: samplerIndex,
            source: value.image,
            name: json.images[value.image].name,
          }) - 1;
        bySource.set(value.image, index);
      }
      value.index = index;
      delete value.image;
    }
  }
}

const { SCENES } = await import('../scenes.mjs');
const io = new NodeIO().registerExtensions([
  KHRLightsPunctual,
  KHRMaterialsUnlit,
  KHRTextureTransform,
]);
mkdirSync(outDir, { recursive: true });
const reports = [];
const targets = apk.roots.map((id) => apk.get(id)).filter((go) => go.data.m_Name.startsWith('IT_'));
for (const root of targets) {
  const behaviour = componentsOf(root, 'MonoBehaviour').find((b) => b.data.mTrackableName);
  const id = behaviour.data.mTrackableName.toLowerCase();
  if (!SCENES.some((scene) => scene.id === id)) {
    console.log(`skipped   ${root.data.m_Name}: not a scene of the app`);
    continue;
  }
  const converter = new TargetConverter(root);
  const document = await converter.convert(id);
  const bytes = patchGlbJson(await io.writeBinary(document), linkTextures);
  const file = path.join(outDir, `${id}.glb`);
  writeFileSync(file, bytes);
  reports.push(converter.report);
  console.log(
    `converted ${root.data.m_Name} -> ${path.relative(process.cwd(), file)} ` +
      `(${(bytes.length / 2 ** 20).toFixed(2)} MB, ${converter.report.triangles} triangles)`,
  );
}
reports.sort((a, b) => a.id.localeCompare(b.id));
writeFileSync(
  path.join(outDir, 'export-report.json'),
  `${JSON.stringify({ targets: reports }, null, 4)}\n`,
);
console.log(`report    ${path.relative(process.cwd(), path.join(outDir, 'export-report.json'))}`);
