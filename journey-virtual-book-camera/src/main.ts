import { Color, GridHelper, PerspectiveCamera, Scene, WebGLRenderer } from 'three';

// Phase 0 placeholder. Phase 3 replaces this with the page scene, controls and stream output.
const canvas = document.querySelector<HTMLCanvasElement>('#view');
if (!canvas) throw new Error('Canvas #view not found');

const renderer = new WebGLRenderer({ canvas, antialias: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));

const scene = new Scene();
scene.background = new Color(0x202020);
scene.add(new GridHelper(1, 10, 0x888888, 0x444444));

const camera = new PerspectiveCamera(50, 1, 0.01, 10);
camera.position.set(0, 0.5, 0.6);
camera.lookAt(0, 0, 0);

function resize(): void {
  renderer.setSize(window.innerWidth, window.innerHeight, false);
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
}
window.addEventListener('resize', resize);
resize();

renderer.setAnimationLoop(() => renderer.render(scene, camera));
