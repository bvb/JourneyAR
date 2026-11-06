import type { FilterConfig, FrameGeometry } from '@webarkit/jsartoolkit-nft/client';
import type { SceneEntry } from '../scenes/manifest';
import { focalForFov, processingSize } from './camera-params';
import { NftTracker, type TrackingResult } from './nft-tracker';

export interface TrackingLoopOptions {
  video: HTMLVideoElement;
  scenes: readonly SceneEntry[];
  baseUrl: string;
  filter: FilterConfig;
  /** Assumed horizontal field of view of the camera when the source does not know its focal. */
  horizontalFov: number;
  /** Focal length of the video frames in video pixels, when the source knows it. */
  sourceFocal?: () => number | undefined;
  onResult(result: TrackingResult): void;
  onError(error: unknown): void;
}

/**
 * Feeds the playing video to the tracker: on every new video frame, unless the tracker is still
 * busy, the frame is scaled to the processing size and processed. The tracker is created on the
 * first frame and recreated when the video size changes.
 */
export class TrackingLoop {
  private tracker: NftTracker | null = null;
  private running = false;
  private busy = false;
  private readonly canvas = document.createElement('canvas');
  private readonly context = this.canvas.getContext('2d', { willReadFrequently: true })!;

  constructor(private readonly options: TrackingLoopOptions) {}

  /** Where the processing frame comes from in the video (the whole video, scaled). */
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
      rotated: false,
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
    if (this.busy) return;
    this.busy = true;
    this.step()
      .catch((error: unknown) => {
        this.running = false;
        this.options.onError(error);
      })
      .finally(() => {
        this.busy = false;
      });
  };

  private async step(): Promise<void> {
    const { video } = this.options;
    if (!video.videoWidth || !video.videoHeight) return;
    const size = processingSize(video.videoWidth, video.videoHeight);
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
        ? (sourceFocal * size.width) / video.videoWidth
        : focalForFov(size.width, this.options.horizontalFov);
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
    this.context.drawImage(video, 0, 0, size.width, size.height);
    const frame = this.context.getImageData(0, 0, size.width, size.height);
    const result = await tracker.process(frame, performance.now());
    if (result && this.running) this.options.onResult(result);
  }
}
