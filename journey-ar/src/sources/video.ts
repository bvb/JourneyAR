import type { FrameSource } from './frame-source';

/** A looping video file, for example a recording from the virtual camera or of the book. */
export function videoSource(src: string): FrameSource {
  let video: HTMLVideoElement | null = null;
  return {
    kind: 'video',
    mirrored: false,
    async start(target) {
      video = target;
      target.srcObject = null;
      target.src = src;
      target.loop = true;
      await target.play();
    },
    stop() {
      if (!video) return;
      video.pause();
      video.removeAttribute('src');
      video.load();
    },
  };
}
