export interface PinchHandlers {
  begin(): void;
  /** Current finger distance / distance at the start of the gesture (or the wheel equivalent). */
  change(ratio: number): void;
  end(): void;
}

// Mouse wheel: one notch (deltaY ~100) scales by ~14 %. A trackpad pinch arrives as wheel
// events with ctrlKey and small deltas, so it gets a stronger factor.
const WHEEL_SCALE = 0.0015;
const TRACKPAD_PINCH_SCALE = 0.01;
const WHEEL_END_MS = 250;

/**
 * Pinch gesture on `element`: two pointers (fingers) on a touch screen; on a PC the mouse wheel
 * or a trackpad pinch. The browser's own zoom is blocked (ctrl+wheel; Safari's gesture events;
 * the page sets touch-action: none for touch). Returns a function that detaches the listeners.
 */
export function attachPinchGesture(element: HTMLElement, handlers: PinchHandlers): () => void {
  const pointers = new Map<number, { x: number; y: number }>();
  let startDistance = 0;
  let wheelTimer: number | undefined;

  const distance = () => {
    const [a, b] = [...pointers.values()];
    return a && b ? Math.hypot(a.x - b.x, a.y - b.y) : 0;
  };

  const onDown = (event: PointerEvent) => {
    if (pointers.size >= 2) return;
    pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
    if (pointers.size === 2) {
      startDistance = distance();
      if (startDistance > 0) handlers.begin();
    }
  };
  const onMove = (event: PointerEvent) => {
    const pointer = pointers.get(event.pointerId);
    if (!pointer) return;
    pointer.x = event.clientX;
    pointer.y = event.clientY;
    if (pointers.size === 2 && startDistance > 0) handlers.change(distance() / startDistance);
  };
  const onUp = (event: PointerEvent) => {
    if (!pointers.has(event.pointerId)) return;
    if (pointers.size === 2 && startDistance > 0) handlers.end();
    pointers.delete(event.pointerId);
    startDistance = 0;
  };
  // Every wheel event scales the current size (so a size held at a limit responds at once to
  // the opposite direction); the gesture ends when the wheel has been quiet for a moment.
  const onWheel = (event: WheelEvent) => {
    event.preventDefault();
    window.clearTimeout(wheelTimer);
    handlers.begin();
    handlers.change(Math.exp(-event.deltaY * (event.ctrlKey ? TRACKPAD_PINCH_SCALE : WHEEL_SCALE)));
    wheelTimer = window.setTimeout(() => {
      wheelTimer = undefined;
      handlers.end();
    }, WHEEL_END_MS);
  };
  const preventDefault = (event: Event) => event.preventDefault();

  element.addEventListener('pointerdown', onDown);
  element.addEventListener('pointermove', onMove);
  element.addEventListener('pointerup', onUp);
  element.addEventListener('pointercancel', onUp);
  element.addEventListener('wheel', onWheel, { passive: false });
  // iOS Safari zooms the page with its own gesture events, regardless of touch-action.
  document.addEventListener('gesturestart', preventDefault);
  document.addEventListener('gesturechange', preventDefault);

  return () => {
    element.removeEventListener('pointerdown', onDown);
    element.removeEventListener('pointermove', onMove);
    element.removeEventListener('pointerup', onUp);
    element.removeEventListener('pointercancel', onUp);
    element.removeEventListener('wheel', onWheel);
    document.removeEventListener('gesturestart', preventDefault);
    document.removeEventListener('gesturechange', preventDefault);
  };
}
