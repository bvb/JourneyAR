/**
 * Loop points of a decoded track: MP3 adds encoder delay at the start and padding at the end
 * (these files carry no LAME header to say how much), which plays as a gap at every loop.
 * The bounds skip what is quieter than `threshold` at both ends, at most `maxTrim` seconds each.
 */
export function loopBounds(
  channels: readonly Float32Array[],
  sampleRate: number,
  threshold = 1e-4,
  maxTrim = 1,
): { start: number; end: number } {
  const length = channels[0]?.length ?? 0;
  const loud = (i: number) => channels.some((channel) => Math.abs(channel[i]!) > threshold);
  const limit = Math.min(Math.round(maxTrim * sampleRate), Math.floor(length / 2));
  let first = 0;
  while (first < limit && !loud(first)) first += 1;
  let last = length - 1;
  while (length - 1 - last < limit && last > first && !loud(last)) last -= 1;
  return { start: first / sampleRate, end: (last + 1) / sampleRate };
}

/** Spatial settings of the scene sound (Web Audio PannerNode, inverse distance model). */
export const SPATIAL = {
  /** Distance with the full volume, metres (a book held at reading distance). */
  refDistance: 0.3,
  /** How fast the volume falls with distance: 0.6 halves it at about 0.8 m. */
  rolloffFactor: 0.6,
  maxDistance: 10,
  /** Time constant of position (and therefore volume and panning) changes, seconds. */
  smoothing: 0.1,
  /** Fade in when the page is found and fade out when it is lost, seconds. */
  fade: 0.08,
  /** Height of the sound source above the scene's centre on the page, mm. */
  height: 40,
};

/** Gain of the inverse distance model at `distance` metres (what PannerNode applies). */
export function distanceGain(distance: number, settings = SPATIAL): number {
  const d = Math.min(Math.max(distance, settings.refDistance), settings.maxDistance);
  return (
    settings.refDistance /
    (settings.refDistance + settings.rolloffFactor * (d - settings.refDistance))
  );
}

/** A page found again this soon after it was lost continues its track where it stopped, s. */
export const RESUME_SECONDS = 3;

/**
 * Position in a track, seconds, `elapsed` seconds after it started playing at `from`. A looping
 * track wraps from `loop.end` to `loop.start` (as AudioBufferSourceNode does); one that does not
 * loop stops at `duration`.
 */
export function trackPosition(
  from: number,
  elapsed: number,
  loop: { start: number; end: number },
  looping: boolean,
  duration: number,
): number {
  const position = from + Math.max(elapsed, 0);
  if (!looping) return Math.min(position, duration);
  if (position < loop.end) return position;
  const length = loop.end - loop.start;
  return length > 0 ? loop.start + ((position - loop.start) % length) : loop.start;
}
