// Vectorizes a small raster shape: contours of a value map (0..1) at a threshold, smoothed and
// simplified, as SVG path data. Used for the app logo (tools/assets/icons.mjs).

/**
 * Upsamples a value map `factor` times with bicubic (Catmull-Rom) interpolation, then blurs it
 * with a Gaussian of `sigma` source pixels: stair-stepped edges of a pixel image become smooth
 * curves at the threshold, while lines a pixel wide stay apart.
 */
export function smoothUpsample(values, width, height, factor, sigma) {
  const w = width * factor;
  const h = height * factor;
  const at = (x, y) =>
    values[Math.min(Math.max(y, 0), height - 1) * width + Math.min(Math.max(x, 0), width - 1)];
  const cubic = (p0, p1, p2, p3, t) =>
    p1 + 0.5 * t * (p2 - p0 + t * (2 * p0 - 5 * p1 + 4 * p2 - p3 + t * (3 * (p1 - p2) + p3 - p0)));
  const up = new Float32Array(w * h);
  for (let y = 0; y < h; y += 1) {
    const sy = (y + 0.5) / factor - 0.5;
    const y0 = Math.floor(sy);
    const ty = sy - y0;
    for (let x = 0; x < w; x += 1) {
      const sx = (x + 0.5) / factor - 0.5;
      const x0 = Math.floor(sx);
      const tx = sx - x0;
      const row = (yy) => cubic(at(x0 - 1, yy), at(x0, yy), at(x0 + 1, yy), at(x0 + 2, yy), tx);
      up[y * w + x] = cubic(row(y0 - 1), row(y0), row(y0 + 1), row(y0 + 2), ty);
    }
  }
  return { values: blur(up, w, h, sigma * factor), width: w, height: h };
}

function blur(values, width, height, sigma) {
  const radius = Math.ceil(sigma * 3);
  const kernel = Array.from({ length: 2 * radius + 1 }, (_, i) =>
    Math.exp(-((i - radius) ** 2) / (2 * sigma * sigma)),
  );
  const sum = kernel.reduce((a, b) => a + b, 0);
  const k = kernel.map((v) => v / sum);
  const pass = (src, horizontal) => {
    const out = new Float32Array(width * height);
    for (let y = 0; y < height; y += 1) {
      for (let x = 0; x < width; x += 1) {
        let acc = 0;
        for (let i = -radius; i <= radius; i += 1) {
          const xx = horizontal ? Math.min(Math.max(x + i, 0), width - 1) : x;
          const yy = horizontal ? y : Math.min(Math.max(y + i, 0), height - 1);
          acc += src[yy * width + xx] * k[i + radius];
        }
        out[y * width + x] = acc;
      }
    }
    return out;
  };
  return pass(pass(values, true), false);
}

/**
 * Closed contours where the map crosses `threshold` (marching squares with linear
 * interpolation; outside the map counts as 0). Returns loops of [x, y] points, in pixel units
 * of the map with pixel centres at integer coordinates.
 */
export function contours(values, width, height, threshold) {
  const v = (x, y) => (x < 0 || y < 0 || x >= width || y >= height ? 0 : values[y * width + x]);
  // Edge points: horizontal edge (x,y)-(x+1,y) is "h:x:y", vertical (x,y)-(x,y+1) is "v:x:y".
  const points = new Map();
  const point = (key) => {
    let p = points.get(key);
    if (!p) {
      const [kind, xs, ys] = key.split(':');
      const x = Number(xs);
      const y = Number(ys);
      const a = v(x, y);
      const b = kind === 'h' ? v(x + 1, y) : v(x, y + 1);
      const t = (threshold - a) / (b - a);
      p = kind === 'h' ? [x + t, y] : [x, y + t];
      points.set(key, p);
    }
    return p;
  };
  const links = new Map();
  const link = (a, b) => {
    for (const [from, to] of [
      [a, b],
      [b, a],
    ]) {
      const list = links.get(from) ?? [];
      list.push(to);
      links.set(from, list);
    }
  };
  for (let y = -1; y < height; y += 1) {
    for (let x = -1; x < width; x += 1) {
      const tl = v(x, y) > threshold;
      const tr = v(x + 1, y) > threshold;
      const br = v(x + 1, y + 1) > threshold;
      const bl = v(x, y + 1) > threshold;
      const top = `h:${x}:${y}`;
      const bottom = `h:${x}:${y + 1}`;
      const left = `v:${x}:${y}`;
      const right = `v:${x + 1}:${y}`;
      const centre = (v(x, y) + v(x + 1, y) + v(x + 1, y + 1) + v(x, y + 1)) / 4 > threshold;
      switch ((tl ? 8 : 0) | (tr ? 4 : 0) | (br ? 2 : 0) | (bl ? 1 : 0)) {
        case 1:
        case 14:
          link(left, bottom);
          break;
        case 2:
        case 13:
          link(bottom, right);
          break;
        case 3:
        case 12:
          link(left, right);
          break;
        case 4:
        case 11:
          link(top, right);
          break;
        case 6:
        case 9:
          link(top, bottom);
          break;
        case 7:
        case 8:
          link(left, top);
          break;
        case 5:
          if (centre) {
            link(left, top);
            link(bottom, right);
          } else {
            link(top, right);
            link(left, bottom);
          }
          break;
        case 10:
          if (centre) {
            link(top, right);
            link(left, bottom);
          } else {
            link(left, top);
            link(bottom, right);
          }
          break;
        default:
          break;
      }
    }
  }
  const loops = [];
  const visited = new Set();
  for (const start of links.keys()) {
    if (visited.has(start)) continue;
    const loop = [];
    let previous = null;
    let current = start;
    while (current && !visited.has(current)) {
      visited.add(current);
      loop.push(point(current));
      const next = links.get(current).find((k) => k !== previous && !visited.has(k));
      previous = current;
      current = next;
    }
    if (loop.length >= 3) loops.push(loop);
  }
  return loops;
}

/** Ramer-Douglas-Peucker simplification of a closed loop, within `epsilon`. */
export function simplify(loop, epsilon) {
  if (loop.length < 4) return loop;
  const distance = ([px, py], [ax, ay], [bx, by]) => {
    const dx = bx - ax;
    const dy = by - ay;
    const length = Math.hypot(dx, dy);
    if (length === 0) return Math.hypot(px - ax, py - ay);
    return Math.abs(dy * px - dx * py + bx * ay - by * ax) / length;
  };
  // Split the loop at its first point and the point farthest from it, simplify both halves.
  let far = 0;
  let farDistance = 0;
  for (let i = 1; i < loop.length; i += 1) {
    const d = Math.hypot(loop[i][0] - loop[0][0], loop[i][1] - loop[0][1]);
    if (d > farDistance) {
      farDistance = d;
      far = i;
    }
  }
  const closed = [...loop, loop[0]];
  const keep = new Uint8Array(closed.length);
  keep[0] = 1;
  keep[far] = 1;
  const run = (first, last) => {
    let worst = 0;
    let index = -1;
    for (let i = first + 1; i < last; i += 1) {
      const d = distance(closed[i], closed[first], closed[last]);
      if (d > worst) {
        worst = d;
        index = i;
      }
    }
    if (worst > epsilon) {
      keep[index] = 1;
      run(first, index);
      run(index, last);
    }
  };
  run(0, far);
  run(far, closed.length - 1);
  return loop.filter((_, i) => keep[i]);
}

/** Signed area of a loop (shoelace). */
export function area(loop) {
  let sum = 0;
  for (let i = 0; i < loop.length; i += 1) {
    const [x1, y1] = loop[i];
    const [x2, y2] = loop[(i + 1) % loop.length];
    sum += x1 * y2 - x2 * y1;
  }
  return sum / 2;
}

/** SVG path data of the loops (fill-rule evenodd for the holes). */
export function pathData(loops, digits = 2) {
  const f = (n) => Number(n.toFixed(digits)).toString();
  return loops.map((loop) => `M${loop.map(([x, y]) => `${f(x)} ${f(y)}`).join('L')}Z`).join('');
}
