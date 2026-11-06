import {
  AxesHelper,
  BufferGeometry,
  Group,
  LineBasicMaterial,
  LineLoop,
  PerspectiveCamera,
  Scene,
  Vector3,
  WebGLRenderer,
} from 'three';
import { parseFrameSource } from './config/frame-source';
import { parseTrackingOptions } from './config/tracking-options';
import { installTestHooks } from './debug/test-hooks';
import { loadScenesManifest } from './scenes/manifest';
import { type FrameSource, createFrameSource } from './sources/frame-source';
import './style.css';
import { TrackingLoop } from './tracking/tracking-loop';

const canvas = document.querySelector<HTMLCanvasElement>('#scene');
if (!canvas) throw new Error('Canvas #scene not found');

const source = parseFrameSource(window.location.search, import.meta.env.DEV);
const trackingOptions = parseTrackingOptions(window.location.search);
const manifest = await loadScenesManifest(`${import.meta.env.BASE_URL}scenes.json`);

const renderer = new WebGLRenderer({ canvas, antialias: true, alpha: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));

const scene = new Scene();
// The projection comes from the tracker (the camera of the processing frame, fitted to the
// screen); the camera itself stays at the origin, and the anchor carries the page pose.
const camera = new PerspectiveCamera();
camera.matrixAutoUpdate = false;

// Page anchor in the page frame (mm, origin at the page centre, Y to the page top). Until the
// AR scenes are placed on it (next step), it shows the page outline and axes.
const anchor = new Group();
anchor.matrixAutoUpdate = false;
anchor.visible = false;
const { width: pageWidth, height: pageHeight } = manifest.page;
anchor.add(
  new LineLoop(
    new BufferGeometry().setFromPoints(
      [
        [-1, -1],
        [1, -1],
        [1, 1],
        [-1, 1],
      ].map(([x, y]) => new Vector3((x! * pageWidth) / 2, (y! * pageHeight) / 2, 0)),
    ),
    new LineBasicMaterial({ color: 0x00e0ff }),
  ),
  new AxesHelper(60),
);
scene.add(anchor);

function resize(): void {
  renderer.setSize(window.innerWidth, window.innerHeight, false);
}
window.addEventListener('resize', resize);
resize();

const hooks = installTestHooks({
  ready: false,
  webglVersion: renderer.capabilities.isWebGL2 ? 2 : 1,
  framesRendered: 0,
  source,
  sourceState: 'idle',
  videoFrames: 0,
  videoSize: null,
  tracking: { ready: false, processed: 0, scene: null, pose: null, events: [], processMs: [] },
});

// Frame source: started and stopped with the button (the camera needs a user gesture, and so
// will the audio on iOS).
const video = document.querySelector<HTMLVideoElement>('#video')!;
const startButton = document.querySelector<HTMLButtonElement>('#start')!;
const status = document.querySelector<HTMLElement>('#status')!;
let frameSource: FrameSource | null = null;
let tracking: TrackingLoop | null = null;
let running = false;

function setState(state: NonNullable<typeof hooks>['sourceState'], message = ''): void {
  if (hooks) hooks.sourceState = state;
  running = state === 'running' || state === 'starting';
  startButton.textContent = running ? 'Стоп' : 'Старт';
  startButton.disabled = state === 'starting';
  status.textContent = message;
}

function startTracking(sourceInUse: FrameSource): void {
  tracking = new TrackingLoop({
    video,
    scenes: manifest.scenes,
    baseUrl: import.meta.env.BASE_URL,
    filter: trackingOptions.filter,
    horizontalFov: trackingOptions.horizontalFov,
    sourceFocal: sourceInUse.focal,
    onResult(result) {
      anchor.visible = result.pose !== null;
      if (result.pose) anchor.matrix.fromArray(result.pose);
      if (hooks) {
        const t = hooks.tracking;
        t.ready = true;
        t.processed += 1;
        t.scene = result.scene;
        t.pose = result.pose ? Array.from(result.pose) : null;
        t.processMs.push(result.processMs);
        if (t.processMs.length > 300) t.processMs.shift();
        for (const { type, scene: id } of result.transitions) {
          t.events.push({ type, scene: id, time: performance.now() });
        }
      }
    },
    onError(error) {
      status.textContent = `Трекинг: ${error instanceof Error ? error.message : String(error)}`;
    },
  });
  tracking.start();
}

function stopTracking(): void {
  void tracking?.dispose();
  tracking = null;
  anchor.visible = false;
}

async function startSource(): Promise<void> {
  setState('starting', source.kind === 'webrtc' ? 'Ожидание виртуальной камеры…' : '');
  try {
    frameSource ??= await createFrameSource(source);
    await frameSource.start(video);
    const mirrored = frameSource.mirrored;
    video.classList.toggle('mirrored', mirrored);
    canvas!.classList.toggle('mirrored', mirrored);
    startTracking(frameSource);
    setState('running');
  } catch (error) {
    frameSource?.stop();
    setState('error', error instanceof Error ? error.message : String(error));
  }
}

startButton.addEventListener('click', () => {
  if (running) {
    stopTracking();
    frameSource?.stop();
    setState('idle');
  } else {
    void startSource();
  }
});

const countFrame = (): void => {
  if (hooks) {
    hooks.videoFrames += 1;
    hooks.videoSize = [video.videoWidth, video.videoHeight];
  }
  video.requestVideoFrameCallback(countFrame);
};
video.requestVideoFrameCallback(countFrame);

renderer.setAnimationLoop(() => {
  const tracker = tracking?.activeTracker;
  const geometry = tracking?.geometry;
  if (tracker && geometry) {
    // The video is shown with object-fit: cover, so the projection is fitted the same way.
    camera.projectionMatrix.fromArray(
      tracker.projectionFor(
        { width: window.innerWidth, height: window.innerHeight, fit: 'cover' },
        geometry,
      ),
    );
    camera.projectionMatrixInverse.copy(camera.projectionMatrix).invert();
  }
  renderer.render(scene, camera);
  if (hooks) {
    hooks.framesRendered += 1;
    hooks.ready = true;
  }
});
