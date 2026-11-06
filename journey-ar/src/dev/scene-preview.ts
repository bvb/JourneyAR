// Dev-only page: renders an exported scene with three.js from exactly the camera of the Unity
// reference render and shows both side by side. Usage: /scene-preview.html?scene=creature&t=0.5
import {
  AnimationMixer,
  BufferGeometry,
  Color,
  DoubleSide,
  Float32BufferAttribute,
  Mesh,
  MeshBasicMaterial,
  MeshLambertMaterial,
  NoColorSpace,
  PerspectiveCamera,
  Scene,
  TextureLoader,
  WebGLRenderer,
} from 'three';
import { configureLegacyRendering } from '../scenes/legacy-rendering';
import { loadScene } from '../scenes/load-scene';
import { unityToThree } from '../scenes/unity-space';
import type { ReferenceFile, ReferenceTarget } from './reference';

const PIPELINE = '/__pipeline';
let referenceDir = 'reference';

function element<T extends HTMLElement>(id: string): T {
  const found = document.getElementById(id);
  if (!found) throw new Error(`#${id} not found`);
  return found as T;
}

/** Raw gamma-space colour, as Unity used it (the renderer runs in the gamma workflow). */
function gamma(color: number[]): Color {
  return new Color(color[0] ?? 0, color[1] ?? 0, color[2] ?? 0);
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
  // Same look as in Unity: the Vuforia plane uses Legacy Diffuse, lit by the scene's lights.
  const color = gamma(page.color ?? [1, 1, 1]);
  const material = page.shader?.includes('Diffuse')
    ? new MeshLambertMaterial({ side: DoubleSide, color })
    : new MeshBasicMaterial({ side: DoubleSide, color });
  if (page.image) {
    const texture = await new TextureLoader().loadAsync(
      `${PIPELINE}/${referenceDir}/${page.image}`,
    );
    texture.colorSpace = NoColorSpace;
    material.map = texture;
  }
  return new Mesh(geometry, material);
}

/**
 * Pixel difference between the Unity reference and the three.js render, over the pixels where
 * either image differs from the background. Draws |difference| x4 into #diff.
 */
async function compareImages(
  reference: HTMLImageElement,
  render: HTMLCanvasElement,
  background: number[],
): Promise<{ meanAbs: number; over32: number }> {
  await reference.decode();
  const { width, height } = render;
  const read = (source: CanvasImageSource) => {
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext('2d')!;
    context.drawImage(source, 0, 0, width, height);
    return context.getImageData(0, 0, width, height).data;
  };
  const a = read(reference);
  const b = read(render);
  const bg = background.slice(0, 3).map((c) => Math.round(c * 255));
  const isBackground = (data: Uint8ClampedArray, i: number) =>
    Math.abs(data[i]! - bg[0]!) +
      Math.abs(data[i + 1]! - bg[1]!) +
      Math.abs(data[i + 2]! - bg[2]!) <
    12;

  const diffCanvas = element<HTMLCanvasElement>('diff');
  diffCanvas.width = width;
  diffCanvas.height = height;
  const diffContext = diffCanvas.getContext('2d')!;
  const diff = diffContext.createImageData(width, height);
  let sum = 0;
  let count = 0;
  let over32 = 0;
  for (let i = 0; i < a.length; i += 4) {
    diff.data[i + 3] = 255;
    if (isBackground(a, i) && isBackground(b, i)) continue;
    const d =
      (Math.abs(a[i]! - b[i]!) +
        Math.abs(a[i + 1]! - b[i + 1]!) +
        Math.abs(a[i + 2]! - b[i + 2]!)) /
      3;
    sum += d;
    count += 1;
    if (d > 32) over32 += 1;
    diff.data[i] = diff.data[i + 1] = diff.data[i + 2] = Math.min(255, d * 4);
  }
  diffContext.putImageData(diff, 0, 0);
  return { meanAbs: count ? sum / count : 0, over32: count ? over32 / count : 0 };
}

async function main(): Promise<void> {
  const params = new URLSearchParams(window.location.search);
  const id = params.get('scene') ?? 'architecture';
  const source = params.get('src') ?? `${PIPELINE}/export/${id}.glb`;
  // Debugging aid: ?ref=<dir> compares against another set of Unity renders in tools/.out.
  referenceDir = params.get('ref') ?? 'reference';

  const reference = (await fetch(`${PIPELINE}/${referenceDir}/reference.json`).then((r) =>
    r.json(),
  )) as ReferenceFile;
  const target = reference.targets.find((t) => t.id === id);
  if (!target) throw new Error(`No reference render for scene "${id}"`);
  const time = Number(params.get('t') ?? target.time);

  element('title').textContent = `${id} (${target.root}), t = ${time}s`;
  element<HTMLImageElement>('unity').src = `${PIPELINE}/${referenceDir}/${target.image}`;

  const renderer = new WebGLRenderer({
    canvas: element<HTMLCanvasElement>('three'),
    antialias: true,
    preserveDrawingBuffer: true,
  });
  renderer.setPixelRatio(1);
  renderer.setSize(reference.width, reference.height, false);

  const scene = new Scene();
  scene.background = gamma(reference.background);

  const { fov, near, far, position, target: lookAt, up } = target.camera;
  const camera = new PerspectiveCamera(fov, reference.width / reference.height, near, far);
  camera.position.copy(unityToThree(position));
  camera.up.copy(unityToThree(up));
  camera.lookAt(unityToThree(lookAt));
  camera.updateMatrixWorld();
  configureLegacyRendering(renderer, camera);

  const page = await createPage(target);
  if (page) scene.add(page);

  // GLTFLoader resolves only after the embedded textures are decoded.
  const loaded = await loadScene(source);
  scene.add(loaded.root);
  // Script effects (UV scrolling) at the same time as the reference render.
  loaded.update(time);

  // Debugging aid: ?hide=<material>,<material> hides meshes by (Unity) material name.
  const hidden = new Set((params.get('hide') ?? '').split(',').filter(Boolean));
  loaded.root.traverse((object) => {
    const material = (object as Mesh).material as { name?: string } | undefined;
    if (material?.name && hidden.has(material.name)) object.visible = false;
  });

  const mixer = new AnimationMixer(loaded.root);
  for (const clip of loaded.animations) mixer.clipAction(clip).play();
  mixer.setTime(time);

  renderer.render(scene, camera);
  const { triangles, calls } = renderer.info.render;
  const difference = await compareImages(
    element<HTMLImageElement>('unity'),
    renderer.domElement,
    reference.background,
  );

  window.__preview = {
    ready: true,
    scene: id,
    time,
    triangles,
    drawCalls: calls,
    animations: loaded.animations.map((a) => ({ name: a.name, duration: a.duration })),
    unknownShaders: loaded.unknownShaders,
    difference,
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
    unknownShaders: [],
    difference: { meanAbs: 0, over32: 0 },
  };
  element('info').textContent = `Error: ${message}`;
  throw error;
});
