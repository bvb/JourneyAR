import type { FrameSourceConfig } from '../config/frame-source';

/** State exposed on `window.__journey` in dev/test builds for Playwright. */
export interface JourneyTestHooks {
  ready: boolean;
  webglVersion: 1 | 2;
  framesRendered: number;
  source: FrameSourceConfig;
  /** State of the frame source: idle until Start, running while frames play. */
  sourceState: 'idle' | 'starting' | 'running' | 'error';
  /** Video frames presented so far, and the size of the last one. */
  videoFrames: number;
  videoSize: [number, number] | null;
  tracking: TrackingHooks;
}

/** Tracker output, for comparing with the virtual camera's ground truth. */
export interface TrackingHooks {
  /** The tracker has processed at least one frame. */
  ready: boolean;
  processed: number;
  /** Scene whose page is tracked, and its pose (page -> camera, column-major, mm). */
  scene: string | null;
  pose: number[] | null;
  /** Found/lost transitions with their time (performance.now()). */
  events: { type: 'found' | 'lost'; scene: string; time: number }[];
  /** Worker processing times of the last frames, ms. */
  processMs: number[];
}

declare global {
  interface Window {
    __journey?: JourneyTestHooks;
  }
}

export function installTestHooks(initial: JourneyTestHooks): JourneyTestHooks | undefined {
  if (!import.meta.env.DEV) return undefined;
  window.__journey = initial;
  return initial;
}
