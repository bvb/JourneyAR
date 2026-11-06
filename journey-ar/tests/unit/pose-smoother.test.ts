import { Euler, Matrix4, Quaternion, Vector3 } from 'three';
import { describe, expect, it } from 'vitest';
import { DEFAULT_SMOOTHING, PoseSmoother, parseSmoothing } from '../../src/tracking/pose-smoother';

/** Deterministic Gaussian-ish noise (sum of uniforms, sigma ~ 1). */
function noise(seed: number) {
  let s = seed;
  return () => {
    let sum = 0;
    for (let i = 0; i < 3; i += 1) {
      s = (s * 16807) % 2147483647;
      sum += s / 2147483647;
    }
    return (sum - 1.5) * 2;
  };
}

function pose(position: Vector3, rotation = new Quaternion()): number[] {
  return new Matrix4().compose(position, rotation, new Vector3(1, 1, 1)).toArray();
}

function decompose(m: Matrix4) {
  const p = new Vector3();
  const q = new Quaternion();
  m.decompose(p, q, new Vector3());
  return { p, q };
}

/** Runs tracker poses at 20 Hz and display frames at 60 Hz; returns the shown poses. */
function run(smoother: PoseSmoother, seconds: number, at: (t: number) => number[]) {
  const shown: { t: number; m: Matrix4 }[] = [];
  for (let frame = 0; frame < seconds * 60; frame += 1) {
    const t = frame / 60;
    if (frame % 3 === 0) smoother.addPose(at(t), t * 1000);
    shown.push({ t, m: smoother.frame(1 / 60, new Matrix4()) });
  }
  return shown;
}

describe('PoseSmoother', () => {
  it('takes the first pose as it is', () => {
    const smoother = new PoseSmoother();
    smoother.addPose(pose(new Vector3(10, 20, -300)), 0);
    expect(decompose(smoother.frame(1 / 60, new Matrix4())).p.toArray()).toEqual([10, 20, -300]);
  });

  it('reduces the jitter of a steady camera at least threefold', () => {
    const rnd = noise(3);
    const raw: number[] = [];
    const smoother = new PoseSmoother();
    const shown = run(smoother, 6, () => {
      const x = rnd(); // 1 mm jitter
      raw.push(x);
      return pose(
        new Vector3(x, rnd(), -350 + rnd()),
        new Quaternion().setFromEuler(new Euler(rnd() * 0.01, rnd() * 0.01, 0)),
      );
    });
    const xs = shown.slice(120).map(({ m }) => decompose(m).p.x);
    const sd = (values: number[]) => {
      const mean = values.reduce((a, b) => a + b, 0) / values.length;
      return Math.sqrt(values.reduce((a, b) => a + (b - mean) ** 2, 0) / values.length);
    };
    expect(sd(xs)).toBeLessThan(sd(raw) / 3);
  });

  it('follows a steady movement with a small lag', () => {
    const smoother = new PoseSmoother();
    // The page moves at 100 mm/s across the view.
    const shown = run(smoother, 3, (t) => pose(new Vector3(100 * t, 0, -350)));
    const last = shown.at(-1)!;
    const lagMm = 100 * last.t - decompose(last.m).p.x;
    expect(lagMm).toBeGreaterThan(0);
    expect(lagMm).toBeLessThan(15);
  });

  it('starts over after reset (a page found again)', () => {
    const smoother = new PoseSmoother();
    run(smoother, 1, () => pose(new Vector3(0, 0, -300)));
    smoother.reset();
    smoother.addPose(pose(new Vector3(50, 0, -200)), 5000);
    expect(decompose(smoother.frame(1 / 60, new Matrix4())).p.toArray()).toEqual([50, 0, -200]);
  });

  it('passes poses through when smoothing is off', () => {
    const smoother = new PoseSmoother(null);
    smoother.addPose(pose(new Vector3(0, 0, -300)), 0);
    smoother.addPose(pose(new Vector3(40, 0, -300)), 50);
    expect(decompose(smoother.frame(1 / 60, new Matrix4())).p.x).toBe(40);
  });
});

describe('parseSmoothing', () => {
  it('reads the defaults, off and overrides', () => {
    expect(parseSmoothing(null)).toEqual(DEFAULT_SMOOTHING);
    expect(parseSmoothing('off')).toBeNull();
    expect(parseSmoothing('0.5,0.01')).toEqual({
      ...DEFAULT_SMOOTHING,
      minCutoff: 0.5,
      beta: 0.01,
    });
  });
});
