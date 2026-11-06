/** Pinhole camera of the processing frame, in pixels; the principal point is the frame centre. */
export interface Intrinsics {
  width: number;
  height: number;
  focal: number;
}

/** Focal length in pixels for a frame `width` pixels wide with the given horizontal field of view. */
export function focalForFov(width: number, horizontalFovDeg: number): number {
  return width / 2 / Math.tan((horizontalFovDeg * Math.PI) / 360);
}

/**
 * ARToolKit camera parameter file (version 4, 176 bytes, big-endian) for a pinhole camera
 * without lens distortion: frame size, the 3x4 projection matrix and the distortion factors
 * (k1 k2 p1 p2 = 0, fx, fy, x0, y0, scale 1). Pixel-index coordinates: the centre of a W x H
 * frame is ((W - 1) / 2, (H - 1) / 2), as in the virtual camera's ground truth.
 */
export function cameraParamBytes({ width, height, focal }: Intrinsics): Uint8Array {
  const view = new DataView(new ArrayBuffer(176));
  view.setInt32(0, width);
  view.setInt32(4, height);
  const cx = (width - 1) / 2;
  const cy = (height - 1) / 2;
  const mat = [focal, 0, cx, 0, 0, focal, cy, 0, 0, 0, 1, 0];
  const distortion = [0, 0, 0, 0, focal, focal, cx, cy, 1];
  [...mat, ...distortion].forEach((value, i) => view.setFloat64(8 + i * 8, value));
  return new Uint8Array(view.buffer);
}

/** Size of the frame the tracker processes: the video scaled to `maxSide`, same proportions. */
export function processingSize(
  videoWidth: number,
  videoHeight: number,
  maxSide = 640,
): { width: number; height: number } {
  const scale = Math.min(1, maxSide / Math.max(videoWidth, videoHeight));
  return { width: Math.round(videoWidth * scale), height: Math.round(videoHeight * scale) };
}
