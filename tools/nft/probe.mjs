// Measures how well NFT marker data detects and tracks a page, without a browser: renders the
// normalized page into synthetic 640x480 camera frames with known poses (a planar homography with
// mip-mapped sampling, a textured background and sensor noise), feeds them to the Node build of
// @webarkit/jsartoolkit-nft and compares the tracked pose with the ground truth.
//
// Usage: node nft/probe.mjs [scene ids...] [--markers=<dir>] [--frames=30] [--json=<file>]
//        [--save-frames=<dir>] (first frame of every view as PNG, to check the rendering)
//        [--together] (all markers in one tracker, as in the app: also checks that a page is
//        never taken for another one)
// <dir>/<id>/<id>.{iset,fset,fset3} are the markers (default: the app's, journey-ar/assets/nft;
// a relative <dir> is relative to tools/); the frames are rendered from
// pages-for-nft/<id>.jpg (the page as printed, 303 x 226 mm).
// A marker of a part of its page (`region` in <dir>/nft-report.json, see nft/generate.mjs) is
// looked at the way a page is: the views are moved to the region's centre and scaled by its width
// relative to the page width. The pose is taken as in the app (tracker origin "corner", moved by
// the region), and the errors are measured at the marker's centre.
import { createNFTTracker } from '@webarkit/jsartoolkit-nft';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { AR_ASSETS, FFMPEG, NORMALIZED_PAGES, PAGE_SIZE_MM } from '../config.mjs';
import { selectScenes } from '../scenes.mjs';
import { decodeGray } from '../assets/images.mjs';

const WIDTH = 640;
const HEIGHT = 480;
// A typical phone camera: about 63 degrees horizontal field of view at 4:3.
const FOCAL = 522;
const CX = (WIDTH - 1) / 2;
const CY = (HEIGHT - 1) / 2;
const FRAME_MS = 33;

const args = process.argv.slice(2);
const option = (name) => args.find((a) => a.startsWith(`--${name}=`))?.split('=')[1];
const markersDir = path.resolve(option('markers') ?? path.join(AR_ASSETS, 'nft'));
const frames = Number(option('frames') ?? 30);
const jsonFile = option('json');
const framesDir = option('save-frames');
const together = args.includes('--together');

/**
 * Camera views of the page: the camera looks at `at` (page mm, origin at the page centre, Y to
 * the top) from `distance` mm, tilted by `tilt` degrees towards the page bottom and rolled by
 * `roll` degrees around its axis. Optional: `blur` (extra mip levels, defocus), `contrast`
 * (scales the page around mid-grey, low light) and `noise` (sensor noise multiplier).
 */
const VIEWS = [
  { name: 'front 300', at: [0, 0], distance: 300, tilt: 0, roll: 0 },
  { name: 'front 450', at: [0, 0], distance: 450, tilt: 0, roll: 0 },
  { name: 'front 650', at: [0, 0], distance: 650, tilt: 0, roll: 0 },
  { name: 'tilt 30', at: [0, 0], distance: 400, tilt: 30, roll: 0 },
  { name: 'tilt 50', at: [0, 0], distance: 400, tilt: 50, roll: 0 },
  { name: 'roll 90', at: [0, 0], distance: 400, tilt: 0, roll: 90 },
  { name: 'part 200', at: [-70, 40], distance: 200, tilt: 15, roll: 10 },
  { name: 'part 150', at: [60, -50], distance: 150, tilt: 0, roll: -20 },
  // Harder cases: small in the frame, grazing angle, out of focus, low light.
  { name: 'far 900', at: [0, 0], distance: 900, tilt: 0, roll: 0 },
  { name: 'tilt 65', at: [0, 0], distance: 400, tilt: 65, roll: 0 },
  { name: 'blur', at: [0, 0], distance: 350, tilt: 20, roll: 0, blur: 1.5 },
  { name: 'dim', at: [0, 0], distance: 400, tilt: 20, roll: 0, contrast: 0.35, noise: 3 },
];

// --- small vector helpers -------------------------------------------------------------------
const sub = (a, b) => a.map((v, i) => v - b[i]);
const dot = (a, b) => a.reduce((s, v, i) => s + v * b[i], 0);
const scale = (a, k) => a.map((v) => v * k);
const norm = (a) => scale(a, 1 / Math.hypot(...a));
const cross = (a, b) => [
  a[1] * b[2] - a[2] * b[1],
  a[2] * b[0] - a[0] * b[2],
  a[0] * b[1] - a[1] * b[0],
];

/** Ground truth: rotation rows (page -> camera, OpenCV axes: X right, Y down, Z forward) and t. */
function cameraPose({ at, distance, tilt, roll }) {
  const target = [at[0], at[1], 0];
  const a = (tilt * Math.PI) / 180;
  const eye = [at[0], at[1] - distance * Math.sin(a), distance * Math.cos(a)];
  const z = norm(sub(target, eye));
  const y0 = norm(sub([0, -1, 0], scale(z, dot([0, -1, 0], z))));
  const x0 = cross(y0, z);
  const r = (roll * Math.PI) / 180;
  const x = sub(scale(x0, Math.cos(r)), scale(y0, Math.sin(r)));
  const y = cross(z, x);
  const R = [x, y, z];
  const t = R.map((row) => -dot(row, eye));
  return { R, t };
}

/** 3x3 inverse. */
function invert3(m) {
  const [a, b, c, d, e, f, g, h, i] = m;
  const A = e * i - f * h;
  const B = -(d * i - f * g);
  const C = d * h - e * g;
  const det = a * A + b * B + c * C;
  return [
    A,
    -(b * i - c * h),
    b * f - c * e,
    B,
    a * i - c * g,
    -(a * f - c * d),
    C,
    -(a * h - b * g),
    a * e - b * d,
  ].map((v) => v / det);
}

/** Mip pyramid of a grayscale image (box filter). */
function pyramid(image, levels) {
  const out = [image];
  for (let l = 1; l < levels; l += 1) {
    const prev = out[l - 1];
    const w = Math.floor(prev.width / 2);
    const h = Math.floor(prev.height / 2);
    const data = new Float32Array(w * h);
    for (let y = 0; y < h; y += 1) {
      for (let x = 0; x < w; x += 1) {
        const i = 2 * y * prev.width + 2 * x;
        data[y * w + x] =
          (prev.data[i] +
            prev.data[i + 1] +
            prev.data[i + prev.width] +
            prev.data[i + prev.width + 1]) /
          4;
      }
    }
    out.push({ width: w, height: h, data });
  }
  return out;
}

function bilinear({ width, height, data }, x, y) {
  const xc = Math.min(Math.max(x, 0), width - 1);
  const yc = Math.min(Math.max(y, 0), height - 1);
  const x0 = Math.floor(xc);
  const y0 = Math.floor(yc);
  const x1 = Math.min(x0 + 1, width - 1);
  const y1 = Math.min(y0 + 1, height - 1);
  const fx = xc - x0;
  const fy = yc - y0;
  const top = data[y0 * width + x0] * (1 - fx) + data[y0 * width + x1] * fx;
  const bottom = data[y1 * width + x0] * (1 - fx) + data[y1 * width + x1] * fx;
  return top * (1 - fy) + bottom * fy;
}

/** Deterministic pseudo-random numbers (mulberry32). */
function random(seed) {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// A table-like background: smooth low-contrast blotches, the same for every view.
const BACKGROUND = (() => {
  const rnd = random(7);
  const coarse = Array.from({ length: 13 * 10 }, () => 70 + rnd() * 40);
  const data = new Float32Array(WIDTH * HEIGHT);
  for (let y = 0; y < HEIGHT; y += 1) {
    for (let x = 0; x < WIDTH; x += 1) {
      data[y * WIDTH + x] = bilinear(
        { width: 13, height: 10, data: coarse },
        (x / WIDTH) * 12,
        (y / HEIGHT) * 9,
      );
    }
  }
  return data;
})();

/** Renders the page seen from `pose` into an RGBA frame, with sensor noise from `seed`. */
function render(levels, pose, seed, { blur = 0, contrast = 1, noise = 1 } = {}) {
  const { R, t } = pose;
  const pxPerMm = levels[0].width / PAGE_SIZE_MM.width;
  // Homography page mm (x, y, 1) -> pixels: K [r1 r2 t] with r1, r2 the first two columns of R.
  const K = [FOCAL, 0, CX, 0, FOCAL, CY, 0, 0, 1];
  const M = [R[0][0], R[0][1], t[0], R[1][0], R[1][1], t[1], R[2][0], R[2][1], t[2]];
  const H = [0, 1, 2].flatMap((r) =>
    [0, 1, 2].map((c) => K[r * 3] * M[c] + K[r * 3 + 1] * M[3 + c] + K[r * 3 + 2] * M[6 + c]),
  );
  const Hi = invert3(H);
  const rnd = random(seed);
  const rgba = new Uint8ClampedArray(WIDTH * HEIGHT * 4);
  const toPage = (u, v) => {
    const w = Hi[6] * u + Hi[7] * v + Hi[8];
    return [(Hi[0] * u + Hi[1] * v + Hi[2]) / w, (Hi[3] * u + Hi[4] * v + Hi[5]) / w];
  };
  for (let v = 0; v < HEIGHT; v += 1) {
    for (let u = 0; u < WIDTH; u += 1) {
      const [x, y] = toPage(u, v);
      let value = BACKGROUND[v * WIDTH + u];
      if (Math.abs(x) <= PAGE_SIZE_MM.width / 2 && Math.abs(y) <= PAGE_SIZE_MM.height / 2) {
        // Footprint of the frame pixel on the page, in page pixels, picks the mip level.
        const [x2, y2] = toPage(u + 1, v);
        const [x3, y3] = toPage(u, v + 1);
        const footprint =
          Math.max(Math.hypot(x2 - x, y2 - y), Math.hypot(x3 - x, y3 - y)) * pxPerMm;
        const level = Math.min(
          levels.length - 1,
          Math.max(0, Math.round(Math.log2(Math.max(footprint, 1)) + blur)),
        );
        const k = 2 ** level;
        const px = (x + PAGE_SIZE_MM.width / 2) * pxPerMm;
        const py = (PAGE_SIZE_MM.height / 2 - y) * pxPerMm;
        // Level pixel j covers level-0 pixels [j k, (j + 1) k): its centre is at (j + 0.5) k.
        value = 128 + (bilinear(levels[level], px / k - 0.5, py / k - 0.5) - 128) * contrast;
      }
      // Sensor noise, roughly Gaussian (sum of uniforms), sigma ~ 2.
      value += (rnd() + rnd() + rnd() - 1.5) * 4 * noise;
      const i = (v * WIDTH + u) * 4;
      rgba[i] = rgba[i + 1] = rgba[i + 2] = value;
      rgba[i + 3] = 255;
    }
  }
  return rgba;
}

/** ARToolKit camera parameter file (version 4, no distortion) for the synthetic camera. */
function cameraParam() {
  const bytes = Buffer.alloc(176);
  bytes.writeInt32BE(WIDTH, 0);
  bytes.writeInt32BE(HEIGHT, 4);
  const mat = [FOCAL, 0, CX, 0, 0, FOCAL, CY, 0, 0, 0, 1, 0];
  const dist = [0, 0, 0, 0, FOCAL, FOCAL, CX, CY, 1];
  [...mat, ...dist].forEach((v, i) => bytes.writeDoubleBE(v, 8 + i * 8));
  return new Uint8Array(bytes);
}

/** Tracker pose (column-major GL model-view, Y up, Z back) -> OpenCV rotation rows and t. */
function fromGl(m) {
  const flip = [1, -1, -1];
  const R = [0, 1, 2].map((r) => [0, 1, 2].map((c) => flip[r] * m[c * 4 + r]));
  const t = [0, 1, 2].map((r) => flip[r] * m[12 + r]);
  return { R, t };
}

/** The pose (OpenCV rows and t) with its origin moved to the point `p` of its frame. */
function moveOrigin({ R, t }, p) {
  return { R, t: t.map((v, i) => v + dot(R[i], p)) };
}

function poseError(estimate, truth) {
  const translation = Math.hypot(...sub(estimate.t, truth.t));
  // Angle of R_est * R_truth^T.
  let trace = 0;
  for (let i = 0; i < 3; i += 1) trace += dot(estimate.R[i], truth.R[i]);
  const angle = (Math.acos(Math.min(1, Math.max(-1, (trace - 1) / 2))) * 180) / Math.PI;
  return { translation, angle };
}

function saveFrame(rgba, file) {
  mkdirSync(path.dirname(file), { recursive: true });
  const result = spawnSync(
    FFMPEG,
    [
      '-v',
      'error',
      '-y',
      '-f',
      'rawvideo',
      '-pix_fmt',
      'rgba',
      '-s',
      `${WIDTH}x${HEIGHT}`,
      '-i',
      'pipe:0',
      file,
    ],
    { input: Buffer.from(rgba.buffer) },
  );
  if (result.status !== 0) throw new Error(`ffmpeg failed: ${result.stderr}`);
}

const median = (values) => {
  if (values.length === 0) return NaN;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)];
};

/** A tracker with the markers of `sceneList`; `ids` maps the tracker's target ids to scene ids. */
async function createTracker(sceneList) {
  const tracker = await createNFTTracker({
    width: WIDTH,
    height: HEIGHT,
    cameraParam: cameraParam(),
    filter: 'none',
    logLevel: 3,
  });
  const markers = sceneList.map((scene) => path.join(markersDir, scene.id, scene.id));
  const loads = await tracker.addNFTTargets(markers, { origin: 'corner' });
  const ids = new Map();
  loads.forEach((load, i) => {
    if (load.status !== 'loaded') throw new Error(`${markers[i]}: ${load.message}`);
    ids.set(load.info.id, sceneList[i].id);
  });
  return { tracker, ids };
}

const EMPTY_FRAME = new Uint8ClampedArray(WIDTH * HEIGHT * 4);
for (let i = 0; i < WIDTH * HEIGHT; i += 1) {
  EMPTY_FRAME.fill(BACKGROUND[i], i * 4, i * 4 + 3);
  EMPTY_FRAME[i * 4 + 3] = 255;
}

// The page regions of the markers (whole pages when the report has none).
const reportFile = path.join(markersDir, 'nft-report.json');
const regions = new Map(
  (existsSync(reportFile) ? JSON.parse(readFileSync(reportFile, 'utf8')) : []).map((entry) => [
    entry.id,
    entry.region,
  ]),
);
const WHOLE_PAGE = { center: [0, 0], size: [PAGE_SIZE_MM.width, PAGE_SIZE_MM.height] };

const scenes = selectScenes(args);
const shared = together ? await createTracker(scenes) : null;
const results = [];
let time = 0;
let falsePositives = 0;
for (const scene of scenes) {
  const page = decodeGray(path.join(NORMALIZED_PAGES, `${scene.id}.jpg`));
  const levels = pyramid(page, 6);
  const { tracker, ids } = shared ?? (await createTracker([scene]));
  const region = regions.get(scene.id) ?? WHOLE_PAGE;
  const k = region.size[0] / PAGE_SIZE_MM.width;
  const markerCenter = [region.center[0], region.center[1], 0];
  // From the marker's bottom-left corner (tracker origin) to its centre.
  const halfSize = [region.size[0] / 2, region.size[1] / 2, 0];
  if (k < 0.999) {
    console.log(
      `${scene.id}: marker of ${region.size.join(' x ')} mm at ${region.center.join(', ')} ` +
        `on the page; views scaled by ${k.toFixed(3)}`,
    );
  }

  for (const pageView of VIEWS) {
    const view = {
      ...pageView,
      at: [region.center[0] + pageView.at[0] * k, region.center[1] + pageView.at[1] * k],
      distance: pageView.distance * k,
    };
    const truth = cameraPose(view);
    const truthAtMarker = moveOrigin(truth, markerCenter);
    let firstFound = -1;
    const errors = [];
    const detectMs = [];
    const trackMs = [];
    const wrong = new Map();
    for (let f = 0; f < frames; f += 1) {
      const frame = render(levels, truth, f + 1, view);
      if (framesDir && f === 0) {
        saveFrame(frame, path.join(framesDir, `${scene.id}-${view.name.replace(' ', '-')}.png`));
      }
      time += FRAME_MS;
      const result = tracker.process({ data: frame, width: WIDTH, height: HEIGHT }, time);
      for (const target of result.targets) {
        if (!target.found || !target.pose) continue;
        const found = ids.get(target.id);
        if (found !== scene.id) {
          wrong.set(found, (wrong.get(found) ?? 0) + 1);
          continue;
        }
        if (firstFound < 0) {
          firstFound = f;
          detectMs.push(result.processMs);
        } else {
          trackMs.push(result.processMs);
        }
        errors.push(poseError(moveOrigin(fromGl(target.pose), halfSize), truthAtMarker));
      }
    }
    // Background-only frames between views. Right after the page leaves, tracking may still
    // report it for a few frames ("lingering"); anything found after that is a false detection.
    let lingering = 0;
    let lost = false;
    for (let f = 0; f < 10; f += 1) {
      time += FRAME_MS;
      const result = tracker.process(
        { data: EMPTY_FRAME.slice(), width: WIDTH, height: HEIGHT },
        time,
      );
      const found = result.targets.filter((target) => target.found).length;
      if (found && !lost) lingering += 1;
      else if (found) falsePositives += found;
      else lost = true;
    }
    time += 1000;
    const entry = {
      scene: scene.id,
      view: view.name,
      found: firstFound >= 0,
      firstFrame: firstFound,
      trackedFrames: errors.length,
      translationMm: median(errors.map((e) => e.translation)),
      angleDeg: median(errors.map((e) => e.angle)),
      detectMs: median(detectMs),
      trackMs: median(trackMs),
      trackMaxMs: trackMs.length ? Math.max(...trackMs) : NaN,
      wrong: Object.fromEntries(wrong),
      lingeringFrames: lingering,
    };
    results.push(entry);
    const wrongText = wrong.size
      ? `, WRONG: ${[...wrong].map(([id, n]) => `${id} x${n}`).join(', ')}`
      : '';
    console.log(
      `${scene.id.padEnd(13)} ${view.name.padEnd(10)} ` +
        (entry.found
          ? `found at frame ${String(firstFound).padStart(2)}, tracked ${String(errors.length).padStart(2)}/${frames}, ` +
            `error ${entry.translationMm.toFixed(1)} mm / ${entry.angleDeg.toFixed(2)} deg, ` +
            `detect ${entry.detectMs.toFixed(0)} ms, track ${Number.isNaN(entry.trackMs) ? '-' : `${entry.trackMs.toFixed(0)} (max ${entry.trackMaxMs.toFixed(0)})`} ms`
          : 'not found') +
        (lingering ? `, still reported ${lingering} frame(s) after the page left` : '') +
        wrongText,
    );
  }
  if (!shared) tracker.dispose?.();
}
shared?.tracker.dispose?.();
console.log(`false detections on background-only frames: ${falsePositives}`);

if (jsonFile) writeFileSync(jsonFile, `${JSON.stringify(results, null, 2)}\n`);
