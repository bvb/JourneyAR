// Normalizes the page scans: scales each scan to cover the target size and crops it
// symmetrically to the physical page proportions (303 x 226 mm), so the page centre stays at the
// image centre (the anchors in scenes.json rely on that). The crop is a fraction of a percent.
//
// Usage: node images/normalize-pages.mjs [scene ids...] [--width=1700] [--out=dir]
// Defaults: all scenes, 1700 px wide, book-ar-pages/normalized/<id>.jpg.
import { spawnSync } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import path from 'node:path';
import {
  FFMPEG,
  NORMALIZED_PAGES,
  NORMALIZED_PAGE_WIDTH,
  pageDpi,
  pageHeightFor,
  pageImage,
} from '../config.mjs';
import { selectScenes } from '../scenes.mjs';
import { imageSize } from '../assets/images.mjs';

const args = process.argv.slice(2);
const option = (name) => args.find((a) => a.startsWith(`--${name}=`))?.split('=')[1];
const width = Number(option('width') ?? NORMALIZED_PAGE_WIDTH);
const outDir = path.resolve(option('out') ?? NORMALIZED_PAGES);
const height = pageHeightFor(width);

mkdirSync(outDir, { recursive: true });
console.log(`${width}x${height} px, ${pageDpi(width).toFixed(2)} dpi -> ${outDir}`);

for (const scene of selectScenes(args)) {
  const source = pageImage(scene.page);
  const size = imageSize(source);
  const scale = Math.max(width / size.width, height / size.height);
  const cropX = (size.width * scale - width) / scale;
  const cropY = (size.height * scale - height) / scale;
  const target = path.join(outDir, `${scene.id}.jpg`);
  const result = spawnSync(FFMPEG, [
    '-hide_banner',
    '-v',
    'error',
    '-y',
    '-i',
    source,
    '-vf',
    `scale=${width}:${height}:force_original_aspect_ratio=increase:flags=lanczos,crop=${width}:${height}`,
    '-pix_fmt',
    'yuvj444p',
    '-q:v',
    '2',
    target,
  ]);
  if (result.status !== 0) throw new Error(`ffmpeg failed for ${source}:\n${result.stderr}`);
  console.log(
    `${scene.id.padEnd(13)} ${scene.page.padEnd(8)} ${size.width}x${size.height}` +
      ` -> cropped ${cropX.toFixed(1)} x ${cropY.toFixed(1)} source px`,
  );
}
