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
import { SPATIAL } from './audio/loop-bounds';
import { SceneAudio } from './audio/scene-audio';
import { parseFrameSource } from './config/frame-source';
import { parseTrackingOptions } from './config/tracking-options';
import { installTestHooks } from './debug/test-hooks';
import { pagePointAt } from './interaction/page-point';
import { type ScreenPoint, attachSceneGestures } from './interaction/scene-gestures';
import { ArScenes } from './scenes/ar-scenes';
import { GpuFrameGrabber } from './render/gpu-frame-grabber';
import { VideoBackground } from './render/video-background';
import { configureLegacyRendering } from './scenes/legacy-rendering';
import { loadScenesManifest } from './scenes/manifest';
import { type FrameSource, createFrameSource } from './sources/frame-source';
import './style.css';
import { CanvasFrameGrabber } from './tracking/frame-grabber';
import { PoseSmoother } from './tracking/pose-smoother';
import { TrackingLoop } from './tracking/tracking-loop';
import { PendingLoads } from './ui/pending-loads';
import { StartButton } from './ui/start-button';

const canvas = document.querySelector<HTMLCanvasElement>('#scene');
if (!canvas) throw new Error('Canvas #scene not found');

const source = parseFrameSource(window.location.search, import.meta.env.DEV);
// ?debug: page outline and axes on the tracked page, and the outline of its NFT marker when the
// marker is a part of the page.
const debug = new URLSearchParams(window.location.search).has('debug');
const trackingOptions = parseTrackingOptions(window.location.search);
const manifest = await loadScenesManifest(`${import.meta.env.BASE_URL}scenes.json`);

// An opaque context: the camera picture is drawn in the canvas (VideoBackground), not under it.
// (three.js creates its own context with alpha and only clears it opaque.)
const context = canvas.getContext('webgl2', {
  alpha: false,
  antialias: true,
  depth: true,
  stencil: false,
  premultipliedAlpha: true,
  preserveDrawingBuffer: false,
});
if (!context) throw new Error('WebGL 2 is not available');
const renderer = new WebGLRenderer({ canvas, context, antialias: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));

const scene = new Scene();
// The projection comes from the tracker (the camera of the processing frame, fitted to the
// screen); the camera itself stays at the origin, and the anchor carries the page pose.
const camera = new PerspectiveCamera();
camera.matrixAutoUpdate = false;
// The AR content is rendered like the original Unity build (gamma workflow), see CLAUDE.md.
configureLegacyRendering(renderer, camera);

// Page anchor in the page frame (mm, origin at the page centre, Y to the page top), posed by
// the tracker. It carries the AR scenes and, with ?debug, the page and marker outlines and axes.
const anchor = new Group();
anchor.matrixAutoUpdate = false;
anchor.visible = false;
const { width: pageWidth, height: pageHeight } = manifest.page;
const debugGroup = new Group();
debugGroup.visible = debug;
anchor.add(debugGroup);
/** Corners of a rectangle in the page frame (mm), for an outline. */
function rectangle(center: readonly number[], width: number, height: number): Vector3[] {
  return [
    [-1, -1],
    [1, -1],
    [1, 1],
    [-1, 1],
  ].map(([x, y]) => new Vector3(center[0]! + (x! * width) / 2, center[1]! + (y! * height) / 2, 0));
}
const markerOutlines = new Map(
  manifest.scenes
    .filter(({ marker }) => marker.size[0] < pageWidth - 1 || marker.size[1] < pageHeight - 1)
    .map(({ id, marker }) => {
      const outline = new LineLoop(
        new BufferGeometry().setFromPoints(rectangle(marker.center, ...marker.size)),
        new LineBasicMaterial({ color: 0xffb000 }),
      );
      outline.visible = false;
      return [id, outline];
    }),
);
debugGroup.add(
  new LineLoop(
    new BufferGeometry().setFromPoints(rectangle([0, 0], pageWidth, pageHeight)),
    new LineBasicMaterial({ color: 0x00e0ff }),
  ),
  new AxesHelper(60),
  ...markerOutlines.values(),
);
scene.add(anchor);

// The camera picture, drawn behind the AR content (the <video> element only decodes it).
const video = document.querySelector<HTMLVideoElement>('#video')!;
const background = new VideoBackground(video);
scene.add(background.mesh);
// The tracker's frames: made on the GPU from the background's video texture (see the grabbers),
// unless WebGL runs in software (SwiftShader, llvmpipe: no GPU to spare, and the asynchronous
// read-back there is slow) or ?grab=canvas.
const debugInfo = context.getExtension('WEBGL_debug_renderer_info');
const glRenderer = debugInfo
  ? String(context.getParameter(debugInfo.UNMASKED_RENDERER_WEBGL))
  : String(context.getParameter(context.RENDERER));
const softwareGl = /swiftshader|llvmpipe|software/i.test(glRenderer);
const grabber =
  trackingOptions.grab === 'canvas' || softwareGl
    ? new CanvasFrameGrabber()
    : new GpuFrameGrabber(renderer, background.texture);

// What loads after Start: the NFT markers (the tracker), the scene models and the
// soundtracks. A light runs round the Start button until they are all in.
const loads = new PendingLoads();
loads.add('nft');
for (const { id } of manifest.scenes) {
  loads.add(`model:${id}`);
  loads.add(`audio:${id}`);
}

// Errors go to the console; on screen, the Start button's rim turns red until the next Start.
let failed = false;
function reportError(what: string, error: unknown): void {
  console.error(`${what}:`, error);
  if (failed) return;
  failed = true;
  renderButton();
}

const arScenes = new ArScenes(
  anchor,
  manifest,
  import.meta.env.BASE_URL,
  (error) => reportError('Scene', error),
  loads,
);
let preloading = false;

// Scene soundtracks, spatial: unlocked by the Start button (a user gesture).
const audio = new SceneAudio(
  manifest.scenes,
  import.meta.env.BASE_URL,
  (error) => reportError('Sound', error),
  loads,
);
let trackedScene: string | null = null;
const soundPoint = new Vector3();
document.addEventListener('visibilitychange', () => {
  if (document.hidden) audio.suspend();
  else if (running) audio.resume();
});

// The point of the page plane under a point of the screen, as the page is shown now.
function pageUnder(point: ScreenPoint): Vector3 | null {
  if (!anchor.visible) return null;
  const rect = canvas!.getBoundingClientRect();
  let x = ((point.x - rect.left) / rect.width) * 2 - 1;
  const y = 1 - ((point.y - rect.top) / rect.height) * 2;
  if (canvas!.classList.contains('mirrored')) x = -x;
  return pagePointAt(x, y, anchor.matrix, camera.projectionMatrixInverse);
}

// Placing the shown scene: pinch to scale, drag to move it along the page (the page point under
// the fingers follows them), double tap to reset. Wheel or trackpad and the mouse on a PC.
attachSceneGestures(canvas, {
  scaleBegin: () => arScenes.pinchBegin(),
  scaleChange: (ratio) => arScenes.pinchChange(ratio),
  scaleEnd: () => arScenes.pinchEnd(),
  move(from, to) {
    const a = pageUnder(from);
    const b = pageUnder(to);
    if (a && b) arScenes.moveBy(b.x - a.x, b.y - a.y);
  },
  reset: () => arScenes.resetPlacement(),
});

function resize(): void {
  renderer.setSize(window.innerWidth, window.innerHeight, false);
}
window.addEventListener('resize', resize);
resize();

const hooks = installTestHooks({
  ready: false,
  webglVersion: renderer.capabilities.isWebGL2 ? 2 : 1,
  framesRendered: 0,
  trianglesRendered: 0,
  source,
  sourceState: 'idle',
  videoFrames: 0,
  videoSize: null,
  tracking: {
    ready: false,
    processed: 0,
    scene: null,
    pose: null,
    shownPose: null,
    error: null,
    events: [],
    processMs: [],
  },
  scenes: arScenes.state,
});
if (hooks) {
  Object.defineProperty(hooks, 'audio', { get: () => audio.state });
  Object.defineProperty(hooks, 'loading', {
    get: () => ({ complete: loads.complete, pending: loads.count }),
  });
}

// Frame source: started and stopped with the button (the camera needs a user gesture, and so
// will the audio on iOS).
const startButton = new StartButton(document.querySelector<HTMLButtonElement>('#start')!, press);
let frameSource: FrameSource | null = null;
let tracking: TrackingLoop | null = null;
const smoother = new PoseSmoother(trackingOptions.smoothing);
let running = false;
let starting = false;

function renderButton(): void {
  startButton.render({ running, starting, loading: starting || !loads.complete, error: failed });
}
loads.subscribe(renderButton);
renderButton();

function setState(state: NonNullable<typeof hooks>['sourceState']): void {
  if (hooks) hooks.sourceState = state;
  running = state === 'running' || state === 'starting';
  starting = state === 'starting';
  renderButton();
}

function startTracking(sourceInUse: FrameSource): void {
  tracking = new TrackingLoop({
    video,
    scenes: manifest.scenes,
    baseUrl: import.meta.env.BASE_URL,
    filter: trackingOptions.filter,
    fieldOfView: trackingOptions.fieldOfView,
    sourceFocal: sourceInUse.focal,
    grabber,
    onResult(result) {
      // The first result: the tracker has its NFT markers.
      loads.done('nft');
      // A page found (again) starts the smoothing over; the anchor follows in the render loop.
      if (result.transitions.some((t) => t.type === 'found')) smoother.reset();
      if (result.pose) smoother.addPose(result.pose, performance.now());
      anchor.visible = result.pose !== null;
      for (const [id, outline] of markerOutlines) outline.visible = id === result.scene;
      arScenes.setTracked(result.scene);
      audio.setTracked(result.scene);
      trackedScene = result.scene;
      // Preload the scenes once the tracker runs: it gets the CPU first on a phone.
      if (!preloading) {
        preloading = true;
        void arScenes.preloadAll();
      }
      if (hooks) {
        const t = hooks.tracking;
        t.ready = true;
        t.processed += 1;
        t.scene = result.scene;
        t.pose = result.pose ? Array.from(result.pose) : null;
        t.error = result.error;
        t.processMs.push(result.processMs);
        if (t.processMs.length > 300) t.processMs.shift();
        for (const { type, scene: id } of result.transitions) {
          t.events.push({ type, scene: id, time: performance.now() });
        }
      }
    },
    onError: (error) => reportError('Tracking', error),
  });
  tracking.start();
}

function stopTracking(): void {
  void tracking?.dispose().catch(() => undefined);
  tracking = null;
  anchor.visible = false;
  arScenes.setTracked(null);
  audio.setTracked(null);
  trackedScene = null;
}

async function startSource(): Promise<void> {
  setState('starting');
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
    setState('error');
    reportError('Camera', error);
  }
}

/** Start or Stop pressed (called within the click, see StartButton). */
function press(): void {
  if (running) {
    stopTracking();
    frameSource?.stop();
    setState('idle');
  } else {
    // A new attempt: earlier errors are no longer shown.
    failed = false;
    // Synchronously in the click: iOS allows audio only from within the user gesture.
    audio.unlock();
    void startSource();
    audio.preload();
  }
}

// Drawn at the camera's frame rate: on a display frame after a new video frame, at most
// MAX_FPS times a second (a 30 fps camera on a 60-120 Hz screen: 30 draws a second, not 60-120).
const MAX_FPS = 60;
const MIN_FRAME_MS = 1000 / MAX_FPS - 2;
// Longest step of the animations and the smoothing (after a pause, no jump).
const MAX_STEP_SECONDS = 0.25;
let newVideoFrame = false;
const onVideoFrame = (): void => {
  newVideoFrame = true;
  if (hooks) {
    hooks.videoFrames += 1;
    hooks.videoSize = [video.videoWidth, video.videoHeight];
  }
  video.requestVideoFrameCallback(onVideoFrame);
};
video.requestVideoFrameCallback(onVideoFrame);

let lastTime: number | null = null;
renderer.setAnimationLoop((time) => {
  if (hooks) hooks.ready = true;
  background.update(window.innerWidth, window.innerHeight, running);
  // The canvas shows once the camera picture is there; until then, the Journey picture.
  document.body.classList.toggle('camera-on', background.mesh.visible);
  if (!newVideoFrame || (lastTime !== null && time - lastTime < MIN_FRAME_MS)) return;
  newVideoFrame = false;
  const deltaSeconds = lastTime === null ? 0 : Math.min((time - lastTime) / 1000, MAX_STEP_SECONDS);
  lastTime = time;
  arScenes.update(deltaSeconds);
  if (anchor.visible) {
    smoother.frame(deltaSeconds, anchor.matrix);
    if (hooks) hooks.tracking.shownPose = anchor.matrix.toArray();
    // The sound comes from above the scene's centre on the page (camera frame, metres).
    const center = trackedScene ? arScenes.centerOf(trackedScene) : null;
    if (center) {
      soundPoint
        .set(center[0], center[1], SPATIAL.height)
        .applyMatrix4(anchor.matrix)
        .multiplyScalar(0.001);
      audio.setSourcePosition(soundPoint.x, soundPoint.y, soundPoint.z);
    }
  }
  const tracker = tracking?.activeTracker;
  const geometry = tracking?.geometry;
  if (tracker && geometry) {
    // The video is shown cropped to cover the view (VideoBackground); the projection is fitted
    // the same way.
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
    hooks.trianglesRendered = renderer.info.render.triangles;
    hooks.scenes = arScenes.state;
  }
});
