import { Matrix4, Vector3 } from 'three';

// Page frame: millimetres on the physical page, origin at the page centre, X to the right,
// Y to the top of the page, Z out of the page (the same frame as the app's scenes.json).

export const PAGE_SIZE_MM = { width: 303, height: 226 } as const;

/** Where the virtual camera is, relative to the page. */
export interface CameraPose {
  /** Point of the page plane the camera looks at, mm. */
  target: [number, number];
  /** Distance from the camera to the target, mm. */
  distance: number;
  /** Angle between the view direction and the page normal, degrees (0: straight onto the page). */
  tilt: number;
  /**
   * Side the camera is tilted from, degrees counterclockwise around the page normal: 0 is the
   * page bottom (a reader holding the phone), 90 the right edge. It also turns the frame: with
   * roll 0, the page direction pointing away from the camera is at the top of the frame.
   */
  azimuth: number;
  /** Camera turn around its view axis, degrees; positive turns the page clockwise in the frame. */
  roll: number;
}

/** Size and field of view of the camera frame. */
export interface FrameSettings {
  width: number;
  height: number;
  /** Vertical field of view, degrees. */
  fov: number;
}

export const DEFAULT_POSE: CameraPose = {
  target: [0, 0],
  distance: 300,
  tilt: 0,
  azimuth: 0,
  roll: 0,
};

/** 640x480 with about 63 degrees horizontal field of view, like a typical phone camera. */
export const DEFAULT_FRAME: FrameSettings = { width: 640, height: 480, fov: 49.4 };

export const MAX_TILT = 85;

const DEG = Math.PI / 180;

/** Camera to page transform: the camera's world matrix when the page frame is the world. */
export function cameraMatrix(pose: CameraPose): Matrix4 {
  const tilt = Math.min(Math.max(pose.tilt, 0), MAX_TILT) * DEG;
  const azimuth = pose.azimuth * DEG;
  const target = new Vector3(pose.target[0], pose.target[1], 0);
  const eye = new Vector3(
    target.x + pose.distance * Math.sin(tilt) * Math.sin(azimuth),
    target.y - pose.distance * Math.sin(tilt) * Math.cos(azimuth),
    pose.distance * Math.cos(tilt),
  );
  const up = new Vector3(-Math.sin(azimuth), Math.cos(azimuth), 0);
  // Matrix4.lookAt builds the rotation of an object whose -Z looks at the target (a camera).
  const matrix = new Matrix4().lookAt(eye, target, up);
  matrix.multiply(new Matrix4().makeRotationZ(pose.roll * DEG));
  matrix.setPosition(eye);
  return matrix;
}

/**
 * Page to camera transform in OpenGL camera axes (X right, Y up, looking down -Z), in mm: the
 * same convention as the pose of the NFT tracker with origin "center".
 */
export function modelViewMatrix(pose: CameraPose): Matrix4 {
  return cameraMatrix(pose).invert();
}

/** Focal length in pixels for the frame (square pixels). */
export function focalLength(frame: FrameSettings): number {
  return frame.height / 2 / Math.tan((frame.fov * DEG) / 2);
}

/** Horizontal field of view of the frame, degrees. */
export function horizontalFov(frame: FrameSettings): number {
  return (2 * Math.atan(frame.width / 2 / focalLength(frame))) / DEG;
}

/**
 * Projects a page point (mm) into the frame. Returns pixel-index coordinates (u to the right,
 * v down; the principal point is the frame centre, ((width - 1) / 2, (height - 1) / 2)), or
 * null for a point behind the camera.
 */
export function projectPoint(
  modelView: Matrix4,
  frame: FrameSettings,
  point: readonly [number, number, number],
): [number, number] | null {
  const p = new Vector3(...point).applyMatrix4(modelView);
  if (p.z >= -1e-6) return null;
  const f = focalLength(frame);
  return [(frame.width - 1) / 2 + (f * p.x) / -p.z, (frame.height - 1) / 2 - (f * p.y) / -p.z];
}

/** Fraction of the page area that is inside the frame, sampled on a grid. */
export function pageInView(modelView: Matrix4, frame: FrameSettings, samples = 24): number {
  let inside = 0;
  const rows = Math.round((samples * PAGE_SIZE_MM.height) / PAGE_SIZE_MM.width);
  for (let j = 0; j < rows; j += 1) {
    for (let i = 0; i < samples; i += 1) {
      const x = ((i + 0.5) / samples - 0.5) * PAGE_SIZE_MM.width;
      const y = ((j + 0.5) / rows - 0.5) * PAGE_SIZE_MM.height;
      const uv = projectPoint(modelView, frame, [x, y, 0]);
      if (uv && uv[0] >= 0 && uv[0] <= frame.width - 1 && uv[1] >= 0 && uv[1] <= frame.height - 1) {
        inside += 1;
      }
    }
  }
  return inside / (samples * rows);
}
