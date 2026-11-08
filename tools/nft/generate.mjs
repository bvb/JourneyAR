// Generates ARToolKit NFT marker data (.iset, .fset, .fset3) for normalized page images with
// @webarkit/nft-marker-creator-app, one process per page, sequentially. The image DPI is derived
// from the image width and the physical page width, so tracker poses come out in millimetres.
// Each run is logged to tools/.out/logs/nft-<id>-<width>.log; a summary with timings and feature
// counts is written to <out>/nft-report.json.
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
import { AR_ASSETS, NORMALIZED_PAGES, PIPELINE_OUT, pageDpi } from '../config.mjs';
import { selectScenes } from '../scenes.mjs';
import { imageSize } from '../assets/images.mjs';

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

function run(image, target, logFile) {
  const { width } = imageSize(image);
  const dpi = pageDpi(width);
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
  const image = path.join(pagesDir, `${scene.id}.jpg`);
  if (!existsSync(image)) throw new Error(`Missing page image ${image}; run pages:normalize`);
  const target = path.join(outDir, scene.id);
  mkdirSync(target, { recursive: true });
  const { width } = imageSize(image);
  const logFile = path.join(logDir, `nft-${scene.id}-${width}.log`);
  process.stdout.write(`${scene.id} (${width} px) ... `);
  const result = await run(image, target, logFile);
  const parsed = parseLog(readFileSync(logFile, 'utf8'));
  const files = Object.fromEntries(
    ['iset', 'fset', 'fset3'].map((ext) => [
      ext,
      statSync(path.join(target, `${scene.id}.${ext}`)).size,
    ]),
  );
  const entry = { id: scene.id, ...result, ...parsed, files };
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
const merged = [...previous.filter((p) => !report.some((r) => r.id === p.id)), ...report];
writeFileSync(reportFile, `${JSON.stringify(merged, null, 2)}\n`);
