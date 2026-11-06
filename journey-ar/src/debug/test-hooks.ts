import type { FrameSourceConfig } from '../config/frame-source';

/** State exposed on `window.__journey` in dev/test builds for Playwright. */
export interface JourneyTestHooks {
  ready: boolean;
  webglVersion: 1 | 2;
  framesRendered: number;
  source: FrameSourceConfig;
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
