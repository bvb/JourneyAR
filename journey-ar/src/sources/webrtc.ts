import { WebRtcReceiver } from 'journey-virtual-book-camera/core';
import type { FrameSource } from './frame-source';
import { releaseStream } from './release-stream';

/**
 * The virtual camera streamed from another tab or device over WebRTC (dev/test builds only).
 * Signaling goes through this dev server's relay; start() waits until the virtual camera is
 * open and streaming, and a reconnecting camera replaces the stream.
 */
export function webrtcSource(): FrameSource {
  const protocol = window.location.protocol === 'https:' ? 'wss' : 'ws';
  const url = `${protocol}://${window.location.host}/__signal`;
  let receiver: WebRtcReceiver | null = null;
  let video: HTMLVideoElement | null = null;
  return {
    kind: 'webrtc',
    mirrored: false,
    start(target) {
      video = target;
      return new Promise((resolve, reject) => {
        receiver = new WebRtcReceiver(url, (stream) => {
          target.srcObject = stream;
          target.play().then(resolve, reject);
        });
        receiver.start();
      });
    },
    stop() {
      receiver?.stop();
      receiver = null;
      releaseStream(video);
    },
  };
}
