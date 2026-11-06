// Applies the fixes the converted Unity 6 project needs. Safe to run repeatedly.
//
// 1. Removes ripped files that no longer compile and are not used by anything.
// 2. Copies rewritten files from ./overlay over the broken originals. Only existing files
//    are replaced, so their .meta files (and the GUIDs materials refer to) stay intact.
// 3. Registers the local editor package tools/unity-export and UnityGLTF in
//    Packages/manifest.json.
//
// Every file is backed up to tools/.out/unity-backup/ before it is removed or replaced.
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ROOT, UNITY_PROJECT } from '../config.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const OVERLAY = path.join(HERE, 'overlay');
const BACKUP = path.join(ROOT, 'tools', '.out', 'unity-backup');

// Ripped NGUI clipping shaders contain only compiled GLES programs: Unity 6 cannot parse
// them and no material uses them (they served the old NGUI interface, which is not ported).
const NGUI_GLES_SHADERS = [
  'Unlit - Masked Colored',
  'Unlit - Transparent Colored (AlphaClip)',
  'Unlit - Transparent Colored (HardClip)',
  'Unlit - Transparent Colored (Packed) (AlphaClip) ',
  'Unlit - Transparent Colored (Packed) (HardClip)',
  'Unlit - Transparent Colored (Packed) (SoftClip)',
  'Unlit - Transparent Colored (Packed)',
  'Unlit - Transparent Colored (SoftClip)',
].map((name) => `Assets/Resources/shaders/${name}.shader`);

const REMOVED_FILES = [
  // Standard Assets sample; uses GUITexture, which Unity 6 removed. Not referenced by the scene.
  'Assets/Scripts/Assembly-UnityScript/tapcontrol.cs',
  ...NGUI_GLES_SHADERS,
];

const PACKAGE_NAME = 'com.journey.unity-export';

// glTF exporter for Unity (Khronos), from the OpenUPM registry.
const UNITYGLTF = { name: 'org.khronos.unitygltf', version: '2.24.0' };
const OPENUPM = { name: 'OpenUPM', url: 'https://package.openupm.com', scopes: ['org.khronos'] };

function rel(file) {
  return path.relative(UNITY_PROJECT, file).replaceAll('\\', '/');
}

/** Copies a project file to the backup folder once; later runs keep the first (original) copy. */
function backup(file) {
  const target = path.join(BACKUP, path.relative(UNITY_PROJECT, file));
  if (existsSync(target)) return;
  mkdirSync(path.dirname(target), { recursive: true });
  copyFileSync(file, target);
}

function* walk(dir) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) yield* walk(full);
    else yield full;
  }
}

if (!existsSync(path.join(UNITY_PROJECT, 'ProjectSettings', 'ProjectVersion.txt'))) {
  throw new Error(`Unity project not found at ${UNITY_PROJECT}`);
}

for (const relative of REMOVED_FILES) {
  const file = path.join(UNITY_PROJECT, relative);
  if (existsSync(file)) {
    backup(file);
    if (existsSync(`${file}.meta`)) backup(`${file}.meta`);
    rmSync(file);
    rmSync(`${file}.meta`, { force: true });
    console.log(`removed   ${relative}`);
  } else {
    console.log(`absent    ${relative}`);
  }
}

for (const source of walk(OVERLAY)) {
  const target = path.join(UNITY_PROJECT, path.relative(OVERLAY, source));
  if (!existsSync(target)) {
    throw new Error(`Overlay file has no counterpart in the project: ${rel(target)}`);
  }
  const content = readFileSync(source);
  if (readFileSync(target).equals(content)) {
    console.log(`unchanged ${rel(target)}`);
  } else {
    backup(target);
    writeFileSync(target, content);
    console.log(`replaced  ${rel(target)}`);
  }
}

const manifestPath = path.join(UNITY_PROJECT, 'Packages', 'manifest.json');
const originalManifest = readFileSync(manifestPath, 'utf8');
const manifest = JSON.parse(originalManifest);

const requiredPackages = {
  [PACKAGE_NAME]: `file:${path
    .relative(path.dirname(manifestPath), path.join(ROOT, 'tools', 'unity-export'))
    .replaceAll('\\', '/')}`,
  [UNITYGLTF.name]: UNITYGLTF.version,
};
const otherPackages = Object.fromEntries(
  Object.entries(manifest.dependencies).filter(([name]) => !(name in requiredPackages)),
);
manifest.dependencies = { ...requiredPackages, ...otherPackages };

manifest.scopedRegistries ??= [];
let registry = manifest.scopedRegistries.find((r) => r.url === OPENUPM.url);
if (!registry) {
  registry = { name: OPENUPM.name, url: OPENUPM.url, scopes: [] };
  manifest.scopedRegistries.push(registry);
}
for (const scope of OPENUPM.scopes) {
  if (!registry.scopes.includes(scope)) registry.scopes.push(scope);
}

const updatedManifest = `${JSON.stringify(manifest, null, 2)}\n`;
if (updatedManifest === originalManifest) {
  console.log('unchanged Packages/manifest.json');
} else {
  backup(manifestPath);
  writeFileSync(manifestPath, updatedManifest);
  for (const [name, ref] of Object.entries(requiredPackages)) {
    console.log(`updated   Packages/manifest.json: ${name} -> ${ref}`);
  }
}
