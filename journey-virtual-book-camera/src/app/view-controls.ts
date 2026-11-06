import { type VirtualCamera, cameraMatrix } from '../core';

const DEG = Math.PI / 180;

function wrapDegrees(value: number): number {
  return ((((value + 180) % 360) + 360) % 360) - 180;
}

/**
 * Mouse control of the camera over the frame view: drag turns the camera around the target
 * (azimuth and tilt), Shift+drag or right drag moves the target, the wheel changes the distance.
 */
export function attachViewControls(element: HTMLElement, vcam: VirtualCamera): void {
  let drag: { x: number; y: number; pan: boolean } | null = null;

  element.addEventListener('pointerdown', (event) => {
    element.setPointerCapture(event.pointerId);
    drag = { x: event.clientX, y: event.clientY, pan: event.shiftKey || event.button === 2 };
  });

  element.addEventListener('pointermove', (event) => {
    if (!drag) return;
    const dx = event.clientX - drag.x;
    const dy = event.clientY - drag.y;
    drag.x = event.clientX;
    drag.y = event.clientY;
    const pose = vcam.getPose();
    if (!drag.pan) {
      vcam.setPose({ azimuth: wrapDegrees(pose.azimuth - dx * 0.3), tilt: pose.tilt + dy * 0.2 });
      return;
    }
    // Millimetres per screen pixel at the target, for the frame as it is shown (contained).
    const frame = vcam.getFrame();
    const rect = vcam.canvas.getBoundingClientRect();
    const shownHeight =
      frame.height * Math.min(rect.width / frame.width, rect.height / frame.height);
    const mmPerPixel = (2 * pose.distance * Math.tan((frame.fov * DEG) / 2)) / shownHeight;
    // The page follows the pointer: move the target against the camera's right and up axes.
    const m = cameraMatrix(pose).elements;
    vcam.setPose({
      target: [
        pose.target[0] - (dx * m[0]! - dy * m[4]!) * mmPerPixel,
        pose.target[1] - (dx * m[1]! - dy * m[5]!) * mmPerPixel,
      ],
    });
  });

  const end = () => {
    drag = null;
  };
  element.addEventListener('pointerup', end);
  element.addEventListener('pointercancel', end);
  element.addEventListener('contextmenu', (event) => event.preventDefault());
  element.addEventListener(
    'wheel',
    (event) => {
      event.preventDefault();
      const pose = vcam.getPose();
      vcam.setPose({ distance: pose.distance * Math.exp(event.deltaY * 0.001) });
    },
    { passive: false },
  );
}
