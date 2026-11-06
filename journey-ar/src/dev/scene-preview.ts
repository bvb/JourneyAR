// Dev-only page: renders an exported scene with three.js from exactly the camera of the Unity
// reference render and shows both side by side. Usage: /scene-preview.html?scene=creature&t=0.5
import {
  AmbientLight,
  AnimationMixer,
  BufferGeometry,
  Color,
  DoubleSide,
  Float32BufferAttribute,
  Mesh,
  MeshBasicMaterial,
  PerspectiveCamera,
  Scene,
  SRGBColorSpace,
  TextureLoader,
  WebGLRenderer,
} from 'three';
import { loadScene } from '../scenes/load-scene';
import { unityToThree } from '../scenes/unity-space';
import type { ReferenceFile, ReferenceTarget } from './reference';

const PIPELINE = '/__pipeline';

function element<T extends HTMLElement>(id: string): T {
  const found = document.getElementById(id);
  if (!found) throw new Error(`#${id} not found`);
  return found as T;
}

function srgb(color: number[]): Color {
  return new Color().setRGB(color[0] ?? 0, color[1] ?? 0, color[2] ?? 0, SRGBColorSpace);
}

/** The Vuforia page plane with its target texture, to check that the content sits on the page. */
async function createPage(target: ReferenceTarget): Promise<Mesh | null> {
  const page = target.page;
  if (!page) return null;
  const geometry = new BufferGeometry();
  geometry.setAttribute(
    'position',
    new Float32BufferAttribute(
      page.vertices.flatMap((v) => unityToThree(v).toArray()),
      3,
    ),
  );
  geometry.setAttribute('uv', new Float32BufferAttribute(page.uv.flat(), 2));
  geometry.setIndex(page.triangles);
  const material = new MeshBasicMaterial({ side: DoubleSide, color: 0xffffff });
  if (page.image) {
    const texture = await new TextureLoader().loadAsync(`${PIPELINE}/reference/${page.image}`);
    texture.colorSpace = SRGBColorSpace;
    material.map = texture;
  }
  return new Mesh(geometry, material);
}

async function main(): Promise<void> {
  const params = new URLSearchParams(window.location.search);
  const id = params.get('scene') ?? 'architecture';
  const source = params.get('src') ?? `${PIPELINE}/export/${id}.glb`;

  const reference = (await fetch(`${PIPELINE}/reference/reference.json`).then((r) =>
    r.json(),
  )) as ReferenceFile;
  const target = reference.targets.find((t) => t.id === id);
  if (!target) throw new Error(`No reference render for scene "${id}"`);
  const time = Number(params.get('t') ?? target.time);

  element('title').textContent = `${id} (${target.root}), t = ${time}s`;
  element<HTMLImageElement>('unity').src = `${PIPELINE}/reference/${target.image}`;

  const renderer = new WebGLRenderer({
    canvas: element<HTMLCanvasElement>('three'),
    antialias: true,
    preserveDrawingBuffer: true,
  });
  renderer.setPixelRatio(1);
  renderer.setSize(reference.width, reference.height, false);

  const scene = new Scene();
  scene.background = srgb(reference.background);

  // three.js lights are physically based: diffuse = albedo * irradiance / PI.
  scene.add(new AmbientLight(srgb(target.ambient), Math.PI));

  const { fov, near, far, position, target: lookAt, up } = target.camera;
  const camera = new PerspectiveCamera(fov, reference.width / reference.height, near, far);
  camera.position.copy(unityToThree(position));
  camera.up.copy(unityToThree(up));
  camera.lookAt(unityToThree(lookAt));

  const page = await createPage(target);
  if (page) scene.add(page);

  // GLTFLoader resolves only after the embedded textures are decoded.
  const loaded = await loadScene(source);
  scene.add(loaded.root);

  const mixer = new AnimationMixer(loaded.root);
  for (const clip of loaded.animations) mixer.clipAction(clip).play();
  mixer.setTime(time);

  renderer.render(scene, camera);

  window.__preview = {
    ready: true,
    scene: id,
    time,
    triangles: renderer.info.render.triangles,
    drawCalls: renderer.info.render.calls,
    animations: loaded.animations.map((a) => ({ name: a.name, duration: a.duration })),
  };
  element('info').textContent = JSON.stringify(window.__preview, null, 2);
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  window.__preview = {
    ready: false,
    error: message,
    scene: '',
    time: 0,
    triangles: 0,
    drawCalls: 0,
    animations: [],
  };
  element('info').textContent = `Error: ${message}`;
  throw error;
});
