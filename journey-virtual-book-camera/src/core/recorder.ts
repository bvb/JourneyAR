import type { VirtualCamera } from './virtual-camera';

/** Ground truth of one rendered frame of a recording. */
export interface TruthSample {
  /** Seconds since the recording started (close to the video time of the frame). */
  t: number;
  page: string | null;
  /** Page to camera transform (see GroundTruth.modelView). */
  modelView: number[];
}

/** The ground truth track saved next to a recorded video (<name>.json). */
export interface RecordingTruth {
  frame: { width: number; height: number; focal: number };
  samples: TruthSample[];
}

export interface Recording {
  video: Blob;
  truth: RecordingTruth;
}

const MIME_TYPES = ['video/webm;codecs=vp9', 'video/webm;codecs=vp8', 'video/webm'];
const FPS = 30;
const BITS_PER_SECOND = 8_000_000;

/**
 * Records the virtual camera frames to WebM with MediaRecorder, together with the ground truth
 * pose of every rendered frame. Do not change the frame size while recording.
 */
export class Recorder {
  private recorder: MediaRecorder | null = null;
  private stream: MediaStream | null = null;
  private chunks: Blob[] = [];
  private truth: RecordingTruth | null = null;
  private unsubscribe: (() => void) | null = null;

  constructor(private readonly vcam: VirtualCamera) {}

  get recording(): boolean {
    return this.recorder !== null;
  }

  start(): void {
    if (this.recorder) throw new Error('Already recording');
    const mimeType = MIME_TYPES.find((type) => MediaRecorder.isTypeSupported(type));
    if (!mimeType) throw new Error('MediaRecorder cannot record WebM in this browser');
    const initial = this.vcam.groundTruth();
    const truth: RecordingTruth = {
      frame: { width: initial.width, height: initial.height, focal: initial.focal },
      samples: [],
    };
    this.stream = this.vcam.captureStream(FPS);
    this.chunks = [];
    this.truth = truth;
    this.recorder = new MediaRecorder(this.stream, {
      mimeType,
      videoBitsPerSecond: BITS_PER_SECOND,
    });
    this.recorder.addEventListener('dataavailable', (event) => this.chunks.push(event.data));
    const started = performance.now();
    this.recorder.start(1000);
    this.unsubscribe = this.vcam.onRender((time) => {
      const frame = this.vcam.groundTruth();
      truth.samples.push({
        t: (time - started) / 1000,
        page: frame.page,
        modelView: frame.modelView,
      });
    });
  }

  stop(): Promise<Recording> {
    const recorder = this.recorder;
    const truth = this.truth;
    if (!recorder || !truth) return Promise.reject(new Error('Not recording'));
    this.unsubscribe?.();
    return new Promise((resolve) => {
      recorder.addEventListener(
        'stop',
        () => {
          for (const track of this.stream?.getTracks() ?? []) track.stop();
          const video = new Blob(this.chunks, { type: recorder.mimeType });
          this.recorder = null;
          this.stream = null;
          this.truth = null;
          resolve({ video, truth });
        },
        { once: true },
      );
      recorder.stop();
    });
  }
}

export interface SavedRecording {
  /** Where it was saved (repository-relative), or the downloaded file name. */
  path: string;
  seconds: number;
  frames: number;
}

/**
 * Saves a recording through the virtual camera dev server (journey-ar/tests/recordings/
 * <name>.webm and <name>.json); where that endpoint is missing, downloads both files instead.
 */
export async function saveRecording(name: string, recording: Recording): Promise<SavedRecording> {
  const truth = new Blob([JSON.stringify(recording.truth)], { type: 'application/json' });
  const summary = {
    seconds: recording.truth.samples.at(-1)?.t ?? 0,
    frames: recording.truth.samples.length,
  };
  try {
    const responses = await Promise.all([
      fetch(`/__recordings/${name}.webm`, { method: 'POST', body: recording.video }),
      fetch(`/__recordings/${name}.json`, { method: 'POST', body: truth }),
    ]);
    if (responses.every((r) => r.ok)) {
      const { path } = (await responses[0]!.json()) as { path: string };
      return { path, ...summary };
    }
  } catch {
    // no endpoint: download instead
  }
  for (const [blob, file] of [
    [recording.video, `${name}.webm`],
    [truth, `${name}.json`],
  ] as const) {
    const link = Object.assign(document.createElement('a'), {
      href: URL.createObjectURL(blob),
      download: file,
    });
    link.click();
    URL.revokeObjectURL(link.href);
  }
  return { path: `${name}.webm`, ...summary };
}
