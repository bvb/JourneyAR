export interface ScreenPoint {
  /** Client coordinates, CSS px. */
  x: number;
  y: number;
}

export interface SceneGestureHandlers {
  /** Pinch (two fingers) or the wheel: the size relative to the start of the gesture. */
  scaleBegin(): void;
  /** Current finger distance / distance at the start of the gesture (or the wheel equivalent). */
  scaleChange(ratio: number): void;
  scaleEnd(): void;
  /** Drag (one finger, the mouse, or the middle of two fingers) between two screen points. */
  move(from: ScreenPoint, to: ScreenPoint): void;
  /** Double tap or double click. */
  reset(): void;
}

// Mouse wheel: one notch (deltaY ~100) scales by ~14 %. A trackpad pinch arrives as wheel
// events with ctrlKey and small deltas, so it gets a stronger factor.
const WHEEL_SCALE = 0.0015;
const TRACKPAD_PINCH_SCALE = 0.01;
const WHEEL_END_MS = 250;
/** A drag starts once the fingers have moved this far, so a tap does not nudge the scene. */
const DRAG_SLOP_PX = 8;
/** A tap: released within this time without dragging. */
const TAP_MS = 300;
/** Double tap: the second tap this soon after the first, this close to it. */
const DOUBLE_TAP_MS = 400;
const DOUBLE_TAP_PX = 40;

/**
 * Gestures on `element` that place the shown scene: pinch to scale and drag to move (one or two
 * fingers on a touch screen; the mouse and the wheel or a trackpad pinch on a PC), double tap to
 * reset. The browser's own zoom is blocked (ctrl+wheel; Safari's gesture events; the page sets
 * touch-action: none for touch). Returns a function that detaches the listeners.
 */
export function attachSceneGestures(
  element: HTMLElement,
  handlers: SceneGestureHandlers,
): () => void {
  const pointers = new Map<number, ScreenPoint>();
  let startDistance = 0;
  // The drag follows the middle of the fingers on the screen.
  let dragFrom: ScreenPoint = { x: 0, y: 0 };
  let dragOrigin: ScreenPoint = { x: 0, y: 0 };
  let dragging = false;
  let tapStart: number | null = null;
  let lastTap: { x: number; y: number; time: number } | null = null;
  let wheelTimer: number | undefined;

  const center = (): ScreenPoint => {
    let x = 0;
    let y = 0;
    for (const p of pointers.values()) {
      x += p.x;
      y += p.y;
    }
    return { x: x / pointers.size, y: y / pointers.size };
  };
  const distance = () => {
    const [a, b] = [...pointers.values()];
    return a && b ? Math.hypot(a.x - b.x, a.y - b.y) : 0;
  };
  // A finger added or lifted moves the middle: the drag continues from the new middle.
  const rebaseDrag = () => {
    dragFrom = center();
    dragOrigin = dragFrom;
  };

  const onDown = (event: PointerEvent) => {
    if (pointers.size >= 2) return;
    if (event.pointerType === 'mouse' && event.button !== 0) return;
    pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
    try {
      element.setPointerCapture(event.pointerId);
    } catch {
      // Capture is a convenience (a mouse drag leaving the page).
    }
    if (pointers.size === 1) {
      dragging = false;
      tapStart = event.timeStamp;
    } else {
      tapStart = null;
      startDistance = distance();
      if (startDistance > 0) handlers.scaleBegin();
    }
    rebaseDrag();
  };

  const onMove = (event: PointerEvent) => {
    const pointer = pointers.get(event.pointerId);
    if (!pointer) return;
    pointer.x = event.clientX;
    pointer.y = event.clientY;
    if (pointers.size === 2 && startDistance > 0) handlers.scaleChange(distance() / startDistance);
    const to = center();
    if (!dragging && Math.hypot(to.x - dragOrigin.x, to.y - dragOrigin.y) > DRAG_SLOP_PX) {
      dragging = true;
      tapStart = null;
    }
    if (dragging) {
      handlers.move(dragFrom, to);
      dragFrom = to;
    }
  };

  const onUp = (event: PointerEvent) => {
    if (!pointers.has(event.pointerId)) return;
    if (pointers.size === 2 && startDistance > 0) handlers.scaleEnd();
    pointers.delete(event.pointerId);
    startDistance = 0;
    if (pointers.size > 0) {
      rebaseDrag();
      return;
    }
    dragging = false;
    const tapped =
      event.type === 'pointerup' && tapStart !== null && event.timeStamp - tapStart < TAP_MS;
    tapStart = null;
    if (!tapped) return;
    const tap = { x: event.clientX, y: event.clientY, time: event.timeStamp };
    if (
      lastTap &&
      tap.time - lastTap.time < DOUBLE_TAP_MS &&
      Math.hypot(tap.x - lastTap.x, tap.y - lastTap.y) < DOUBLE_TAP_PX
    ) {
      lastTap = null;
      handlers.reset();
    } else {
      lastTap = tap;
    }
  };

  // Every wheel event scales the current size (so a size held at a limit responds at once to
  // the opposite direction); the gesture ends when the wheel has been quiet for a moment.
  const onWheel = (event: WheelEvent) => {
    event.preventDefault();
    window.clearTimeout(wheelTimer);
    handlers.scaleBegin();
    handlers.scaleChange(
      Math.exp(-event.deltaY * (event.ctrlKey ? TRACKPAD_PINCH_SCALE : WHEEL_SCALE)),
    );
    wheelTimer = window.setTimeout(() => {
      wheelTimer = undefined;
      handlers.scaleEnd();
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
