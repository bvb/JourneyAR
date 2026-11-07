// Publishes the interface assets into journey-ar/assets:
// - the favicons for the browsers, as given in assets-favicon/ (the web manifest gets the app's
//   name and colours);
// - background.jpg: the picture behind the Start button until the camera starts
//   (book/journey-art1600.jpg, outside git; as is);
// - logo.svg: the traveller of the icon traced into a vector shape, white on transparent, for
//   the Start/Stop button. The icons only exist as small images (the largest is
//   mstile-150x150.png; safari-pinned-tab.svg is the outline of the whole square), so the shape
//   is traced from that image: smoothed, contoured and simplified (tools/images/trace.mjs).
//
// Usage: node assets/ui-assets.mjs
import { spawnSync } from 'node:child_process';
import { readFileSync, readdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { AR_ASSETS, BACKGROUND_SOURCE, FAVICON_SOURCE, FFMPEG } from '../config.mjs';
import { area, contours, pathData, simplify, smoothUpsample } from '../images/trace.mjs';
import { imageSize } from './images.mjs';

const LOGO_SOURCE = path.join(FAVICON_SOURCE, 'mstile-150x150.png');
const UPSAMPLE = 8;
// Gaussian blur in source pixels: smooths the pixel steps, keeps the one-pixel dark lines.
const SIGMA = 0.5;
// Simplification tolerance and the smallest kept shape, in source pixels.
const EPSILON = 0.06;
const MIN_AREA = 0.5;

function publish(name, text) {
  const target = path.join(AR_ASSETS, name);
  let previous = null;
  try {
    previous = readFileSync(target);
  } catch {
    // New file.
  }
  const changed = !previous || !previous.equals(Buffer.from(text));
  if (changed) writeFileSync(target, text);
  console.log(`${changed ? 'updated  ' : 'unchanged'} ${name}`);
}

// Favicons as given; the manifest names the app.
for (const name of readdirSync(FAVICON_SOURCE)) {
  if (name === 'site.webmanifest') continue;
  const source = path.join(FAVICON_SOURCE, name);
  publish(name, readFileSync(source));
}
const manifest = JSON.parse(readFileSync(path.join(FAVICON_SOURCE, 'site.webmanifest'), 'utf8'));
manifest.name = 'Journey AR';
manifest.short_name = 'Journey AR';
manifest.theme_color = '#000000';
manifest.background_color = '#000000';
// Relative to the manifest, so the app also works below a sub-path.
manifest.icons = manifest.icons.map((icon) => ({ ...icon, src: icon.src.replace(/^\//, '') }));
publish('site.webmanifest', `${JSON.stringify(manifest, null, 2)}\n`);

publish('background.jpg', readFileSync(BACKGROUND_SOURCE));

// The traveller: white (and opaque) pixels of the icon, without its dark square.
const { width, height } = imageSize(LOGO_SOURCE);
const raw = spawnSync(FFMPEG, [
  '-hide_banner',
  '-v',
  'error',
  '-i',
  LOGO_SOURCE,
  '-f',
  'rawvideo',
  '-pix_fmt',
  'ya8',
  'pipe:1',
]).stdout;
if (raw.length !== width * height * 2) throw new Error(`Cannot decode ${LOGO_SOURCE}`);
const values = new Float32Array(width * height);
for (let i = 0; i < width * height; i += 1) values[i] = (raw[2 * i] / 255) * (raw[2 * i + 1] / 255);

const up = smoothUpsample(values, width, height, UPSAMPLE, SIGMA);
// Map coordinates to source pixel edges (pixel i covers [i, i + 1]).
const toSource = ([x, y]) => [(x + 0.5) / UPSAMPLE, (y + 0.5) / UPSAMPLE];
const loops = contours(up.values, up.width, up.height, 0.5)
  .map((loop) => simplify(loop.map(toSource), EPSILON))
  .filter((loop) => Math.abs(area(loop)) >= MIN_AREA);

// A square view box around the shape, so it sits centred in the round button.
const xs = loops.flatMap((loop) => loop.map(([x]) => x));
const ys = loops.flatMap((loop) => loop.map(([, y]) => y));
const [minX, maxX, minY, maxY] = [
  Math.min(...xs),
  Math.max(...xs),
  Math.min(...ys),
  Math.max(...ys),
];
const side = Math.max(maxX - minX, maxY - minY);
const left = (minX + maxX - side) / 2;
const top = (minY + maxY - side) / 2;
const shifted = loops.map((loop) => loop.map(([x, y]) => [x - left, y - top]));
const size = Number(side.toFixed(2));
const svg =
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${size} ${size}">` +
  `<path fill="#fff" fill-rule="evenodd" d="${pathData(shifted)}"/></svg>\n`;
publish('logo.svg', svg);
console.log(
  `logo: ${loops.length} contours, ${loops.reduce((n, l) => n + l.length, 0)} points, ` +
    `${svg.length} bytes`,
);
