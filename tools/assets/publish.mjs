// Publishes the converted scenes into the app:
// - copies the GLB files of the Unity export to journey-ar/assets/models/<id>.glb (unoptimized
//   for now, see .plans/plan.md);
// - copies the original MP3 tracks to journey-ar/assets/audio/<id>.mp3 without re-encoding (they
//   are already MP3 at 128-192 kbit/s and within 2.2 LU of each other);
// - writes journey-ar/assets/scenes.json (the NFT markers must exist: npm run nft:generate).
//
// The anchor of a scene (where its target sits on the page) is found by locating the original
// Vuforia target texture on the page scan; a preview with the target outline goes to
// tools/.out/anchors/<id>.jpg. Anchors already in scenes.json are kept, since they may have been
// tuned in the app's debug mode; pass --reset-anchors to recompute them.
//
// Usage: node assets/publish.mjs [--reset-anchors]
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
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
import {
  AR_ASSETS,
  PAGE_SIZE_MM,
  PIPELINE_OUT,
  UNITY_PROJECT,
  VUFORIA_DATASET,
  pageImage,
} from '../config.mjs';
import { SCENES } from '../scenes.mjs';
import { drawBoxes } from './images.mjs';
import { locateTarget } from './locate-target.mjs';
import { readVuforiaTargets } from './vuforia.mjs';

// Below this correlation the located target is reported as doubtful.
const MIN_MATCH_SCORE = 0.8;

const EXPORT_DIR = path.join(PIPELINE_OUT, 'export');
const ANCHOR_PREVIEWS = path.join(PIPELINE_OUT, 'anchors');
const MANIFEST = path.join(AR_ASSETS, 'scenes.json');

const resetAnchors = process.argv.includes('--reset-anchors');
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS);

const round = (value, digits) => Number(value.toFixed(digits));

/** Copies a file unless the target already has the same content. */
function publishFile(source, target) {
  if (!existsSync(source)) throw new Error(`Missing ${source}`);
  const content = readFileSync(source);
  const label = path.relative(AR_ASSETS, target).replaceAll('\\', '/');
  if (existsSync(target) && readFileSync(target).equals(content)) {
    console.log(`  unchanged ${label}`);
  } else {
    mkdirSync(path.dirname(target), { recursive: true });
    copyFileSync(source, target);
    console.log(`  updated   ${label} (${(content.length / 2 ** 20).toFixed(1)} MB)`);
  }
}

/** Removes files with the given extension that this run did not publish. */
function removeStale(dir, extension, keep) {
  if (!existsSync(dir)) return;
  for (const name of readdirSync(dir)) {
    if (name.endsWith(extension) && !keep.has(name)) {
      rmSync(path.join(dir, name));
      console.log(
        `removed   ${path.relative(AR_ASSETS, path.join(dir, name)).replaceAll('\\', '/')}`,
      );
    }
  }
}

/** Nodes of the GLB that carry a Unity component of the given type, with that component. */
function componentsOf(document, type) {
  return document
    .getRoot()
    .listNodes()
    .flatMap((node) =>
      (node.getExtras()?.unityComponents ?? [])
        .filter((component) => component.type === type)
        .map((component) => ({ node, component })),
    );
}

function single(list, what, id) {
  if (list.length !== 1) throw new Error(`${id}: expected one ${what}, found ${list.length}`);
  return list[0];
}

/**
 * Locates the Vuforia target on the page scan. Returns the anchor in page millimetres: origin at
 * the page centre, X to the right, Y to the top of the page; `width` is the target width.
 */
function locateAnchor(scene, target) {
  const aspect = target.size[1] / target.size[0];
  const image = pageImage(scene.page);
  const match = locateTarget(image, target.texture, aspect);
  const { rect, pageSize } = match;
  // Assumes the scan covers the whole page width (see the page normalization in the plan).
  const mmPerPixel = PAGE_SIZE_MM.width / pageSize.width;
  const centerX = rect.left + rect.width / 2;
  const centerY = rect.top + rect.height / 2;
  const anchor = {
    center: [
      round((centerX - pageSize.width / 2) * mmPerPixel, 1),
      round((pageSize.height / 2 - centerY) * mmPerPixel, 1),
    ],
    width: round(rect.width * mmPerPixel, 1),
  };

  mkdirSync(ANCHOR_PREVIEWS, { recursive: true });
  drawBoxes(image, path.join(ANCHOR_PREVIEWS, `${scene.id}.jpg`), [
    { x: rect.left, y: rect.top, w: rect.width, h: rect.height, color: 'red@0.9' },
  ]);
  const doubtful = match.score < MIN_MATCH_SCORE ? '  <-- check the preview' : '';
  console.log(
    `  anchor    centre ${anchor.center.join(', ')} mm, width ${anchor.width} mm` +
      ` (match ${match.score.toFixed(3)}, scale ratio ${match.scaleRatio.toFixed(3)})${doubtful}`,
  );
  return anchor;
}

const previous = existsSync(MANIFEST) ? JSON.parse(readFileSync(MANIFEST, 'utf8')) : { scenes: [] };
const vuforiaTargets = new Map(
  readVuforiaTargets(VUFORIA_DATASET.xml, VUFORIA_DATASET.dat).map((t) => [t.name, t]),
);

const scenes = [];
for (const scene of SCENES) {
  console.log(scene.id);
  const glbSource = path.join(EXPORT_DIR, `${scene.id}.glb`);
  const document = await io.read(glbSource);
  publishFile(glbSource, path.join(AR_ASSETS, 'models', `${scene.id}.glb`));

  const audio = single(componentsOf(document, 'AudioSource'), 'AudioSource', scene.id).component;
  if (path.extname(audio.clipPath).toLowerCase() !== '.mp3') {
    throw new Error(`${scene.id}: audio ${audio.clipPath} is not an MP3 file`);
  }
  publishFile(
    path.join(UNITY_PROJECT, audio.clipPath),
    path.join(AR_ASSETS, 'audio', `${scene.id}.mp3`),
  );

  // PinchScale clamps the node's uniform scale to [ScaleMin, ScaleMax]; store the limits relative
  // to the node's initial scale.
  const pinch = single(componentsOf(document, 'PinchScale'), 'PinchScale', scene.id);
  const initialScale = pinch.node.getScale()[0];

  // NFT marker files from nft:generate; the app loads them by this URL prefix.
  for (const ext of ['iset', 'fset', 'fset3']) {
    const file = path.join(AR_ASSETS, 'nft', scene.id, `${scene.id}.${ext}`);
    if (!existsSync(file)) throw new Error(`Missing ${file}; run npm run nft:generate`);
  }

  const target = vuforiaTargets.get(scene.target);
  if (!target) throw new Error(`${scene.id}: no Vuforia target ${scene.target}`);
  const kept = resetAnchors ? undefined : previous.scenes.find((s) => s.id === scene.id)?.anchor;
  if (kept) console.log(`  anchor    kept from scenes.json`);

  scenes.push({
    id: scene.id,
    page: scene.page,
    model: `models/${scene.id}.glb`,
    nft: `nft/${scene.id}/${scene.id}`,
    audio: { src: `audio/${scene.id}.mp3`, volume: audio.volume, loop: audio.loop },
    anchor: kept ?? locateAnchor(scene, target),
    pinch: {
      node: pinch.node.getName(),
      min: round(pinch.component.ScaleMin / initialScale, 3),
      max: round(pinch.component.ScaleMax / initialScale, 3),
      snapBack: pinch.component.SnapBack,
    },
  });
}

removeStale(path.join(AR_ASSETS, 'models'), '.glb', new Set(SCENES.map((s) => `${s.id}.glb`)));
removeStale(path.join(AR_ASSETS, 'audio'), '.mp3', new Set(SCENES.map((s) => `${s.id}.mp3`)));

const manifest = {
  page: { width: PAGE_SIZE_MM.width, height: PAGE_SIZE_MM.height },
  scenes,
};
const text = `${JSON.stringify(manifest, null, 2)}\n`;
if (existsSync(MANIFEST) && readFileSync(MANIFEST, 'utf8') === text) {
  console.log('unchanged scenes.json');
} else {
  writeFileSync(MANIFEST, text);
  console.log('updated   scenes.json');
}
