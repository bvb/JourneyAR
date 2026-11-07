export interface StartButtonState {
  /** Started (the camera is starting or running). */
  running: boolean;
  /** Waiting for the camera: the button cannot be pressed meanwhile. */
  starting: boolean;
  /** Something is still loading after Start (camera, markers, scenes, sounds). */
  loading: boolean;
  /** Something went wrong since the last Start (the details go to the console). */
  error: boolean;
}

/**
 * The only control: a round black button with a white rim and the app's traveller. Started,
 * the picture inverts and the rim grows thicker; while loading, a light runs round the rim; an
 * error turns the rim red.
 */
export class StartButton {
  constructor(readonly element: HTMLButtonElement) {}

  render({ running, starting, loading, error }: StartButtonState): void {
    const busy = running && loading;
    this.element.classList.toggle('on', running);
    this.element.classList.toggle('loading', busy);
    this.element.classList.toggle('error', error);
    this.element.setAttribute('aria-label', running ? 'Стоп' : 'Старт');
    this.element.setAttribute('aria-busy', String(busy));
    this.element.disabled = starting;
  }
}
