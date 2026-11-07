/** While no page is tracked (after the grace below), the tracker searches this often, ms. */
export const SEARCH_INTERVAL_MS = 200;
/**
 * After a page is lost (or the tracker starts) it searches on every frame for this long, ms:
 * a page just lost usually comes back at once (a shaky hand, a finger over it).
 */
export const FULL_RATE_SEARCH_MS = 1000;

/**
 * Paces the tracker's work. Tracking a page is cheap and runs on every frame; searching for a
 * page (the detector, over all the markers) is the costliest part, so while no page is in view
 * it runs SEARCH_INTERVAL_MS apart, except for FULL_RATE_SEARCH_MS after a loss.
 */
export class SearchPacer {
  private tracking = false;
  private lastTracked = -Infinity;
  private lastSearch = -Infinity;

  constructor(
    private readonly interval = SEARCH_INTERVAL_MS,
    private readonly fullRate = FULL_RATE_SEARCH_MS,
  ) {}

  /** Starts over at `now`: full rate first. */
  reset(now: number): void {
    this.tracking = false;
    this.lastTracked = now;
    this.lastSearch = -Infinity;
  }

  /** Whether the frame at `now` (ms) should go to the tracker. */
  shouldProcess(now: number): boolean {
    if (this.tracking || now - this.lastTracked < this.fullRate) return true;
    return now - this.lastSearch >= this.interval;
  }

  /** The tracker processed the frame of `now`; `tracked`: it tracks a page. */
  processed(now: number, tracked: boolean): void {
    if (tracked) this.lastTracked = now;
    this.tracking = tracked;
    this.lastSearch = now;
  }
}
