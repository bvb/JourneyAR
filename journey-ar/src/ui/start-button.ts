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

/** Started and everything loaded: the button folds into a bar this much later. */
export const COLLAPSE_WHEN_READY_MS = 800;
/** Unfolded from the bar and not pressed: it folds again this much later. */
export const COLLAPSE_AFTER_EXPAND_MS = 3000;
/** An upward swipe on the bar this long unfolds it. */
const SWIPE_PX = 16;
/** Clicks this soon after unfolding (the end of the swipe, a double tap) do not stop. */
const IGNORE_CLICKS_MS = 400;

const IDLE: StartButtonState = { running: false, starting: false, loading: false, error: false };

/**
 * The only control: a round black button with a white rim and the app's traveller. Started,
 * the picture inverts and the rim grows thicker; while loading, a light runs round the rim; an
 * error turns the rim red. Once started and loaded, it folds into a small translucent bar out of
 * the way; a tap or an upward swipe on the bar unfolds it, and without a press it folds again
 * after COLLAPSE_AFTER_EXPAND_MS. `onPress` is called (synchronously, within the user gesture)
 * when the unfolded button is pressed.
 */
export class StartButton {
  private state = IDLE;
  private folded = false;
  private timer: number | undefined;
  private swipeFrom: number | null = null;
  private ignoreClicksUntil = 0;

  constructor(
    readonly element: HTMLButtonElement,
    private readonly onPress: () => void,
  ) {
    element.addEventListener('click', this.onClick);
    element.addEventListener('pointerdown', this.onPointerDown);
    element.addEventListener('pointermove', this.onPointerMove);
    element.addEventListener('pointerup', this.onPointerEnd);
    element.addEventListener('pointercancel', this.onPointerEnd);
    this.paint();
  }

  /** Folded into the bar. */
  get collapsed(): boolean {
    return this.folded;
  }

  render(state: StartButtonState): void {
    const wasReady = this.ready;
    this.state = state;
    if (!this.ready) {
      this.clearTimer();
      this.folded = false;
    } else if (!wasReady) {
      this.foldIn(COLLAPSE_WHEN_READY_MS);
    }
    this.paint();
  }

  private get ready(): boolean {
    const { running, starting, loading } = this.state;
    return running && !starting && !loading;
  }

  private readonly onClick = (): void => {
    if (this.folded) {
      this.expand();
      return;
    }
    if (performance.now() < this.ignoreClicksUntil) return;
    this.onPress();
  };

  private readonly onPointerDown = (event: PointerEvent): void => {
    if (!this.folded) return;
    this.swipeFrom = event.clientY;
    try {
      this.element.setPointerCapture(event.pointerId);
    } catch {
      // Capture only keeps the swipe when the finger leaves the bar.
    }
  };

  private readonly onPointerMove = (event: PointerEvent): void => {
    if (this.swipeFrom === null || this.swipeFrom - event.clientY < SWIPE_PX) return;
    this.swipeFrom = null;
    this.expand();
  };

  private readonly onPointerEnd = (): void => {
    this.swipeFrom = null;
  };

  private expand(): void {
    this.folded = false;
    this.ignoreClicksUntil = performance.now() + IGNORE_CLICKS_MS;
    this.foldIn(COLLAPSE_AFTER_EXPAND_MS);
    this.paint();
  }

  private foldIn(delayMs: number): void {
    this.clearTimer();
    this.timer = window.setTimeout(() => {
      this.timer = undefined;
      if (!this.ready) return;
      this.folded = true;
      this.paint();
    }, delayMs);
  }

  private clearTimer(): void {
    window.clearTimeout(this.timer);
    this.timer = undefined;
  }

  private paint(): void {
    const { running, starting, loading, error } = this.state;
    const busy = running && loading;
    const { classList } = this.element;
    classList.toggle('on', running);
    classList.toggle('loading', busy);
    classList.toggle('error', error);
    classList.toggle('collapsed', this.folded);
    this.element.setAttribute(
      'aria-label',
      this.folded ? 'Показать кнопку' : running ? 'Стоп' : 'Старт',
    );
    this.element.setAttribute('aria-busy', String(busy));
    this.element.disabled = starting;
  }
}
