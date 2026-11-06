import type { FrameSource } from './frame-source';
import { releaseStream } from './release-stream';

/** The device camera, the rear one when there is a choice. */
export function cameraSource(): FrameSource {
  let video: HTMLVideoElement | null = null;
  let mirrored = false;
  return {
    kind: 'camera',
    get mirrored() {
      return mirrored;
    },
    async start(target) {
      if (!navigator.mediaDevices?.getUserMedia) {
        throw new Error('Камера недоступна: нужен HTTPS и браузер с доступом к камере');
      }
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: false,
        video: {
          facingMode: { ideal: 'environment' },
          width: { ideal: 1280 },
          height: { ideal: 720 },
        },
      });
      video = target;
      mirrored = stream.getVideoTracks()[0]?.getSettings().facingMode === 'user';
      target.srcObject = stream;
      await target.play();
    },
    stop() {
      releaseStream(video);
    },
  };
}
