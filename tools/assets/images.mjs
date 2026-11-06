// Image decoding through ffmpeg: grayscale float pixels for image matching, plus helpers.
import { spawnSync } from 'node:child_process';
import { FFMPEG } from '../config.mjs';

function run(args, input) {
  const result = spawnSync(FFMPEG, ['-hide_banner', '-v', 'error', ...args], {
    input,
    maxBuffer: 1 << 28,
  });
  if (result.status !== 0) {
    throw new Error(`ffmpeg ${args.join(' ')} failed:\n${result.stderr?.toString() ?? ''}`);
  }
  return result.stdout;
}

/** Width and height of an image file or JPEG buffer. */
export function imageSize(source) {
  const input = typeof source === 'string' ? ['-i', source] : ['-f', 'jpeg_pipe', '-i', 'pipe:0'];
  const result = spawnSync(FFMPEG, ['-hide_banner', ...input], {
    input: typeof source === 'string' ? undefined : source,
  });
  const match = /Stream .*Video: .*?, (\d+)x(\d+)/.exec(result.stderr.toString());
  if (!match)
    throw new Error(`Cannot read the size of ${typeof source === 'string' ? source : 'buffer'}`);
  return { width: Number(match[1]), height: Number(match[2]) };
}

/**
 * Decodes an image (file path or JPEG buffer) to grayscale, optionally resized with area
 * averaging. Returns { width, height, data: Float32Array } with values 0..255.
 */
export function decodeGray(source, width, height) {
  const size = imageSize(source);
  const w = width ?? size.width;
  const h = height ?? Math.round((w * size.height) / size.width);
  const input = typeof source === 'string' ? ['-i', source] : ['-f', 'jpeg_pipe', '-i', 'pipe:0'];
  const bytes = run(
    [...input, '-vf', `scale=${w}:${h}:flags=area,format=gray`, '-f', 'rawvideo', 'pipe:1'],
    typeof source === 'string' ? undefined : source,
  );
  if (bytes.length !== w * h) throw new Error(`Unexpected decoded size ${bytes.length}`);
  return { width: w, height: h, data: Float32Array.from(bytes) };
}

/** Writes a copy of an image with rectangles drawn on it ({x, y, w, h, color} in pixels). */
export function drawBoxes(source, target, boxes) {
  const filters = boxes
    .map(
      ({ x, y, w, h, color }) =>
        `drawbox=x=${Math.round(x)}:y=${Math.round(y)}:w=${Math.round(w)}:h=${Math.round(h)}:color=${color}:t=5`,
    )
    .join(',');
  run(['-y', '-i', source, '-vf', filters, '-q:v', '3', target]);
}
