/** A page the tracker reports found in a frame, with its tracking error (lower is better). */
export interface Candidate {
  scene: string;
  error: number | null;
}

export interface Selection {
  /** The page shown: one page at a time. */
  candidate: Candidate | null;
  transitions: { type: 'found' | 'lost'; scene: string }[];
  /**
   * Whether the tracker should also look for the other pages: the shown page tracks with a
   * high error, so it may be a wrong page held on to (see PageSelector).
   */
  verify: boolean;
}

export interface SelectorOptions {
  /** Tracking error above which a page is suspicious (good tracking: 0.1-0.9). */
  maxError: number;
  /** Suspicious frames in a row before the other pages are searched for. */
  suspiciousFrames: number;
  /** Good frames in a row before the search stops. */
  calmFrames: number;
}

export const SELECTOR_DEFAULTS: SelectorOptions = {
  maxError: 1.2,
  suspiciousFrames: 5,
  calmFrames: 30,
};

/**
 * Chooses the page to show from the tracker results. One page is active at a time and keeps
 * the lead while it is tracked. While a page is tracked the tracker normally searches for no
 * other (cheaper on phones), but a page held with a high tracking error may be the wrong one:
 * a page swapped under a still camera can be taken for the previous page. Then `verify` asks
 * for the search, and a different page found meanwhile takes over.
 */
export class PageSelector {
  private active: string | null = null;
  private suspicious = 0;
  private calm = 0;
  private verifying = false;

  constructor(private readonly options: SelectorOptions = SELECTOR_DEFAULTS) {}

  select(candidates: readonly Candidate[]): Selection {
    const current = candidates.find((c) => c.scene === this.active);
    const other = candidates.find((c) => c.scene !== this.active);
    const pick = current && other && this.verifying ? other : (current ?? other ?? null);

    const transitions: Selection['transitions'] = [];
    const scene = pick?.scene ?? null;
    if (scene !== this.active) {
      if (this.active) transitions.push({ type: 'lost', scene: this.active });
      if (scene) transitions.push({ type: 'found', scene });
      this.active = scene;
      this.suspicious = 0;
      this.calm = 0;
      this.verifying = false;
    }

    if (pick) {
      if ((pick.error ?? 0) > this.options.maxError) {
        this.suspicious += 1;
        this.calm = 0;
      } else {
        this.suspicious = 0;
        this.calm += 1;
      }
      if (!this.verifying && this.suspicious >= this.options.suspiciousFrames)
        this.verifying = true;
      if (this.verifying && this.calm >= this.options.calmFrames) this.verifying = false;
    }
    return { candidate: pick, transitions, verify: this.verifying };
  }
}
