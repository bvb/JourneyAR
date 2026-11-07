/** Scale limits of a scene, relative to its initial size (scenes.json `pinch`). */
export interface ScaleLimits {
  min: number;
  max: number;
}

/**
 * Half the size of the area the scene may be moved within at its initial size, mm: the page.
 * The area grows with the scale, so any part of an enlarged scene can be brought to the middle.
 */
export interface MoveArea {
  halfWidth: number;
  halfHeight: number;
}

/**
 * Where the user has put a scene: its pinch scale (the factor applied to its pinch node) and its
 * offset on the page (page plane, mm; there is no height). Both are kept after a gesture and
 * across detections of the page, until reset().
 */
export class ScenePlacement {
  scale = 1;
  readonly offset: [number, number] = [0, 0];
  private scaleStart = 1;
  private scaling = false;

  constructor(
    private readonly limits: ScaleLimits,
    private readonly area: MoveArea,
  ) {}

  /** Back to the original size and place. */
  reset(): void {
    this.scale = 1;
    this.scaling = false;
    this.offset[0] = 0;
    this.offset[1] = 0;
  }

  scaleBegin(): void {
    this.scaling = true;
    this.scaleStart = this.scale;
  }

  /** `ratio`: current finger distance / distance at the start of the gesture. */
  scaleChange(ratio: number): void {
    if (!this.scaling) this.scaleBegin();
    if (!Number.isFinite(ratio) || ratio <= 0) return;
    this.scale = Math.min(Math.max(this.scaleStart * ratio, this.limits.min), this.limits.max);
    this.clampOffset();
  }

  scaleEnd(): void {
    this.scaling = false;
  }

  /** Moves the scene on the page by (dx, dy) mm. */
  moveBy(dx: number, dy: number): void {
    if (!Number.isFinite(dx) || !Number.isFinite(dy)) return;
    this.offset[0] += dx;
    this.offset[1] += dy;
    this.clampOffset();
  }

  private clampOffset(): void {
    const grow = Math.max(1, this.scale);
    const x = this.area.halfWidth * grow;
    const y = this.area.halfHeight * grow;
    this.offset[0] = Math.min(Math.max(this.offset[0], -x), x);
    this.offset[1] = Math.min(Math.max(this.offset[1], -y), y);
  }
}
