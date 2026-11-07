export interface StartButtonState {
  /** Started (the camera is starting or running). */
  running: boolean;
  /** Waiting for the camera: the button cannot be pressed meanwhile. */
  starting: boolean;
  /** Something is still loading after Start (camera, markers, scenes, sounds). */
  loading: boolean;
  /** Loaded part, 0..1. */
  progress: number;
}

/**
 * The only control: a round black button with a white rim and the app's traveller. Started,
 * the picture inverts and the rim grows thicker; while loading, the rim shows the progress (a
 * filling arc over a faint track, with a light running round it).
 */
export class StartButton {
  private readonly arc: SVGCircleElement;

  constructor(readonly element: HTMLButtonElement) {
    const arc = element.querySelector<SVGCircleElement>('.arc');
    if (!arc) throw new Error('Start button: no .arc');
    this.arc = arc;
  }

  render({ running, starting, loading, progress }: StartButtonState): void {
    const busy = running && loading;
    this.element.classList.toggle('on', running);
    this.element.classList.toggle('loading', busy);
    this.element.setAttribute('aria-label', running ? 'Стоп' : 'Старт');
    this.element.setAttribute('aria-busy', String(busy));
    this.element.disabled = starting;
    // The arc's path length is 100 (pathLength), so the offset is the part not yet loaded.
    const shown = busy ? Math.min(Math.max(progress, 0), 1) : 1;
    this.arc.style.strokeDashoffset = String(100 * (1 - shown));
  }
}
