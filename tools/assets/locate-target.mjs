// Finds where an original Vuforia target texture lies on a page scan: an exhaustive search at
// low resolution (position and uniform scale), then a local refinement of position and of the
// horizontal and vertical scale at roughly the texture's own resolution. The score is the
// normalized cross-correlation, so the scan's brightness and contrast do not matter.
import { PAGE_SIZE_MM } from '../config.mjs';
import { decodeGray, imageSize } from './images.mjs';

const COARSE_PAGE_WIDTH = 160;
const COARSE_FACTOR = 8;
const MIN_TARGET_FRACTION = 0.3;
const MAX_TARGET_FRACTION = 1.05;

/** Bilinear sampler in pixel-index coordinates (pixel i has its centre at i), edge-clamped. */
function sampler({ width, height, data }) {
  return (x, y) => {
    const xc = Math.min(Math.max(x, 0), width - 1);
    const yc = Math.min(Math.max(y, 0), height - 1);
    const x0 = Math.floor(xc);
    const y0 = Math.floor(yc);
    const x1 = Math.min(x0 + 1, width - 1);
    const y1 = Math.min(y0 + 1, height - 1);
    const fx = xc - x0;
    const fy = yc - y0;
    const a = data[y0 * width + x0];
    const b = data[y0 * width + x1];
    const c = data[y1 * width + x0];
    const d = data[y1 * width + x1];
    return a + (b - a) * fx + (c - a) * fy + (a - b - c + d) * fx * fy;
  };
}

/** Block average by an integer factor (dimensions must divide). */
function downsample({ width, height, data }, factor) {
  const w = Math.floor(width / factor);
  const h = Math.floor(height / factor);
  const out = new Float32Array(w * h);
  for (let y = 0; y < h * factor; y += 1) {
    for (let x = 0; x < w * factor; x += 1) {
      out[Math.floor(y / factor) * w + Math.floor(x / factor)] += data[y * width + x];
    }
  }
  for (let i = 0; i < out.length; i += 1) out[i] /= factor * factor;
  return { width: w, height: h, data: out };
}

/** Zero-mean, unit-norm copy of the template values. */
function normalized(image) {
  const { data } = image;
  const mean = data.reduce((sum, v) => sum + v, 0) / data.length;
  const values = data.map((v) => v - mean);
  const norm = Math.sqrt(values.reduce((sum, v) => sum + v * v, 0));
  return { ...image, values: values.map((v) => v / norm) };
}

/**
 * Normalized cross-correlation of the template with the page, where template pixel (u, v)
 * maps to page point (x0 + (u + 0.5) * sx, y0 + (v + 0.5) * sy) in continuous coordinates.
 */
function correlation(template, sample, [x0, y0, sx, sy]) {
  const { width, height, values } = template;
  let sum = 0;
  let sumSquares = 0;
  let dot = 0;
  for (let v = 0; v < height; v += 1) {
    const y = y0 + (v + 0.5) * sy - 0.5;
    for (let u = 0; u < width; u += 1) {
      const p = sample(x0 + (u + 0.5) * sx - 0.5, y);
      sum += p;
      sumSquares += p * p;
      dot += values[v * width + u] * p;
    }
  }
  const variance = sumSquares - (sum * sum) / (width * height);
  return variance > 1e-6 ? dot / Math.sqrt(variance) : -1;
}

function coarseSearch(page, template) {
  const sample = sampler(page);
  let best = { score: -Infinity, params: [0, 0, 1, 1] };
  const minWidth = Math.round(MIN_TARGET_FRACTION * page.width);
  const maxWidth = Math.round(MAX_TARGET_FRACTION * page.width);
  for (let w = minWidth; w <= maxWidth; w += 1) {
    const s = w / template.width;
    const h = template.height * s;
    for (let y0 = -2; y0 <= page.height - h + 2; y0 += 1) {
      for (let x0 = -2; x0 <= page.width - w + 2; x0 += 1) {
        const params = [x0, y0, s, s];
        const score = correlation(template, sample, params);
        if (score > best.score) best = { score, params };
      }
    }
  }
  return best;
}

/** Pattern search: try +-step on every parameter, halve the steps when nothing improves. */
function refine(page, template, start) {
  const sample = sampler(page);
  let params = start;
  let score = correlation(template, sample, params);
  let steps = [2, 2, start[2] * 0.01, start[2] * 0.01];
  while (steps[0] > 0.01) {
    let improved = false;
    for (let i = 0; i < params.length; i += 1) {
      for (const direction of [1, -1]) {
        const candidate = [...params];
        candidate[i] += direction * steps[i];
        const candidateScore = correlation(template, sample, candidate);
        if (candidateScore > score) {
          score = candidateScore;
          params = candidate;
          improved = true;
        }
      }
    }
    if (!improved) steps = steps.map((step) => step / 2);
  }
  return { score, params };
}

/** The first `rows` rows of an image. */
function cropRows(image, rows) {
  return { width: image.width, height: rows, data: image.data.subarray(0, image.width * rows) };
}

/**
 * Locates a target texture (JPEG buffer) on a page scan (file path). Vuforia pads the textures
 * with black rows at the bottom to a multiple of 8; `aspect` (target height / width) gives the
 * rows that hold the image. Returns the score and the rectangle of the target on the page in
 * original page pixels: { left, top, width, height }, plus the vertical-to-horizontal scale
 * ratio of the fit (1 when the scan and the target have the same proportions).
 */
export function locateTarget(pagePath, textureJpeg, aspect) {
  const decoded = decodeGray(textureJpeg);
  const texture = cropRows(decoded, Math.floor(decoded.width * aspect));
  const pageSize = imageSize(pagePath);

  const coarsePage = decodeGray(pagePath, COARSE_PAGE_WIDTH);
  const coarse = coarseSearch(coarsePage, normalized(downsample(texture, COARSE_FACTOR)));

  // Refine on a page resampled so that the target spans about as many pixels as the texture.
  const fraction = (coarse.params[2] * texture.width) / COARSE_FACTOR / coarsePage.width;
  const fineWidth = Math.min(pageSize.width, Math.round(texture.width / fraction));
  const r = fineWidth / coarsePage.width;
  const [cx, cy, cs] = coarse.params;
  const fine = refine(decodeGray(pagePath, fineWidth), normalized(texture), [
    cx * r,
    cy * r,
    (cs * r) / COARSE_FACTOR,
    (cs * r) / COARSE_FACTOR,
  ]);

  const k = pageSize.width / fineWidth;
  const [x0, y0, sx, sy] = fine.params;
  return {
    score: fine.score,
    coarseScore: coarse.score,
    pageSize,
    rect: {
      left: x0 * k,
      top: y0 * k,
      width: texture.width * sx * k,
      height: texture.width * sx * k * aspect,
    },
    scaleRatio: sy / sx,
  };
}

/**
 * Where a Vuforia target (an entry of readVuforiaTargets) lies on a page scan, in page
 * millimetres, unrounded: `center` (origin at the page centre, X to the right, Y to the top of
 * the page) and `size`, plus the match (score, rectangle in scan pixels). Assumes the scan
 * covers the whole page width (see the page normalization in the plan).
 */
export function locateTargetOnPage(pagePath, target) {
  const match = locateTarget(pagePath, target.texture, target.size[1] / target.size[0]);
  const { rect, pageSize } = match;
  const mmPerPixel = PAGE_SIZE_MM.width / pageSize.width;
  return {
    ...match,
    center: [
      (rect.left + rect.width / 2 - pageSize.width / 2) * mmPerPixel,
      (pageSize.height / 2 - (rect.top + rect.height / 2)) * mmPerPixel,
    ],
    size: [rect.width * mmPerPixel, rect.height * mmPerPixel],
  };
}
