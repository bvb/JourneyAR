// Compares two exports of the scenes (GLB files and export-report.json), for example the
// conversion from the APK with a former Unity export kept as a baseline:
// - nodes by their path of names: transforms, extras, lights, meshes (every attribute and the
//   triangles), materials (extras and glTF fields) and skins;
// - textures referenced by the materials: the decoded pixels;
// - animations: every channel sampled at 60 Hz, so different keyframes of the same motion match;
// - scene extras and the export reports.
// Usage: node gltf/compare-exports.mjs <baseline dir> [export dir] [--verbose]
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import sharp from 'sharp';
import { readGlbJson } from '../assets/glb.mjs';
import { PIPELINE_OUT } from '../config.mjs';

const args = process.argv.slice(2).filter((a) => !a.startsWith('--'));
const verbose = process.argv.includes('--verbose');
if (args.length < 1) {
  console.error('Usage: node gltf/compare-exports.mjs <baseline dir> [export dir] [--verbose]');
  process.exit(2);
}
const baseDir = path.resolve(args[0]);
const newDir = path.resolve(args[1] ?? path.join(PIPELINE_OUT, 'export'));

// Tolerances: positions and transforms in scene units, other vertex data and animation values
// as numbers, texture pixels in 8-bit steps (mean over the image, and worst pixel channel).
const EPS = 1e-4;
const PIXEL_MEAN = 1.5;
const PIXEL_MAX = 48;
const MAX_LISTED = 12;

const io = new NodeIO().registerExtensions(ALL_EXTENSIONS);

/**
 * Names without the suffixes the ripped Unity project gave duplicates ("Sand_0", "Eye 1"):
 * the APK has the original names.
 */
const baseName = (name) => (typeof name === 'string' ? name.replace(/(_\d| \d)$/, '') : name);

/** Material extras with texture names unsuffixed and glTF texture indices left out. */
function materialExtras(extras) {
  if (!extras) return extras;
  const properties = {};
  for (const [key, value] of Object.entries(extras.properties ?? {})) {
    properties[key] =
      value && typeof value === 'object' && !Array.isArray(value)
        ? { ...value, texture: baseName(value.texture), index: undefined }
        : value;
  }
  return JSON.parse(
    JSON.stringify({ ...extras, unityMaterial: baseName(extras.unityMaterial), properties }),
  );
}

/** Deep comparison with a numeric tolerance; returns the paths that differ. */
function diffValues(a, b, at = '', out = []) {
  if (typeof a === 'number' && typeof b === 'number') {
    if (Math.abs(a - b) > EPS * Math.max(1, Math.abs(a), Math.abs(b)))
      out.push(`${at}: ${a} vs ${b}`);
  } else if (Array.isArray(a) && Array.isArray(b)) {
    if (a.length !== b.length) out.push(`${at}: length ${a.length} vs ${b.length}`);
    else a.forEach((v, i) => diffValues(v, b[i], `${at}[${i}]`, out));
  } else if (a && b && typeof a === 'object' && typeof b === 'object') {
    for (const key of new Set([...Object.keys(a), ...Object.keys(b)])) {
      if (!(key in a)) out.push(`${at}.${key}: missing in baseline (${JSON.stringify(b[key])})`);
      else if (!(key in b)) out.push(`${at}.${key}: missing (${JSON.stringify(a[key])})`);
      else diffValues(a[key], b[key], `${at}.${key}`, out);
    }
  } else if (a !== b) {
    out.push(`${at}: ${JSON.stringify(a)} vs ${JSON.stringify(b)}`);
  }
  return out;
}

/** Nodes by a path of names (with an index among same-named siblings). */
function nodesByPath(document) {
  const map = new Map();
  const visit = (node, prefix) => {
    const key = `${prefix}/${node.getName()}`;
    let unique = key;
    for (let i = 1; map.has(unique); i += 1) unique = `${key}#${i}`;
    map.set(unique, node);
    for (const child of node.listChildren()) visit(child, unique);
  };
  for (const root of document.getRoot().listScenes()[0].listChildren()) visit(root, '');
  return map;
}

function maxDiff(a, b) {
  if (!a || !b) return a === b ? 0 : Infinity;
  if (a.length !== b.length) return Infinity;
  let max = 0;
  for (let i = 0; i < a.length; i += 1) max = Math.max(max, Math.abs(a[i] - b[i]));
  return max;
}

/** Accessor values as numbers (normalized integers decoded). */
function accessorArray(accessor) {
  if (!accessor) return null;
  if (!accessor.getNormalized()) return accessor.getArray();
  const size = accessor.getElementSize();
  const out = new Float32Array(accessor.getCount() * size);
  const element = [];
  for (let i = 0; i < accessor.getCount(); i += 1)
    out.set(accessor.getElement(i, element), i * size);
  return out;
}

function materialSummary(material) {
  if (!material) return null;
  const json = {
    name: baseName(material.getName()),
    extras: materialExtras(material.getExtras()),
    alphaMode: material.getAlphaMode(),
    alphaCutoff: material.getAlphaMode() === 'MASK' ? material.getAlphaCutoff() : undefined,
    doubleSided: material.getDoubleSided(),
    baseColorFactor: material.getBaseColorFactor(),
    metallicFactor: material.getMetallicFactor(),
    roughnessFactor: material.getRoughnessFactor(),
    emissiveFactor: material.getEmissiveFactor(),
    baseColorTexture: baseName(material.getBaseColorTexture()?.getName() ?? null),
    extensions: material
      .listExtensions()
      .map((e) => e.extensionName)
      .sort(),
  };
  const transform = material.getBaseColorTextureInfo()?.getExtension('KHR_texture_transform');
  if (transform) {
    json.textureTransform = {
      offset: transform.getOffset(),
      scale: transform.getScale(),
      rotation: transform.getRotation(),
      texCoord: transform.getTexCoord(),
    };
  }
  return JSON.parse(JSON.stringify(json));
}

async function pixels(texture) {
  const { data, info } = await sharp(texture.getImage())
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  return { data, width: info.width, height: info.height };
}

async function compareTexture(a, b) {
  if (a.getMimeType() !== b.getMimeType()) return `type ${b.getMimeType()} vs ${a.getMimeType()}`;
  const [pa, pb] = await Promise.all([pixels(a), pixels(b)]);
  if (pa.width !== pb.width || pa.height !== pb.height) {
    return `size ${pb.width}x${pb.height} vs ${pa.width}x${pa.height}`;
  }
  let sum = 0;
  let max = 0;
  for (let i = 0; i < pa.data.length; i += 1) {
    const d = Math.abs(pa.data[i] - pb.data[i]);
    sum += d;
    if (d > max) max = d;
  }
  const mean = sum / pa.data.length;
  return mean > PIXEL_MEAN || max > PIXEL_MAX
    ? `pixels differ: mean ${mean.toFixed(2)}, max ${max}`
    : null;
}

/** Value of an animation sampler at time t (linear, step or cubic spline). */
function sample(sampler, t) {
  const times = sampler.getInput().getArray();
  const values = sampler.getOutput().getArray();
  const cubic = sampler.getInterpolation() === 'CUBICSPLINE';
  const size = values.length / times.length / (cubic ? 3 : 1);
  const value = (k) => {
    const start = (cubic ? 3 * k + 1 : k) * size;
    return Array.from(values.slice(start, start + size));
  };
  if (t <= times[0]) return value(0);
  if (t >= times[times.length - 1]) return value(times.length - 1);
  let k = 0;
  while (times[k + 1] < t) k += 1;
  const [a, b] = [value(k), value(k + 1)];
  if (sampler.getInterpolation() === 'STEP') return a;
  const f = (t - times[k]) / (times[k + 1] - times[k]);
  if (size === 4) {
    // Rotations: the shorter way, normalized.
    const dot = a.reduce((s, x, i) => s + x * b[i], 0);
    const sign = dot < 0 ? -1 : 1;
    const q = a.map((x, i) => x + (sign * b[i] - x) * f);
    const len = Math.hypot(...q);
    return q.map((x) => x / len);
  }
  return a.map((x, i) => x + (b[i] - x) * f);
}

function sameRotation(a, b) {
  const dot = Math.abs(a.reduce((s, x, i) => s + x * b[i], 0));
  return 1 - Math.min(1, dot);
}

function compareAnimations(baseDoc, newDoc, problems) {
  const channels = (document) => {
    const map = new Map();
    for (const animation of document.getRoot().listAnimations()) {
      for (const channel of animation.listChannels()) {
        const node = channel.getTargetNode();
        map.set(`${node.getName()}|${channel.getTargetPath()}`, {
          sampler: channel.getSampler(),
          path: channel.getTargetPath(),
        });
      }
    }
    return map;
  };
  const a = channels(baseDoc);
  const b = channels(newDoc);
  for (const key of a.keys()) if (!b.has(key)) problems.push(`animation channel missing: ${key}`);
  for (const key of b.keys()) if (!a.has(key)) problems.push(`animation channel extra: ${key}`);
  for (const [key, { sampler, path: target }] of a) {
    const other = b.get(key);
    if (!other) continue;
    const end = Math.max(
      ...sampler.getInput().getArray().slice(-1),
      ...other.sampler.getInput().getArray().slice(-1),
    );
    let worst = 0;
    let worstAt = 0;
    for (let t = 0; t <= end + 1e-6; t += 1 / 60) {
      const va = sample(sampler, t);
      const vb = sample(other.sampler, t);
      const d = target === 'rotation' ? sameRotation(va, vb) * 1e3 : maxDiff(va, vb);
      if (d > worst) [worst, worstAt] = [d, t];
    }
    if (worst > (target === 'rotation' ? 1e-3 : EPS * 10)) {
      problems.push(
        `animation ${key}: differs by ${worst.toExponential(2)} at ${worstAt.toFixed(3)} s`,
      );
    }
  }
}

async function compareScene(id) {
  const problems = [];
  const baseFile = path.join(baseDir, `${id}.glb`);
  const newFile = path.join(newDir, `${id}.glb`);
  if (!existsSync(newFile)) return [`${newFile} is missing`];
  const [baseDoc, newDoc] = await Promise.all([io.read(baseFile), io.read(newFile)]);
  // A glTF texture index of the material extras -> the texture of its image (gltf-transform
  // lists one texture per image, in image order).
  const imageOf = (document, file) => {
    const json = readGlbJson(readFileSync(file));
    return (index) => {
      const texture = json.textures?.[index];
      const source = texture?.source ?? texture?.extensions?.EXT_texture_webp?.source;
      return source === undefined ? null : document.getRoot().listTextures()[source];
    };
  };
  const baseImage = imageOf(baseDoc, baseFile);
  const newImage = imageOf(newDoc, newFile);

  const baseScene = baseDoc.getRoot().listScenes()[0];
  const newScene = newDoc.getRoot().listScenes()[0];
  for (const d of diffValues(baseScene.getExtras(), newScene.getExtras(), 'scene.extras'))
    problems.push(d);

  const baseNodes = nodesByPath(baseDoc);
  const newNodes = nodesByPath(newDoc);
  for (const key of baseNodes.keys()) if (!newNodes.has(key)) problems.push(`node missing: ${key}`);
  for (const key of newNodes.keys()) if (!baseNodes.has(key)) problems.push(`node extra: ${key}`);

  const textures = new Map();
  for (const [key, a] of baseNodes) {
    const b = newNodes.get(key);
    if (!b) continue;
    const trs = (n) => [...n.getTranslation(), ...n.getRotation(), ...n.getScale()];
    if (maxDiff(trs(a), trs(b)) > EPS) problems.push(`${key}: transform ${trs(b)} vs ${trs(a)}`);
    for (const d of diffValues(a.getExtras(), b.getExtras(), `${key} extras`)) problems.push(d);
    const lightA = a.getExtension('KHR_lights_punctual');
    const lightB = b.getExtension('KHR_lights_punctual');
    if (!!lightA !== !!lightB) problems.push(`${key}: light ${!!lightB} vs ${!!lightA}`);
    else if (lightA) {
      const describe = (l) => ({
        type: l.getType(),
        color: l.getColor(),
        intensity: l.getIntensity(),
        range: l.getRange(),
        inner: l.getInnerConeAngle(),
        outer: l.getOuterConeAngle(),
      });
      for (const d of diffValues(describe(lightA), describe(lightB), `${key} light`))
        problems.push(d);
    }
    const skinA = a.getSkin();
    const skinB = b.getSkin();
    if (!!skinA !== !!skinB) problems.push(`${key}: skin ${!!skinB} vs ${!!skinA}`);
    else if (skinA) {
      const joints = (s) => s.listJoints().map((j) => j.getName());
      for (const d of diffValues(joints(skinA), joints(skinB), `${key} skin joints`))
        problems.push(d);
      const ibm = maxDiff(
        skinA.getInverseBindMatrices()?.getArray(),
        skinB.getInverseBindMatrices()?.getArray(),
      );
      if (ibm > EPS * 10) problems.push(`${key}: inverse bind matrices differ by ${ibm}`);
      if (skinA.getSkeleton()?.getName() !== skinB.getSkeleton()?.getName()) {
        problems.push(
          `${key}: skeleton ${skinB.getSkeleton()?.getName()} vs ${skinA.getSkeleton()?.getName()}`,
        );
      }
    }
    const meshA = a.getMesh();
    const meshB = b.getMesh();
    if (!!meshA !== !!meshB) {
      problems.push(`${key}: mesh ${!!meshB} vs ${!!meshA}`);
      continue;
    }
    if (!meshA) continue;
    if (meshA.getName() !== meshB.getName())
      problems.push(`${key}: mesh name ${meshB.getName()} vs ${meshA.getName()}`);
    const primsA = meshA.listPrimitives();
    const primsB = meshB.listPrimitives();
    if (primsA.length !== primsB.length) {
      problems.push(`${key}: ${primsB.length} primitives vs ${primsA.length}`);
      continue;
    }
    primsA.forEach((pa, i) => {
      const pb = primsB[i];
      const semA = pa.listSemantics().sort().join(',');
      const semB = pb.listSemantics().sort().join(',');
      if (semA !== semB) problems.push(`${key}[${i}]: attributes ${semB} vs ${semA}`);
      for (const semantic of pa.listSemantics()) {
        const xa = pa.getAttribute(semantic);
        const xb = pb.getAttribute(semantic);
        if (!xb) continue;
        const d = maxDiff(accessorArray(xa), accessorArray(xb));
        if (d > EPS * 10) problems.push(`${key}[${i}] ${semantic}: differs by ${d}`);
      }
      const ia = pa.getIndices()?.getArray();
      const ib = pb.getIndices()?.getArray();
      if (maxDiff(ia, ib) !== 0)
        problems.push(`${key}[${i}]: indices differ (${ib?.length} vs ${ia?.length})`);
      for (const d of diffValues(
        materialSummary(pa.getMaterial()),
        materialSummary(pb.getMaterial()),
        `${key}[${i}] material`,
      )) {
        problems.push(d);
      }
      // Textures the material extras point at, by glTF index.
      for (const [name, prop] of Object.entries(pa.getMaterial()?.getExtras()?.properties ?? {})) {
        const other = pb.getMaterial()?.getExtras()?.properties?.[name];
        if (
          prop &&
          typeof prop === 'object' &&
          !Array.isArray(prop) &&
          other?.index !== undefined
        ) {
          const ta = baseImage(prop.index);
          const tb = newImage(other.index);
          if (ta && tb)
            textures.set(`${baseName(prop.texture)} (${baseName(ta.getName())})`, [ta, tb]);
          else
            problems.push(
              `${key}[${i}] ${name}: texture index ${other.index} vs ${prop.index} not found`,
            );
        }
      }
    });
  }

  for (const [name, [a, b]] of textures) {
    const problem = await compareTexture(a, b);
    if (problem) problems.push(`texture ${name}: ${problem}`);
  }
  const counts = (doc) => ({
    textures: doc.getRoot().listTextures().length,
    materials: doc.getRoot().listMaterials().length,
    meshes: doc.getRoot().listMeshes().length,
    animations: doc.getRoot().listAnimations().length,
  });
  for (const d of diffValues(counts(baseDoc), counts(newDoc), 'counts')) problems.push(d);
  compareAnimations(baseDoc, newDoc, problems);
  return problems;
}

const readReport = (dir) => {
  const report = JSON.parse(readFileSync(path.join(dir, 'export-report.json'), 'utf8'));
  for (const target of report.targets) {
    for (const clip of target.clips ?? []) clip.name = baseName(clip.name);
    target.clips?.sort((a, b) => `${a.node}|${a.name}`.localeCompare(`${b.node}|${b.name}`));
  }
  return report;
};
const baseReport = readReport(baseDir);
const newReport = readReport(newDir);
let failed = false;
for (const d of diffValues(baseReport, newReport, 'export-report')) {
  failed = true;
  console.log(`report    ${d}`);
}
for (const target of baseReport.targets) {
  const problems = await compareScene(target.id);
  if (problems.length > 0) failed = true;
  console.log(
    `${problems.length ? 'DIFF' : 'same'}      ${target.id}${problems.length ? `: ${problems.length} differences` : ''}`,
  );
  for (const problem of verbose ? problems : problems.slice(0, MAX_LISTED))
    console.log(`  ${problem}`);
  if (!verbose && problems.length > MAX_LISTED)
    console.log(`  ... ${problems.length - MAX_LISTED} more (--verbose)`);
}
process.exitCode = failed ? 1 : 0;
