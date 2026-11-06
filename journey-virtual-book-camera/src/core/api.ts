import type { CameraPose, FrameSettings } from './pose';
import { Recorder, type SavedRecording, saveRecording } from './recorder';
import type { GroundTruth, VirtualCamera } from './virtual-camera';

/** Test and automation API of the virtual camera, installed as `window.__vcam`. */
export interface VcamApi {
  ready: boolean;
  readonly pages: string[];
  readonly canvas: HTMLCanvasElement;
  readonly framesRendered: number;
  getPage(): string | null;
  /** Shows a page by id, or no page with null; resolves once the page image is loaded. */
  setPage(id: string | null): Promise<void>;
  getPose(): CameraPose;
  setPose(pose: Partial<CameraPose>): void;
  getFrame(): FrameSettings;
  setFrame(frame: Partial<FrameSettings>): void;
  getGroundTruth(): GroundTruth;
  /** Pixel position of a page point (mm), or null behind the camera. */
  project(point: [number, number, number]): [number, number] | null;
  /** Stops (true) or resumes the render loop. While paused, only renderFrame() renders. */
  setPaused(paused: boolean): void;
  /** Renders one frame now, with the current page, pose and frame settings. */
  renderFrame(): void;
  /** Starts recording the frames (WebM) with their ground truth. */
  startRecording(): void;
  /** Stops recording and saves <name>.webm and <name>.json (see saveRecording). */
  stopRecording(name: string): Promise<SavedRecording>;
}

declare global {
  interface Window {
    __vcam?: VcamApi;
  }
}

export function createVcamApi(vcam: VirtualCamera, recorder = new Recorder(vcam)): VcamApi {
  return {
    ready: false,
    pages: vcam.pages.map((p) => p.id),
    canvas: vcam.canvas,
    get framesRendered() {
      return vcam.framesRendered;
    },
    getPage: () => vcam.getPage(),
    setPage: (id) => vcam.setPage(id),
    getPose: () => vcam.getPose(),
    setPose: (pose) => vcam.setPose(pose),
    getFrame: () => vcam.getFrame(),
    setFrame: (frame) => vcam.setFrame(frame),
    getGroundTruth: () => vcam.groundTruth(),
    project: (point) => vcam.project(point),
    setPaused: (paused) => (paused ? vcam.stop() : vcam.start()),
    renderFrame: () => vcam.render(),
    startRecording: () => recorder.start(),
    stopRecording: async (name) => saveRecording(name, await recorder.stop()),
  };
}
