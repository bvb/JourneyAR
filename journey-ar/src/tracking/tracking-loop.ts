import type { FilterConfig, FrameGeometry } from '@webarkit/jsartoolkit-nft/client';
import type { SceneEntry } from '../scenes/manifest';
import { focalForFov, processingSize } from './camera-params';
import { NftTracker, type TrackingResult } from './nft-tracker';

export interface TrackingLoopOptions {
  video: HTMLVideoElement;
  scenes: readonly SceneEntry[];
  baseUrl: string;
  filter: FilterConfig;
  /** Assumed field of view of the camera along the long side of the frame, degrees. */
  fieldOfView: number;
  /** Focal length of the video frames in video pixels, when the source knows it. */
  sourceFocal?: () => number | undefined;
  onResult(result: TrackingResult): void;
  onError(error: unknown): void;
}

const RETRY_AFTER_ERROR_MS = 1000;

/**
 * Feeds the playing video to the tracker: on every new video frame, unless the tracker is still
 * busy, the frame is scaled to the processing size and processed.
 *
 * The tracker always gets a landscape frame: a portrait video (a phone held upright) is drawn
 * rotated 90 degrees clockwise, and the tracker's projection turns it back (`rotated` in the
 * frame geometry). Turning the phone therefore keeps the tracker, its camera parameters and
 * its markers. After an error the tracker is dropped and recreated a second later.
 */
export class TrackingLoop {
  private tracker: NftTracker | null = null;
  private running = false;
  private busy = false;
  private rotated = false;
  private retryAt = 0;
  private readonly canvas = document.createElement('canvas');
  private readonly context = this.canvas.getContext('2d', { willReadFrequently: true })!;

  constructor(private readonly options: TrackingLoopOptions) {}

  /** Where the processing frame comes from in the video, for the tracker's projection. */
  get geometry(): FrameGeometry | null {
    const { video } = this.options;
    const tracker = this.tracker;
    if (!tracker) return null;
    const { width, height } = tracker.intrinsics;
    return {
      frameWidth: width,
      frameHeight: height,
      videoWidth: video.videoWidth,
      videoHeight: video.videoHeight,
      x: 0,
      y: 0,
      width,
      height,
      rotated: this.rotated,
    };
  }

  get activeTracker(): NftTracker | null {
    return this.tracker;
  }

  start(): void {
    if (this.running) return;
    this.running = true;
    this.options.video.requestVideoFrameCallback(this.onFrame);
  }

  stop(): void {
    this.running = false;
  }

  async dispose(): Promise<void> {
    this.stop();
    await this.tracker?.dispose();
    this.tracker = null;
  }

  private readonly onFrame = (): void => {
    if (!this.running) return;
    this.options.video.requestVideoFrameCallback(this.onFrame);
    if (this.busy || performance.now() < this.retryAt) return;
    this.busy = true;
    this.step()
      .catch((error: unknown) => {
        this.options.onError(error);
        void this.tracker?.dispose().catch(() => undefined);
        this.tracker = null;
        this.retryAt = performance.now() + RETRY_AFTER_ERROR_MS;
      })
      .finally(() => {
        this.busy = false;
      });
  };

  private async step(): Promise<void> {
    const { video } = this.options;
    const videoWidth = video.videoWidth;
    const videoHeight = video.videoHeight;
    if (!videoWidth || !videoHeight) return;
    const longSide = Math.max(videoWidth, videoHeight);
    const size = processingSize(longSide, Math.min(videoWidth, videoHeight));

    let tracker = this.tracker;
    if (
      !tracker ||
      tracker.intrinsics.width !== size.width ||
      tracker.intrinsics.height !== size.height
    ) {
      await tracker?.dispose();
      this.tracker = null;
      const sourceFocal = this.options.sourceFocal?.();
      const focal = sourceFocal
        ? (sourceFocal * size.width) / longSide
        : focalForFov(size.width, this.options.fieldOfView);
      tracker = await NftTracker.create({
        intrinsics: { ...size, focal },
        scenes: this.options.scenes,
        baseUrl: this.options.baseUrl,
        filter: this.options.filter,
      });
      // Stopped while the worker was starting: do not keep it.
      if (!this.running) {
        await tracker.dispose();
        return;
      }
      this.tracker = tracker;
    }

    if (this.canvas.width !== size.width || this.canvas.height !== size.height) {
      this.canvas.width = size.width;
      this.canvas.height = size.height;
    }
    const portrait = videoHeight > videoWidth;
    if (portrait) {
      // Clockwise: the video top goes to the right edge, its left edge to the top.
      this.context.setTransform(0, 1, -1, 0, size.width, 0);
      this.context.drawImage(video, 0, 0, size.height, size.width);
      this.context.setTransform(1, 0, 0, 1, 0, 0);
    } else {
      this.context.drawImage(video, 0, 0, size.width, size.height);
    }
    const frame = this.context.getImageData(0, 0, size.width, size.height);
    const result = await tracker.process(frame, performance.now());
    this.rotated = portrait;
    if (result && this.running) this.options.onResult(result);
  }
}
