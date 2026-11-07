/**
 * A page found again this soon after it was lost continues where it stopped (its sound and its
 * animations) instead of starting over, seconds.
 */
export const RESUME_SECONDS = 3;

/**
 * Remembers the last page lost and when, to tell whether the page found next comes back soon
 * enough to continue. Another page found in between ends the chance.
 */
export class ResumeWindow {
  private lost: { id: string; time: number } | null = null;

  constructor(private readonly seconds = RESUME_SECONDS) {}

  /** The page `id` was lost at `time` (ms, performance.now()). */
  lose(id: string, time = performance.now()): void {
    this.lost = { id, time };
  }

  /** Whether the page `id`, found at `time`, continues. */
  resumes(id: string, time = performance.now()): boolean {
    return this.lost?.id === id && time - this.lost.time <= this.seconds * 1000;
  }
}
