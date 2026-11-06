import { describe, expect, it } from 'vitest';
import { parseFrameSource } from '../../src/config/frame-source';

describe('parseFrameSource', () => {
  it('defaults to the camera', () => {
    expect(parseFrameSource('', true)).toEqual({ kind: 'camera' });
    expect(parseFrameSource('?source=camera', true)).toEqual({ kind: 'camera' });
  });

  it('accepts test sources when allowed', () => {
    expect(parseFrameSource('?source=canvas', true)).toEqual({ kind: 'canvas' });
    expect(parseFrameSource('?source=webrtc', true)).toEqual({ kind: 'webrtc' });
    expect(parseFrameSource('?source=video&src=/rec/page90.webm', true)).toEqual({
      kind: 'video',
      src: '/rec/page90.webm',
    });
  });

  it('ignores test sources in production builds', () => {
    expect(parseFrameSource('?source=canvas', false)).toEqual({ kind: 'camera' });
    expect(parseFrameSource('?source=nonsense', false)).toEqual({ kind: 'camera' });
  });

  it('fails loudly on mistakes instead of falling back to the camera', () => {
    expect(() => parseFrameSource('?source=canvs', true)).toThrow(/Unknown frame source/);
    expect(() => parseFrameSource('?source=video', true)).toThrow(/requires a `src`/);
  });
});
