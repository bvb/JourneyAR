import {
  CanvasTexture,
  Color,
  Mesh,
  MeshBasicMaterial,
  PerspectiveCamera,
  PlaneGeometry,
  RepeatWrapping,
  SRGBColorSpace,
  Scene,
  type Texture,
  TextureLoader,
  WebGLRenderer,
} from 'three';
import { PAGE_IMAGES, type PageImage } from './pages';
import {
  type CameraPose,
  DEFAULT_FRAME,
  DEFAULT_POSE,
  type FrameSettings,
  MAX_TILT,
  PAGE_SIZE_MM,
  cameraMatrix,
  focalLength,
  modelViewMatrix,
  pageInView,
  projectPoint,
} from './pose';

/** The exact camera state of the last rendered frame, to compare tracking results with. */
export interface GroundTruth {
  /** Page shown, or null for a frame without a page. */
  page: string | null;
  /**
   * Page to camera transform, column-major 4x4, mm, OpenGL camera axes (X right, Y up,
   * looking down -Z); the page frame has its origin at the page centre, Y to the page top.
   */
  modelView: number[];
  width: number;
  height: number;
  /** Focal length in pixels; the principal point is the frame centre. */
  focal: number;
  /** Fraction of the page area inside the frame (0 when there is no page). */
  pageInView: number;
}

const NEAR_MM = 1;
const FAR_MM = 20_000;
const TABLE_SIZE_MM = 4000;
const TABLE_TILE_MM = 250;

/** A dark, softly blotched table under the page, so frames are not flat around it. */
function tableTexture(): CanvasTexture {
  const size = 256;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d')!;
  ctx.fillStyle = 'rgb(78, 74, 70)';
  ctx.fillRect(0, 0, size, size);
  let seed = 7;
  const random = () => {
    seed = (seed * 16807) % 2147483647;
    return seed / 2147483647;
  };
  for (let i = 0; i < 90; i += 1) {
    const x = random() * size;
    const y = random() * size;
    const radius = 10 + random() * 35;
    const level = Math.round(55 + random() * 50);
    // Draw each blotch at its wrapped positions too, so the texture tiles seamlessly.
    for (const dx of [-size, 0, size]) {
      for (const dy of [-size, 0, size]) {
        const gradient = ctx.createRadialGradient(x + dx, y + dy, 0, x + dx, y + dy, radius);
        gradient.addColorStop(0, `rgba(${level + 6}, ${level + 2}, ${level}, 0.5)`);
        gradient.addColorStop(1, `rgba(${level + 6}, ${level + 2}, ${level}, 0)`);
        ctx.fillStyle = gradient;
        ctx.fillRect(x + dx - radius, y + dy - radius, radius * 2, radius * 2);
      }
    }
  }
  const texture = new CanvasTexture(canvas);
  texture.colorSpace = SRGBColorSpace;
  texture.wrapS = RepeatWrapping;
  texture.wrapT = RepeatWrapping;
  texture.repeat.set(TABLE_SIZE_MM / TABLE_TILE_MM, TABLE_SIZE_MM / TABLE_TILE_MM);
  return texture;
}

/**
 * A book page in front of a pinhole camera: the page (303 x 226 mm, printed image, even light)
 * lies on a table in the page frame, and the camera renders frames of exactly the configured
 * size into `canvas`, with a known pose.
 */
export class VirtualCamera {
  readonly canvas: HTMLCanvasElement;
  readonly pages: readonly PageImage[];
  framesRendered = 0;

  private readonly renderer: WebGLRenderer;
  private readonly scene = new Scene();
  private readonly camera = new PerspectiveCamera();
  private readonly pageMaterial = new MeshBasicMaterial({ color: 0xffffff });
  private readonly pageMesh: Mesh;
  private readonly textures = new Map<string, Promise<Texture>>();
  private readonly listeners = new Set<() => void>();
  private readonly renderListeners = new Set<(time: number) => void>();
  private pose: CameraPose = structuredClone(DEFAULT_POSE);
  private frame: FrameSettings = { ...DEFAULT_FRAME };
  private page: string | null = null;
  private pageRequest = 0;
  private running = false;

  constructor(canvas: HTMLCanvasElement, pages: readonly PageImage[] = PAGE_IMAGES) {
    this.canvas = canvas;
    this.pages = pages;
    // preserveDrawingBuffer: frames stay readable (tests, recording) after they are shown.
    this.renderer = new WebGLRenderer({ canvas, antialias: true, preserveDrawingBuffer: true });
    this.renderer.setPixelRatio(1);
    this.scene.background = new Color(0x303030);

    this.pageMesh = new Mesh(
      new PlaneGeometry(PAGE_SIZE_MM.width, PAGE_SIZE_MM.height),
      this.pageMaterial,
    );
    this.pageMesh.visible = false;
    this.scene.add(this.pageMesh);

    const table = new Mesh(
      new PlaneGeometry(TABLE_SIZE_MM, TABLE_SIZE_MM),
      new MeshBasicMaterial({ map: tableTexture() }),
    );
    table.position.z = -0.5;
    this.scene.add(table);

    this.applyFrame();
    this.applyPose();
  }

  /** Calls `listener` after every change of page, pose or frame; returns the unsubscribe. */
  onChange(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  /** Calls `listener` after every rendered frame with its time (performance.now()). */
  onRender(listener: (time: number) => void): () => void {
    this.renderListeners.add(listener);
    return () => this.renderListeners.delete(listener);
  }

  /**
   * A video stream of the rendered frames. Without `fps`, every render() becomes a frame,
   * also in the paused (frame-by-frame) mode; with `fps`, at most that many per second.
   */
  captureStream(fps?: number): MediaStream {
    return this.canvas.captureStream(fps);
  }

  getPage(): string | null {
    return this.page;
  }

  /** Shows a page (by id) or no page (null); resolves once its image is loaded. */
  async setPage(id: string | null): Promise<void> {
    const request = ++this.pageRequest;
    if (id === null) {
      this.page = null;
      this.pageMesh.visible = false;
      this.changed();
      return;
    }
    const image = this.pages.find((p) => p.id === id);
    if (!image) throw new Error(`Unknown page "${id}"`);
    const texture = await this.loadTexture(image);
    if (request !== this.pageRequest) return; // a later call has taken over
    this.pageMaterial.map = texture;
    this.pageMaterial.needsUpdate = true;
    this.pageMesh.visible = true;
    this.page = id;
    this.changed();
  }

  getPose(): CameraPose {
    return structuredClone(this.pose);
  }

  setPose(patch: Partial<CameraPose>): void {
    const pose = { ...this.pose, ...structuredClone(patch) };
    pose.tilt = Math.min(Math.max(pose.tilt, 0), MAX_TILT);
    pose.distance = Math.max(pose.distance, 10);
    this.pose = pose;
    this.applyPose();
    this.changed();
  }

  getFrame(): FrameSettings {
    return { ...this.frame };
  }

  setFrame(patch: Partial<FrameSettings>): void {
    this.frame = { ...this.frame, ...patch };
    this.applyFrame();
    this.changed();
  }

  groundTruth(): GroundTruth {
    const modelView = modelViewMatrix(this.pose);
    return {
      page: this.page,
      modelView: modelView.toArray(),
      width: this.frame.width,
      height: this.frame.height,
      focal: focalLength(this.frame),
      pageInView: this.page ? pageInView(modelView, this.frame) : 0,
    };
  }

  /** Pixel position of a page point (mm) in the frame, or null behind the camera. */
  project(point: readonly [number, number, number]): [number, number] | null {
    return projectPoint(modelViewMatrix(this.pose), this.frame, point);
  }

  render(): void {
    this.renderer.render(this.scene, this.camera);
    this.framesRendered += 1;
    const time = performance.now();
    for (const listener of this.renderListeners) listener(time);
  }

  /** Renders continuously (one frame per display refresh) until stop(). */
  start(): void {
    this.running = true;
    this.renderer.setAnimationLoop(() => this.render());
  }

  stop(): void {
    this.running = false;
    this.renderer.setAnimationLoop(null);
  }

  get isRunning(): boolean {
    return this.running;
  }

  dispose(): void {
    this.stop();
    this.renderer.dispose();
  }

  private loadTexture(image: PageImage): Promise<Texture> {
    let texture = this.textures.get(image.id);
    if (!texture) {
      texture = new TextureLoader().loadAsync(image.url).then((loaded) => {
        loaded.colorSpace = SRGBColorSpace;
        loaded.anisotropy = this.renderer.capabilities.getMaxAnisotropy();
        return loaded;
      });
      this.textures.set(image.id, texture);
    }
    return texture;
  }

  private applyPose(): void {
    const matrix = cameraMatrix(this.pose);
    matrix.decompose(this.camera.position, this.camera.quaternion, this.camera.scale);
    this.camera.updateMatrixWorld(true);
  }

  private applyFrame(): void {
    // The drawing buffer is the frame; the page layout scales the canvas on screen.
    this.renderer.setSize(this.frame.width, this.frame.height, false);
    this.camera.fov = this.frame.fov;
    this.camera.aspect = this.frame.width / this.frame.height;
    this.camera.near = NEAR_MM;
    this.camera.far = FAR_MM;
    this.camera.updateProjectionMatrix();
  }

  private changed(): void {
    for (const listener of this.listeners) listener();
  }
}
