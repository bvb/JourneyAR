import type { TrackerFrame } from '@webarkit/jsartoolkit-nft/client';

export interface FrameSize {
  width: number;
  height: number;
}

/**
 * Takes the current video frame as the tracker's processing frame: scaled to `size` (landscape)
 * and, for a portrait video (`rotated`), turned 90 degrees clockwise into it, so the tracker
 * always gets a landscape frame (see TrackingLoop). RGBA rows from the top.
 */
export interface FrameGrabber {
  grab(video: HTMLVideoElement, size: FrameSize, rotated: boolean): Promise<TrackerFrame>;
}

/**
 * The frame through a 2D canvas: drawImage (the whole video frame read back from the GPU and
 * scaled on the CPU) and getImageData, on the main thread. The fallback to the GPU grabber
 * (src/render/gpu-frame-grabber.ts), and `?grab=canvas` for comparisons.
 */
export class CanvasFrameGrabber implements FrameGrabber {
  private readonly canvas = document.createElement('canvas');
  private readonly context = this.canvas.getContext('2d', { willReadFrequently: true })!;

  grab(video: HTMLVideoElement, size: FrameSize, rotated: boolean): Promise<TrackerFrame> {
    if (this.canvas.width !== size.width || this.canvas.height !== size.height) {
      this.canvas.width = size.width;
      this.canvas.height = size.height;
    }
    if (rotated) {
      // Clockwise: the video top goes to the right edge, its left edge to the top.
      this.context.setTransform(0, 1, -1, 0, size.width, 0);
      this.context.drawImage(video, 0, 0, size.height, size.width);
      this.context.setTransform(1, 0, 0, 1, 0, 0);
    } else {
      this.context.drawImage(video, 0, 0, size.width, size.height);
    }
    return Promise.resolve(this.context.getImageData(0, 0, size.width, size.height));
  }
}
