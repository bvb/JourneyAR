import {
  BoxGeometry,
  Mesh,
  MeshNormalMaterial,
  PerspectiveCamera,
  Scene,
  WebGLRenderer,
} from 'three';
import { parseFrameSource } from './config/frame-source';
import { installTestHooks } from './debug/test-hooks';
import { type FrameSource, createFrameSource } from './sources/frame-source';
import './style.css';

const canvas = document.querySelector<HTMLCanvasElement>('#scene');
if (!canvas) throw new Error('Canvas #scene not found');

const source = parseFrameSource(window.location.search, import.meta.env.DEV);

const renderer = new WebGLRenderer({ canvas, antialias: true, alpha: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));

const scene = new Scene();
const camera = new PerspectiveCamera(60, 1, 0.01, 100);
camera.position.set(0, 0, 3);

// Placeholder content until the AR scenes arrive (phase 4): proves WebGL works on the device.
const cube = new Mesh(new BoxGeometry(1, 1, 1), new MeshNormalMaterial());
scene.add(cube);

function resize(): void {
  const width = window.innerWidth;
  const height = window.innerHeight;
  renderer.setSize(width, height, false);
  camera.aspect = width / height;
  camera.updateProjectionMatrix();
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
});

// Frame source: started and stopped with the button (the camera needs a user gesture, and so
// will the audio on iOS).
const video = document.querySelector<HTMLVideoElement>('#video')!;
const startButton = document.querySelector<HTMLButtonElement>('#start')!;
const status = document.querySelector<HTMLElement>('#status')!;
let frameSource: FrameSource | null = null;
let running = false;

function setState(state: NonNullable<typeof hooks>['sourceState'], message = ''): void {
  if (hooks) hooks.sourceState = state;
  running = state === 'running' || state === 'starting';
  startButton.textContent = running ? 'Стоп' : 'Старт';
  startButton.disabled = state === 'starting';
  status.textContent = message;
}

async function startSource(): Promise<void> {
  setState('starting', source.kind === 'webrtc' ? 'Ожидание виртуальной камеры…' : '');
  try {
    frameSource ??= await createFrameSource(source);
    await frameSource.start(video);
    video.classList.toggle('mirrored', frameSource.mirrored);
    setState('running');
  } catch (error) {
    frameSource?.stop();
    setState('error', error instanceof Error ? error.message : String(error));
  }
}

startButton.addEventListener('click', () => {
  if (running) {
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

renderer.setAnimationLoop((time) => {
  cube.rotation.set(time * 0.0005, time * 0.0007, 0);
  renderer.render(scene, camera);
  if (hooks) {
    hooks.framesRendered += 1;
    hooks.ready = true;
  }
});
