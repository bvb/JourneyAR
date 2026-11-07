/** Scale limits of a scene, relative to its initial size (scenes.json `pinch`). */
export interface PinchLimits {
  min: number;
  max: number;
  /** Return to the initial size when the gesture ends (the original PinchScale's SnapBack). */
  snapBack: boolean;
}

/** Duration of the return to the initial size, seconds. */
export const SNAP_BACK_SECONDS = 0.35;

/**
 * Pinch-to-scale state of a scene: the factor applied to its pinch node. A gesture scales the
 * factor it started from by the ratio of the finger distances, within the limits; with
 * snapBack the factor eases back to 1 after the gesture.
 */
export class PinchScale {
  factor = 1;
  private start = 1;
  private active = false;
  private snapFrom: number | null = null;
  private snapElapsed = 0;

  constructor(private readonly limits: PinchLimits) {}

  /** Back to the initial size at once (every new detection of the page). */
  reset(): void {
    this.factor = 1;
    this.active = false;
    this.snapFrom = null;
  }

  begin(): void {
    this.active = true;
    this.snapFrom = null;
    this.start = this.factor;
  }

  /** `ratio`: current finger distance / distance at the start of the gesture. */
  change(ratio: number): void {
    if (!this.active) this.begin();
    if (!Number.isFinite(ratio) || ratio <= 0) return;
    this.factor = Math.min(Math.max(this.start * ratio, this.limits.min), this.limits.max);
  }

  end(): void {
    if (!this.active) return;
    this.active = false;
    if (this.limits.snapBack && this.factor !== 1) {
      this.snapFrom = this.factor;
      this.snapElapsed = 0;
    }
  }

  /** Advances the snap-back; returns whether the factor changed. */
  tick(deltaSeconds: number): boolean {
    if (this.snapFrom === null) return false;
    this.snapElapsed += deltaSeconds;
    const k = Math.min(this.snapElapsed / SNAP_BACK_SECONDS, 1);
    const eased = 1 - (1 - k) ** 3;
    this.factor = this.snapFrom + (1 - this.snapFrom) * eased;
    if (k >= 1) {
      this.factor = 1;
      this.snapFrom = null;
    }
    return true;
  }
}
