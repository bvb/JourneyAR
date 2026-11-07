import { describe, expect, it } from 'vitest';
import { SPATIAL, distanceGain, loopBounds } from '../../src/audio/loop-bounds';

describe('loopBounds', () => {
  const sampleRate = 1000;
  function track(lead: number, body: number, tail: number): Float32Array {
    const data = new Float32Array(lead + body + tail);
    for (let i = lead; i < lead + body; i += 1) data[i] = Math.sin(i) * 0.5 + 0.6;
    return data;
  }

  it('skips the silent encoder delay and padding', () => {
    const left = track(25, 900, 40);
    expect(loopBounds([left], sampleRate)).toEqual({ start: 0.025, end: 0.925 });
  });

  it('keeps a sample that is loud in any channel', () => {
    const left = track(30, 900, 30);
    const right = track(10, 940, 10);
    expect(loopBounds([left, right], sampleRate)).toEqual({ start: 0.01, end: 0.95 });
  });

  it('trims at most maxTrim seconds at each end', () => {
    const data = track(500, 100, 500);
    expect(loopBounds([data], sampleRate, 1e-4, 0.2)).toEqual({ start: 0.2, end: 0.9 });
  });

  it('leaves a track that starts and ends with sound as it is', () => {
    const data = track(0, 1000, 0);
    expect(loopBounds([data], sampleRate)).toEqual({ start: 0, end: 1 });
  });
});

describe('distanceGain', () => {
  it('is full at reading distance and falls smoothly further away', () => {
    expect(distanceGain(0.1)).toBe(1);
    expect(distanceGain(SPATIAL.refDistance)).toBe(1);
    expect(distanceGain(0.6)).toBeCloseTo(0.625, 3);
    expect(distanceGain(0.9)).toBeCloseTo(0.4545, 3);
    // Smooth: 1 cm more never changes the volume by more than 2 %.
    for (let d = 0.3; d < 2; d += 0.01) {
      expect(distanceGain(d) - distanceGain(d + 0.01)).toBeLessThan(0.02);
    }
  });
});
