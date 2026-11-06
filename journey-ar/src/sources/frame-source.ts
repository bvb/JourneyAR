import type { FrameSourceConfig, FrameSourceKind } from '../config/frame-source';
import { cameraSource } from './camera';
import { videoSource } from './video';

/**
 * Where the frames come from: the device camera or a test source. The source plays its frames
 * in the app's video element, which is what the screen shows and what the tracker reads.
 */
export interface FrameSource {
  readonly kind: FrameSourceKind;
  /** Whether the picture is mirrored on screen (a user-facing camera). */
  readonly mirrored: boolean;
  /** Starts the frames in `video`; resolves once they play. */
  start(video: HTMLVideoElement): Promise<void>;
  /** Stops the frames and releases the device or connection. */
  stop(): void;
}

export async function createFrameSource(config: FrameSourceConfig): Promise<FrameSource> {
  switch (config.kind) {
    case 'camera':
      return cameraSource();
    case 'video':
      return videoSource(config.src);
    case 'canvas':
      // Test sources embed the virtual camera; the DEV guard keeps it out of production builds.
      if (import.meta.env.DEV) return (await import('./canvas')).canvasSource();
      break;
    case 'webrtc':
      if (import.meta.env.DEV) return (await import('./webrtc')).webrtcSource();
      break;
  }
  throw new Error(`Frame source "${config.kind}" is not available in this build`);
}
