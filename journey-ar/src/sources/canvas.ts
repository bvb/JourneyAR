import { VirtualCamera, createVcamApi } from 'journey-virtual-book-camera/core';
import type { FrameSource } from './frame-source';
import { releaseStream } from './release-stream';

/**
 * The virtual camera rendered in this page (dev/test builds only). Its automation API is
 * installed as `window.__vcam`, so tests drive the page and the camera pose and read the ground
 * truth in the same page as the app.
 */
export async function canvasSource(): Promise<FrameSource> {
  const vcam = new VirtualCamera(document.createElement('canvas'));
  const api = createVcamApi(vcam);
  window.__vcam = api;
  await vcam.setPage(vcam.pages[0]?.id ?? null);
  api.ready = true;
  let video: HTMLVideoElement | null = null;
  return {
    kind: 'canvas',
    mirrored: false,
    async start(target) {
      video = target;
      vcam.start();
      target.srcObject = vcam.captureStream();
      await target.play();
    },
    stop() {
      vcam.stop();
      releaseStream(video);
    },
  };
}
