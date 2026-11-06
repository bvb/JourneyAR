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
});

renderer.setAnimationLoop((time) => {
  cube.rotation.set(time * 0.0005, time * 0.0007, 0);
  renderer.render(scene, camera);
  if (hooks) {
    hooks.framesRendered += 1;
    hooks.ready = true;
  }
});
