// Animation curves of the APK's legacy clips, evaluated and sampled the way the former Unity
// export (UnityGLTF 2.24, BakePropertyAnimation) did.

/** A number of a serialized curve: read-apk.py writes infinite slopes as "inf" / "-inf". */
export const curveNumber = (v) =>
  typeof v === 'string' ? Number(v.replace('inf', 'Infinity')) : v;

/**
 * Unity AnimationCurve value at time t: cubic Hermite between keys (their out/in slopes),
 * a step when a slope is infinite, the first/last value outside the keys. `component` picks
 * x/y/z/w of vector keys; null for plain numbers.
 */
export function evaluateCurve(keys, t, component = null) {
  const value = (k) => (component === null ? k.value : k.value[component]);
  const slope = (k, which) => curveNumber(component === null ? k[which] : k[which][component]);
  if (t <= keys[0].time) return value(keys[0]);
  const last = keys[keys.length - 1];
  if (t >= last.time) return value(last);
  let i = 0;
  while (keys[i + 1].time < t) i += 1;
  const [a, b] = [keys[i], keys[i + 1]];
  const out = slope(a, 'outSlope');
  const into = slope(b, 'inSlope');
  if (!Number.isFinite(out) || !Number.isFinite(into)) return value(a);
  const dt = b.time - a.time;
  const s = (t - a.time) / dt;
  const s2 = s * s;
  const s3 = s2 * s;
  return (
    (2 * s3 - 3 * s2 + 1) * value(a) +
    (s3 - 2 * s2 + s) * dt * out +
    (-2 * s3 + 3 * s2) * value(b) +
    (s3 - s2) * dt * into
  );
}

/** Sample times of a clip: ceil(length * fps) equal steps, the last one exactly at the end. */
export function sampleTimes(length, fps) {
  const samples = Math.max(1, Math.ceil(Math.fround(length * fps)));
  const delta = Math.fround(length / samples);
  const last = length > 0 ? samples : 0;
  const times = [];
  for (let i = 0; i <= last; i += 1) times.push(Math.fround(i === last ? length : i * delta));
  return times;
}

/**
 * Drops the samples equal to both neighbours and to the last kept one (exact 32-bit float
 * equality); the first and the last stay. `values` holds one array per time.
 */
export function dropUnneededKeys(times, values) {
  const same = (a, b) => a.every((x, k) => Math.fround(x) === Math.fround(b[k]));
  const keptTimes = [times[0]];
  const kept = [values[0]];
  let lastKept = 0;
  for (let i = 1; i < times.length - 1; i += 1) {
    const identical =
      (lastKept >= i - 1 || same(values[lastKept], values[i])) &&
      same(values[i - 1], values[i]) &&
      same(values[i], values[i + 1]);
    if (!identical) {
      lastKept = i;
      keptTimes.push(times[i]);
      kept.push(values[i]);
    }
  }
  if (times.length > 1) {
    keptTimes.push(times[times.length - 1]);
    kept.push(values[values.length - 1]);
  }
  return { times: keptTimes, values: kept };
}
