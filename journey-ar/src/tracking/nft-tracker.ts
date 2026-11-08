import {
  type FilterConfig,
  type FrameGeometry,
  type NFTTrackerWorker,
  type TrackerFrame,
  type Viewport,
  createNFTTrackerWorker,
} from '@webarkit/jsartoolkit-nft/client';
import { type SceneEntry, type SceneMarker, markerToPage } from '../scenes/manifest';
import { type Intrinsics, cameraParamBytes } from './camera-params';
import { PageSelector } from './page-selector';

// While the shown page is suspicious (see PageSelector), search for the other pages this often.
const VERIFY_INTERVAL_MS = 500;

// ARLogLevel.Error: the core logs every loaded image level and feature set at Info.
const LOG_ERRORS_ONLY = 3;

export interface TrackerSetup {
  intrinsics: Intrinsics;
  scenes: readonly SceneEntry[];
  /** App base URL: the markers and the worker files are loaded relative to it. */
  baseUrl: string;
  filter: FilterConfig;
}

export interface TrackingResult {
  /** The scene whose page is tracked in this frame, or null. */
  scene: string | null;
  /**
   * Page to camera transform of that page (column-major, mm, OpenGL camera axes; origin at
   * the page centre, Y to the page top).
   */
  pose: Float64Array | null;
  /** Tracking error of that page reported by the core (lower is better), or null. */
  error: number | null;
  transitions: { type: 'found' | 'lost'; scene: string }[];
  processMs: number;
}

/**
 * NFT tracking of the book pages with jsartoolkit-nft in a worker. All markers are loaded,
 * but one page is active at a time: while a page is tracked, no other page is searched for
 * (continuousDetection off) unless it tracks with a high error (PageSelector), and the page
 * counts as lost on its first untracked frame. A marker covers its whole page or a part of it
 * (scenes.json `marker`); the results are page poses either way.
 */
export class NftTracker {
  private readonly selector = new PageSelector();
  private verifying = false;

  private constructor(
    private readonly worker: NFTTrackerWorker,
    private readonly scenesById: Map<number, string>,
    private readonly markers: Map<string, SceneMarker>,
    readonly intrinsics: Intrinsics,
  ) {}

  static async create(setup: TrackerSetup): Promise<NftTracker> {
    const base = new URL(setup.baseUrl, window.location.href);
    const worker = await createNFTTrackerWorker(
      {
        width: setup.intrinsics.width,
        height: setup.intrinsics.height,
        cameraParam: cameraParamBytes(setup.intrinsics),
        lostTimeout: 0,
        continuousDetection: false,
        filter: setup.filter,
        near: 10,
        far: 10_000,
        logLevel: LOG_ERRORS_ONLY,
      },
      { workerBase: new URL('nft-worker/', base) },
    );
    const loads = await worker.addNFTTargets(
      setup.scenes.map((scene) => new URL(scene.nft, base).href),
      { origin: 'corner', probeZFT: false },
    );
    const scenesById = new Map<number, string>();
    loads.forEach((load, i) => {
      const scene = setup.scenes[i]!;
      if (load.status !== 'loaded') {
        throw new Error(`NFT marker of "${scene.id}" failed to load: ${load.message}`);
      }
      scenesById.set(load.info.id, scene.id);
    });
    const markers = new Map(setup.scenes.map((scene) => [scene.id, scene.marker]));
    return new NftTracker(worker, scenesById, markers, setup.intrinsics);
  }

  /** Tracks one frame; null when the worker was still busy with the previous one. */
  async process(frame: TrackerFrame, timestampMs: number): Promise<TrackingResult | null> {
    const result = await this.worker.process(frame, timestampMs);
    if (result.skipped) return null;
    const found = result.targets.filter((target) => target.found && target.pose);
    const selection = this.selector.select(
      found.map((target) => ({ scene: this.scenesById.get(target.id)!, error: target.error })),
    );
    if (selection.verify !== this.verifying) {
      this.verifying = selection.verify;
      // Not awaited: it fails only when the tracker is disposed meanwhile (stop, new tracker).
      this.worker
        .configure({ continuousDetection: selection.verify, detectionInterval: VERIFY_INTERVAL_MS })
        .catch(() => undefined);
    }
    const scene = selection.candidate?.scene ?? null;
    const pick = found.find((target) => this.scenesById.get(target.id) === scene);
    return {
      scene,
      pose: scene && pick?.pose ? markerToPage(pick.pose, this.markers.get(scene)!) : null,
      error: pick?.error ?? null,
      transitions: selection.transitions,
      processMs: result.processMs,
    };
  }

  /** Projection matrix (column-major) for showing the frame in `viewport`. */
  projectionFor(viewport: Viewport, geometry?: FrameGeometry): Float64Array {
    return this.worker.projectionFor(viewport, geometry);
  }

  dispose(): Promise<void> {
    return this.worker.dispose();
  }
}
