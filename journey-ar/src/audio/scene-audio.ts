import type { SceneEntry } from '../scenes/manifest';
import { RESUME_SECONDS, SPATIAL, loopBounds, trackPosition } from './loop-bounds';

interface Track {
  buffer: AudioBuffer;
  loop: { start: number; end: number };
}

interface Playing {
  id: string;
  track: Track;
  looping: boolean;
  source: AudioBufferSourceNode;
  gain: GainNode;
  panner: PannerNode;
  /** Context time when it started, and the track position it started from. */
  startedAt: number;
  from: number;
}

/** Where a track stopped when its page was lost, and when (performance.now(), ms). */
interface Stopped {
  id: string;
  position: number;
  time: number;
}

export interface SceneAudioState {
  unlocked: boolean;
  /** Scene whose sound should play (its page is tracked). */
  active: string | null;
  /** Scene whose sound is playing (null while decoding, faded out or without sound). */
  playing: string | null;
  /** Position in the playing track, seconds (0 when nothing plays). */
  position: number;
  /** Distance from the camera to the sound source, metres. */
  distance: number | null;
  /** RMS before and after the spatialization (panner), for tests. */
  levels: { dry: number; wet: number };
}

/** Decoded tracks kept in memory: the current scene and the previous one. */
const DECODED_LIMIT = 2;

/**
 * The scene soundtracks. A page found starts its track from the beginning (fade in), a page
 * lost stops it (fade out); a page found again within RESUME_SECONDS continues its track where
 * it stopped. The sound is spatial: a source at the scene's centre on the page,
 * heard from the camera; the volume follows the distance smoothly (inverse model, see SPATIAL)
 * and the stereo balance follows the direction. Tracks loop without the MP3 gap.
 */
export class SceneAudio {
  private context: AudioContext | null = null;
  private master: GainNode | null = null;
  private dryMeter: AnalyserNode | null = null;
  private wetMeter: AnalyserNode | null = null;
  private readonly files = new Map<string, Promise<ArrayBuffer>>();
  private readonly tracks = new Map<string, Promise<Track>>();
  private playing: Playing | null = null;
  private stopped: Stopped | null = null;
  private activeId: string | null = null;
  private distance: number | null = null;

  constructor(
    private readonly scenes: readonly SceneEntry[],
    private readonly baseUrl: string,
    private readonly onError: (error: unknown) => void,
  ) {}

  /**
   * Creates or resumes the audio context. Call it from a user gesture (Start): browsers, iOS
   * Safari first of all, keep audio silent until then.
   */
  unlock(): void {
    const session = (navigator as Navigator & { audioSession?: { type: string } }).audioSession;
    // iOS 17+: play as media, also with the silent switch on.
    if (session) session.type = 'playback';
    if (!this.context) {
      const context = new AudioContext();
      this.master = context.createGain();
      this.wetMeter = context.createAnalyser();
      this.master.connect(this.wetMeter);
      this.master.connect(context.destination);
      this.dryMeter = context.createAnalyser();
      this.context = context;
    }
    void this.context.resume();
  }

  /** Pauses all sound (the page is hidden); resume() continues. */
  suspend(): void {
    void this.context?.suspend();
  }

  resume(): void {
    void this.context?.resume();
  }

  /** Downloads the compressed tracks in the background (decoding waits for their page). */
  preload(): void {
    for (const scene of this.scenes) void this.file(scene).catch(() => undefined);
  }

  /** Plays the sound of the tracked page's scene; null stops it. */
  setTracked(id: string | null): void {
    if (id === this.activeId) return;
    this.activeId = id;
    this.stop();
    const scene = id ? this.scenes.find((s) => s.id === id) : undefined;
    if (!scene || !this.context) return;
    const stopped = this.stopped;
    const resumeAt =
      stopped?.id === scene.id && performance.now() - stopped.time <= RESUME_SECONDS * 1000
        ? stopped.position
        : null;
    this.track(scene).then((track) => {
      if (this.activeId === scene.id) this.start(scene, track, resumeAt);
    }, this.onError);
  }

  /**
   * Position of the sound source in the camera frame, metres (camera at the origin, looking
   * down -Z, Y up). The change is smoothed, so volume and balance glide.
   */
  setSourcePosition(x: number, y: number, z: number): void {
    this.distance = Math.hypot(x, y, z);
    const playing = this.playing;
    if (!playing || !this.context) return;
    const now = this.context.currentTime;
    playing.panner.positionX.setTargetAtTime(x, now, SPATIAL.smoothing);
    playing.panner.positionY.setTargetAtTime(y, now, SPATIAL.smoothing);
    playing.panner.positionZ.setTargetAtTime(z, now, SPATIAL.smoothing);
  }

  get state(): SceneAudioState {
    const context = this.context;
    return {
      unlocked: context?.state === 'running',
      active: this.activeId,
      playing: this.playing?.id ?? null,
      position: this.playing && context ? this.positionOf(this.playing, context.currentTime) : 0,
      distance: this.distance,
      levels: { dry: rms(this.dryMeter), wet: rms(this.wetMeter) },
    };
  }

  /** Starts a track from the beginning, or from `resumeAt` seconds. */
  private start(scene: SceneEntry, track: Track, resumeAt: number | null): void {
    const context = this.context!;
    const now = context.currentTime;
    const looping = scene.audio.loop;
    const from =
      resumeAt !== null && (looping || resumeAt < track.buffer.duration)
        ? resumeAt
        : track.loop.start;
    const source = context.createBufferSource();
    source.buffer = track.buffer;
    source.loop = looping;
    source.loopStart = track.loop.start;
    source.loopEnd = track.loop.end;

    const gain = context.createGain();
    gain.gain.setValueAtTime(0, now);
    gain.gain.linearRampToValueAtTime(scene.audio.volume, now + SPATIAL.fade);

    const panner = new PannerNode(context, {
      panningModel: 'equalpower',
      distanceModel: 'inverse',
      refDistance: SPATIAL.refDistance,
      rolloffFactor: SPATIAL.rolloffFactor,
      maxDistance: SPATIAL.maxDistance,
      // Start where the camera sees the page now, without gliding in from the origin.
      positionZ: -(this.distance ?? SPATIAL.refDistance),
    });

    source.connect(gain).connect(panner).connect(this.master!);
    gain.connect(this.dryMeter!);
    source.start(now, from);
    this.playing = { id: scene.id, track, looping, source, gain, panner, startedAt: now, from };
  }

  private stop(): void {
    const playing = this.playing;
    if (!playing || !this.context) return;
    this.playing = null;
    const now = this.context.currentTime;
    this.stopped = {
      id: playing.id,
      position: this.positionOf(playing, now),
      time: performance.now(),
    };
    playing.gain.gain.cancelScheduledValues(now);
    playing.gain.gain.setValueAtTime(playing.gain.gain.value, now);
    playing.gain.gain.linearRampToValueAtTime(0, now + SPATIAL.fade);
    playing.source.stop(now + SPATIAL.fade + 0.02);
    playing.source.addEventListener('ended', () => {
      playing.source.disconnect();
      playing.panner.disconnect();
    });
  }

  private positionOf(playing: Playing, now: number): number {
    const { track, looping, from, startedAt } = playing;
    return trackPosition(from, now - startedAt, track.loop, looping, track.buffer.duration);
  }

  private file(scene: SceneEntry): Promise<ArrayBuffer> {
    let file = this.files.get(scene.id);
    if (!file) {
      const url = new URL(scene.audio.src, new URL(this.baseUrl, window.location.href));
      file = fetch(url).then((response) => {
        if (!response.ok) throw new Error(`Cannot load ${url.href}: HTTP ${response.status}`);
        return response.arrayBuffer();
      });
      this.files.set(scene.id, file);
      file.catch(() => this.files.delete(scene.id));
    }
    return file;
  }

  private track(scene: SceneEntry): Promise<Track> {
    let track = this.tracks.get(scene.id);
    if (!track) {
      track = this.file(scene).then(async (bytes) => {
        // decodeAudioData detaches its argument: decode a copy, keep the file for later.
        const buffer = await this.context!.decodeAudioData(bytes.slice(0));
        const channels = Array.from({ length: buffer.numberOfChannels }, (_, i) =>
          buffer.getChannelData(i),
        );
        return { buffer, loop: loopBounds(channels, buffer.sampleRate) };
      });
      this.tracks.set(scene.id, track);
      track.catch(() => this.tracks.delete(scene.id));
    }
    // Most recently used last; drop the oldest decoded tracks beyond the limit.
    this.tracks.delete(scene.id);
    this.tracks.set(scene.id, track);
    while (this.tracks.size > DECODED_LIMIT) {
      const oldest = this.tracks.keys().next().value as string;
      this.tracks.delete(oldest);
    }
    return track;
  }
}

function rms(analyser: AnalyserNode | null): number {
  if (!analyser) return 0;
  const data = new Float32Array(analyser.fftSize);
  analyser.getFloatTimeDomainData(data);
  let sum = 0;
  for (const v of data) sum += v * v;
  return Math.sqrt(sum / data.length);
}
