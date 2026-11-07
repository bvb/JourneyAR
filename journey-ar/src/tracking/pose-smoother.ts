import { Matrix4, Quaternion, Vector3 } from 'three';

/**
 * Settings of the pose smoothing. One Euro filter (Casiez et al., 2012): the cutoff frequency
 * grows with the speed, so small jitter of a steady camera is smoothed strongly and real
 * movement is followed with little lag.
 */
export interface SmoothingSettings {
  /** Cutoff at rest, Hz: lower = smoother and slower. */
  minCutoff: number;
  /** Cutoff increase per mm/s of movement of the page origin. */
  beta: number;
  /** Cutoff increase per rad/s of rotation. */
  rotationBeta: number;
  /** Cutoff of the speed estimate, Hz. */
  speedCutoff: number;
  /** Time constant of the easing towards the filtered pose on every display frame, s. */
  easing: number;
}

export const DEFAULT_SMOOTHING: SmoothingSettings = {
  minCutoff: 0.2,
  beta: 0.02,
  rotationBeta: 1,
  speedCutoff: 1,
  easing: 0.04,
};

function alpha(cutoff: number, dt: number): number {
  const tau = 1 / (2 * Math.PI * cutoff);
  return 1 / (1 + tau / dt);
}

/** Rotation vector (axis * angle, rad) that turns `from` into `to`. */
function rotationVector(from: Quaternion, to: Quaternion): Vector3 {
  const delta = from.clone().invert().multiply(to);
  if (delta.w < 0) delta.set(-delta.x, -delta.y, -delta.z, -delta.w);
  const angle = 2 * Math.acos(Math.min(1, delta.w));
  const sin = Math.sqrt(Math.max(0, 1 - delta.w * delta.w));
  const axis =
    sin < 1e-6
      ? new Vector3(delta.x, delta.y, delta.z).multiplyScalar(2)
      : new Vector3(delta.x, delta.y, delta.z).divideScalar(sin).multiplyScalar(angle);
  return axis;
}

/**
 * Smooths the tracker pose (page -> camera). Tracker results go through a One Euro filter on
 * the position and the rotation; every display frame then eases towards the filtered pose, so
 * the content moves continuously although the tracker updates less often than the screen.
 */
export class PoseSmoother {
  private readonly position = new Vector3();
  private readonly rotation = new Quaternion();
  private readonly shownPosition = new Vector3();
  private readonly shownRotation = new Quaternion();
  private readonly scale = new Vector3();
  // Low-passed velocity (mm/s) and angular velocity (rotation vector, rad/s). Signed vectors:
  // jitter averages out in them, so only real movement raises the cutoff.
  private readonly velocity = new Vector3();
  private readonly angularVelocity = new Vector3();
  private lastTime: number | null = null;
  private readonly sample = { position: new Vector3(), rotation: new Quaternion() };

  constructor(private readonly settings: SmoothingSettings | null = DEFAULT_SMOOTHING) {}

  /** Forgets the history: the next pose is taken as it is (a page found again). */
  reset(): void {
    this.lastTime = null;
  }

  /** Adds a tracker pose taken at `timeMs`. */
  addPose(pose: ArrayLike<number>, timeMs: number): void {
    const { position, rotation } = this.sample;
    new Matrix4().fromArray(pose).decompose(position, rotation, this.scale);
    const settings = this.settings;
    if (this.lastTime === null || !settings) {
      this.position.copy(position);
      this.rotation.copy(rotation);
      this.shownPosition.copy(position);
      this.shownRotation.copy(rotation);
      this.velocity.set(0, 0, 0);
      this.angularVelocity.set(0, 0, 0);
      this.lastTime = timeMs;
      return;
    }
    const dt = Math.max((timeMs - this.lastTime) / 1000, 1e-3);
    this.lastTime = timeMs;

    const speedAlpha = alpha(settings.speedCutoff, dt);
    const velocity = position.clone().sub(this.position).divideScalar(dt);
    this.velocity.lerp(velocity, speedAlpha);
    const cutoff = settings.minCutoff + settings.beta * this.velocity.length();
    this.position.lerp(position, alpha(cutoff, dt));

    const angularVelocity = rotationVector(this.rotation, rotation).divideScalar(dt);
    this.angularVelocity.lerp(angularVelocity, speedAlpha);
    const rotationCutoff =
      settings.minCutoff + settings.rotationBeta * this.angularVelocity.length();
    this.rotation.slerp(rotation, alpha(rotationCutoff, dt));
  }

  /** The pose to show in a display frame `deltaSeconds` after the previous one. */
  frame(deltaSeconds: number, target: Matrix4): Matrix4 {
    const settings = this.settings;
    if (!settings || settings.easing <= 0) {
      this.shownPosition.copy(this.position);
      this.shownRotation.copy(this.rotation);
    } else {
      const k = 1 - Math.exp(-Math.max(deltaSeconds, 0) / settings.easing);
      this.shownPosition.lerp(this.position, k);
      this.shownRotation.slerp(this.rotation, k);
    }
    return target.compose(this.shownPosition, this.shownRotation, this.scale.set(1, 1, 1));
  }
}

/**
 * `?smooth=off` turns smoothing off; `?smooth=<minCutoff>,<beta>,<rotationBeta>,<easing>`
 * overrides the defaults (missing values keep them).
 */
export function parseSmoothing(value: string | null): SmoothingSettings | null {
  if (value === null || value === '') return DEFAULT_SMOOTHING;
  if (value === 'off' || value === '0') return null;
  const [minCutoff, beta, rotationBeta, easing] = value.split(',').map(Number);
  const pick = (v: number | undefined, fallback: number) =>
    v !== undefined && Number.isFinite(v) && v >= 0 ? v : fallback;
  return {
    ...DEFAULT_SMOOTHING,
    minCutoff: pick(minCutoff, DEFAULT_SMOOTHING.minCutoff) || DEFAULT_SMOOTHING.minCutoff,
    beta: pick(beta, DEFAULT_SMOOTHING.beta),
    rotationBeta: pick(rotationBeta, DEFAULT_SMOOTHING.rotationBeta),
    easing: pick(easing, DEFAULT_SMOOTHING.easing),
  };
}
