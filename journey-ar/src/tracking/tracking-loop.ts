import type { FilterConfig, FrameGeometry } from '@webarkit/jsartoolkit-nft/client';
import type { SceneEntry } from '../scenes/manifest';
import { focalForFov, processingSize } from './camera-params';
import { CanvasFrameGrabber, type FrameGrabber } from './frame-grabber';
import { NftTracker, type TrackingResult } from './nft-tracker';
import { SearchPacer } from './search-pacer';

export interface TrackingLoopOptions {
  video: HTMLVideoElement;
  scenes: readonly SceneEntry[];
  baseUrl: string;
  filter: FilterConfig;
  /** Assumed field of view of the camera along the long side of the frame, degrees. */
  fieldOfView: number;
  /** Focal length of the video frames in video pixels, when the source knows it. */
  sourceFocal?: () => number | undefined;
  /** Makes the processing frames (default: through a 2D canvas). */
  grabber?: FrameGrabber;
  onResult(result: TrackingResult): void;
  onError(error: unknown): void;
}

const RETRY_AFTER_ERROR_MS = 1000;

/**
 * Feeds the playing video to the tracker: on every new video frame, unless the tracker is still
 * busy, the frame is scaled to the processing size and processed. While no page is in view the
 * tracker only searches every SEARCH_INTERVAL_MS (SearchPacer): searching is its costliest work.
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
  private readonly pacer = new SearchPacer();
  private readonly grabber: FrameGrabber;

  constructor(private readonly options: TrackingLoopOptions) {
    this.grabber = options.grabber ?? new CanvasFrameGrabber();
  }

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
    this.pacer.reset(performance.now());
    this.options.video.requestVideoFrameCallback(this.onFrame);
  }

  stop(): void {
    this.running = false;
  }

  async dispose(): Promise<void> {
    this.stop();
    const tracker = this.tracker;
    this.tracker = null;
    await tracker?.dispose();
  }

  private readonly onFrame = (): void => {
    if (!this.running) return;
    this.options.video.requestVideoFrameCallback(this.onFrame);
    const now = performance.now();
    if (this.busy || now < this.retryAt || !this.pacer.shouldProcess(now)) return;
    this.busy = true;
    this.step()
      .catch((error: unknown) => {
        // Stopped: a frame still in the worker fails with the disposed tracker; not an error.
        if (!this.running) return;
        this.options.onError(error);
        const tracker = this.tracker;
        this.tracker = null;
        void tracker?.dispose().catch(() => undefined);
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
      this.tracker = null;
      await tracker?.dispose();
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

    const portrait = videoHeight > videoWidth;
    const grabbedAt = performance.now();
    const frame = await this.grabber.grab(video, size, portrait);
    if (!this.running) return;
    const result = await tracker.process(frame, grabbedAt);
    this.rotated = portrait;
    if (result) this.pacer.processed(grabbedAt, result.scene !== null);
    if (result && this.running) this.options.onResult(result);
  }
}
