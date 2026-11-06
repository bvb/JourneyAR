/**
 * Where the tracker gets its frames from, selected with the `?source=` URL parameter.
 *
 * - `camera` (default): the device camera via getUserMedia.
 * - `canvas`: the virtual camera rendered in the same page (automated tests).
 * - `webrtc`: the virtual camera streamed from another tab (manual debugging).
 * - `video`: a looping video file given by `&src=` (regression on recordings).
 *
 * Test sources are honoured only when `allowTestSources` is true (dev/test builds);
 * production builds always use the camera.
 */
export type FrameSourceConfig =
  { kind: 'camera' } | { kind: 'canvas' } | { kind: 'webrtc' } | { kind: 'video'; src: string };

export type FrameSourceKind = FrameSourceConfig['kind'];

export const FRAME_SOURCE_KINDS: readonly FrameSourceKind[] = [
  'camera',
  'canvas',
  'webrtc',
  'video',
];

export function parseFrameSource(search: string, allowTestSources: boolean): FrameSourceConfig {
  const params = new URLSearchParams(search);
  const kind = params.get('source');

  if (!allowTestSources || kind === null || kind === 'camera') {
    return { kind: 'camera' };
  }

  switch (kind) {
    case 'canvas':
    case 'webrtc':
      return { kind };
    case 'video': {
      const src = params.get('src');
      if (!src) {
        throw new Error('`?source=video` requires a `src` parameter with the video URL');
      }
      return { kind: 'video', src };
    }
    default:
      // Fail loudly: a typo must not silently fall back to the real camera in tests.
      throw new Error(
        `Unknown frame source "${kind}". Expected one of: ${FRAME_SOURCE_KINDS.join(', ')}`,
      );
  }
}
