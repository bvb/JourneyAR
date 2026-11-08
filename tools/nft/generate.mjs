// Generates ARToolKit NFT marker data (.iset, .fset, .fset3) for normalized page images with
// @webarkit/nft-marker-creator-app, one process per page, sequentially. The image DPI is derived
// from the page width in pixels and the physical page width, so tracker poses come out in
// millimetres. A scene with `marker: 'target'` (tools/scenes.mjs) gets a marker of the part of
// its page where the original Vuforia target lies, cut from the normalized page at the same DPI
// (tools/.out/nft-images/<id>.png).
// Each run is logged to tools/.out/logs/nft-<id>-<width>.log; a summary with the marker's page
// region (`region`: centre and size in page mm, the app's scenes.json `marker`) and the feature
// counts is written to <out>/nft-report.json (the timings go to the console only: the report is
// published with the markers and must come out the same on every run).
//
// Usage: node nft/generate.mjs [scene ids...] [--pages=dir] [--out=dir] [--threads=n]
// Defaults: all scenes, pages-for-nft, journey-ar/assets/nft (<out>/<id>/<id>.*).
import { spawn } from 'node:child_process';
import {
  createWriteStream,
  existsSync,
  mkdirSync,
  readFileSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import sharp from 'sharp';
import {
  AR_ASSETS,
  NORMALIZED_PAGES,
  ORIGINAL_APK,
  PAGE_SIZE_MM,
  PIPELINE_OUT,
  pageDpi,
  pageImage,
} from '../config.mjs';
import { selectScenes } from '../scenes.mjs';
import { imageSize } from '../assets/images.mjs';
import { locateTargetOnPage } from '../assets/locate-target.mjs';
import { readVuforiaTargets } from '../assets/vuforia.mjs';

const require = createRequire(import.meta.url);
const CREATOR = path.join(
  path.dirname(require.resolve('@webarkit/nft-marker-creator-app/package.json')),
  'src',
  'NFTMarkerCreator.js',
);

const args = process.argv.slice(2);
const option = (name) => args.find((a) => a.startsWith(`--${name}=`))?.split('=')[1];
const pagesDir = path.resolve(option('pages') ?? NORMALIZED_PAGES);
const outDir = path.resolve(option('out') ?? path.join(AR_ASSETS, 'nft'));
const threads = Number(option('threads') ?? 1);
const logDir = path.join(PIPELINE_OUT, 'logs');
const imageDir = path.join(PIPELINE_OUT, 'nft-images');

let vuforiaTargets = null;

/**
 * The part of a normalized page (pixels, whole) a scene's marker is made from: the whole page,
 * or with `marker: 'target'` the rectangle of the original Vuforia target found on the scan.
 */
function markerRect(scene, page) {
  if (!scene.marker) return { left: 0, top: 0, width: page.width, height: page.height };
  if (scene.marker !== 'target') throw new Error(`${scene.id}: unknown marker "${scene.marker}"`);
  vuforiaTargets ??= new Map(readVuforiaTargets(ORIGINAL_APK).map((t) => [t.name, t]));
  const target = vuforiaTargets.get(scene.target);
  if (!target) throw new Error(`${scene.id}: no Vuforia target ${scene.target}`);
  const { center, size, score } = locateTargetOnPage(pageImage(scene.page), target);
  const pxPerMm = page.width / PAGE_SIZE_MM.width;
  const width = Math.round(size[0] * pxPerMm);
  const height = Math.round(size[1] * pxPerMm);
  const left = Math.round(page.width / 2 + center[0] * pxPerMm - width / 2);
  const top = Math.round(page.height / 2 - center[1] * pxPerMm - height / 2);
  if (left < 0 || top < 0 || left + width > page.width || top + height > page.height) {
    throw new Error(`${scene.id}: the target lies outside the page`);
  }
  process.stdout.write(
    `target ${width}x${height} px at ${left},${top} (match ${score.toFixed(3)}) `,
  );
  return { left, top, width, height };
}

/** A rectangle of the normalized page in page mm: centre (origin at the page centre, Y up), size. */
function regionMm(rect, page) {
  const mmPerPx = PAGE_SIZE_MM.width / page.width;
  const mm = (value) => Math.round(value * mmPerPx * 100) / 100;
  return {
    center: [
      mm(rect.left + rect.width / 2 - page.width / 2),
      mm(page.height / 2 - (rect.top + rect.height / 2)),
    ],
    size: [mm(rect.width), mm(rect.height)],
  };
}

/** Feature counts per resolution level, parsed from the generator log. */
function parseLog(log) {
  const tracking = [];
  for (const block of log.split('Start for ').slice(1)) {
    const dpi = Number(/^([\d.]+) dpi image/.exec(block)?.[1]);
    const numbers = [...block.matchAll(/^\[info\]\s+(\d+): \(/gm)].map((m) => Number(m[1]));
    tracking.push({ dpi, features: numbers.length ? Math.max(...numbers) : 0 });
  }
  const freak = [
    ...log.matchAll(/\(\d+, \d+\) ([\d.]+)\[dpi\]\s+\[info\] Freak features - (\d+)/g),
  ].map((m) => ({ dpi: Number(m[1]), features: Number(m[2]) }));
  const entropy = Number(/Entropy: ([\d.]+)/.exec(log)?.[1]);
  return { entropy, tracking, freak };
}

function run(image, dpi, target, logFile) {
  const { width } = imageSize(image);
  const creatorArgs = [CREATOR, '-i', image, '-o', target, `-dpi=${dpi.toFixed(3)}`];
  if (threads > 1) creatorArgs.push('--threaded', String(threads));
  const log = createWriteStream(logFile);
  const started = performance.now();
  return new Promise((resolve, reject) => {
    // The creator relaunches itself unless NODE_OPTIONS is set; give it the memory it asks for.
    const child = spawn(process.execPath, creatorArgs, {
      env: { ...process.env, NODE_OPTIONS: '--max-old-space-size=4096' },
    });
    child.stdout.pipe(log);
    child.stderr.pipe(log);
    child.on('error', reject);
    child.on('close', (code) => {
      log.end(() => {
        if (code !== 0) reject(new Error(`NFT generator exited with ${code}, see ${logFile}`));
        else resolve({ width, dpi, seconds: (performance.now() - started) / 1000 });
      });
    });
  });
}

mkdirSync(logDir, { recursive: true });
const report = [];
for (const scene of selectScenes(args)) {
  const pageFile = path.join(pagesDir, `${scene.id}.jpg`);
  if (!existsSync(pageFile)) throw new Error(`Missing page image ${pageFile}; run pages:normalize`);
  const target = path.join(outDir, scene.id);
  mkdirSync(target, { recursive: true });
  const page = imageSize(pageFile);
  process.stdout.write(`${scene.id} `);
  const rect = markerRect(scene, page);
  let image = pageFile;
  if (rect.width !== page.width || rect.height !== page.height) {
    mkdirSync(imageDir, { recursive: true });
    image = path.join(imageDir, `${scene.id}.png`);
    await sharp(pageFile).extract(rect).png().toFile(image);
  }
  const logFile = path.join(logDir, `nft-${scene.id}-${rect.width}.log`);
  process.stdout.write(`(${rect.width} px) ... `);
  const result = await run(image, pageDpi(page.width), target, logFile);
  const parsed = parseLog(readFileSync(logFile, 'utf8'));
  const files = Object.fromEntries(
    ['iset', 'fset', 'fset3'].map((ext) => [
      ext,
      statSync(path.join(target, `${scene.id}.${ext}`)).size,
    ]),
  );
  const entry = {
    id: scene.id,
    width: result.width,
    dpi: result.dpi,
    region: regionMm(rect, page),
    ...parsed,
    files,
  };
  report.push(entry);
  const top = (list) =>
    list.find((level) => Math.abs(level.dpi - result.dpi) < 0.01)?.features ?? 0;
  console.log(
    `${result.seconds.toFixed(0)} s, ${result.dpi.toFixed(1)} dpi, entropy ${parsed.entropy}, ` +
      `tracking features ${top(parsed.tracking)} at full size, freak ${top(parsed.freak)}, ` +
      `${parsed.tracking.length} levels, ${((files.iset + files.fset + files.fset3) / 1024).toFixed(0)} KB`,
  );
}

const reportFile = path.join(outDir, 'nft-report.json');
const previous = existsSync(reportFile) ? JSON.parse(readFileSync(reportFile, 'utf8')) : [];
// Reports written before the timings left them.
for (const entry of previous) delete entry.seconds;
const merged = [...previous.filter((p) => !report.some((r) => r.id === p.id)), ...report];
writeFileSync(reportFile, `${JSON.stringify(merged, null, 2)}\n`);
