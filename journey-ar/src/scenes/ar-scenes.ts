import { AnimationMixer, Group, type Object3D, PointLight, SpotLight, Vector3 } from 'three';
import { PinchScale } from '../interaction/pinch-scale';
import { loadScene } from './load-scene';
import { type SceneEntry, anchorMatrix } from './manifest';
import type { PreparedScene } from './prepare-scene';

interface MountedScene {
  entry: SceneEntry;
  prepared: PreparedScene;
  /** Places the scene on its page: target frame -> page frame (scenes.json anchor). */
  container: Group;
  mixer: AnimationMixer;
  /** The node the original PinchScale script scaled (not animated), and its own scale. */
  pinchNode: Object3D | null;
  pinchBase: Vector3;
  pinch: PinchScale;
}

export interface ArScenesState {
  /** Scene of the tracked page, or null. */
  active: string | null;
  /** The active scene is loaded and on screen. */
  shown: boolean;
  loaded: string[];
  /** Animation time of the shown scene, seconds since it appeared. */
  time: number;
  /** Pinch scale of the shown scene (1: original size). */
  scale: number;
}

/**
 * The AR scenes on the tracked page (page frame: `anchor`, posed by the tracker). A scene is
 * shown while its page is tracked and hidden at once when the page is lost; every new detection
 * starts its animations and texture scrolling from the beginning. Scenes load lazily, on the
 * first detection of their page, and in the background with preloadAll().
 *
 * Pinching scales the scene's pinch node (scenes.json `pinch`) about its own origin, within the
 * original limits; the size goes back to 1 on every detection.
 */
export class ArScenes {
  private readonly loads = new Map<string, Promise<MountedScene>>();
  private readonly loaded = new Set<string>();
  private active: MountedScene | null = null;
  private activeId: string | null = null;

  constructor(
    private readonly anchor: Group,
    private readonly scenes: readonly SceneEntry[],
    private readonly baseUrl: string,
    private readonly onError: (error: unknown) => void,
  ) {}

  /** Loads the scenes one after another (book order), so they are ready when their page shows. */
  async preloadAll(): Promise<void> {
    for (const { id } of this.scenes) await this.load(id).catch(this.onError);
  }

  /** Shows the scene of the tracked page; null hides the current one. */
  setTracked(id: string | null): void {
    if (id === this.activeId) return;
    if (this.active) {
      this.active.container.visible = false;
      this.active.mixer.stopAllAction();
    }
    this.active = null;
    this.activeId = id;
    if (!id) return;
    this.load(id).then((scene) => {
      // The page may have been lost (or another found) while the scene was loading.
      if (this.activeId === id) this.start(scene);
    }, this.onError);
  }

  update(deltaSeconds: number): void {
    if (!this.active) return;
    this.active.mixer.update(deltaSeconds);
    this.active.prepared.update(deltaSeconds);
    if (this.active.pinch.tick(deltaSeconds)) this.applyPinch(this.active);
  }

  pinchBegin(): void {
    this.active?.pinch.begin();
  }

  pinchChange(ratio: number): void {
    if (!this.active) return;
    this.active.pinch.change(ratio);
    this.applyPinch(this.active);
  }

  pinchEnd(): void {
    this.active?.pinch.end();
  }

  get state(): ArScenesState {
    return {
      active: this.activeId,
      shown: this.active?.container.visible ?? false,
      loaded: [...this.loaded],
      time: this.active?.mixer.time ?? 0,
      scale: this.active?.pinch.factor ?? 1,
    };
  }

  private load(id: string): Promise<MountedScene> {
    let pending = this.loads.get(id);
    if (!pending) {
      const entry = this.scenes.find((s) => s.id === id);
      if (!entry) return Promise.reject(new Error(`Unknown scene "${id}"`));
      const url = new URL(entry.model, new URL(this.baseUrl, window.location.href)).href;
      pending = loadScene(url).then((prepared) => this.mount(entry, prepared));
      this.loads.set(id, pending);
    }
    return pending;
  }

  private mount(entry: SceneEntry, prepared: PreparedScene): MountedScene {
    const container = new Group();
    container.name = `scene:${entry.id}`;
    container.matrixAutoUpdate = false;
    container.matrix.copy(anchorMatrix(entry.anchor));
    container.visible = false;
    container.add(prepared.root);
    // Unity light ranges are world distances, exported in target units (target width = 1);
    // the page frame is in millimetres. Ranges do not follow the pinch scale, as in Unity.
    prepared.root.traverse((object) => {
      if (object instanceof PointLight || object instanceof SpotLight) {
        object.distance *= entry.anchor.width;
      }
    });
    this.anchor.add(container);
    this.loaded.add(entry.id);
    const pinchNode = prepared.root.getObjectByName(entry.pinch.node) ?? null;
    if (!pinchNode) console.warn(`Scene "${entry.id}": no pinch node "${entry.pinch.node}"`);
    return {
      entry,
      prepared,
      container,
      mixer: new AnimationMixer(prepared.root),
      pinchNode,
      pinchBase: pinchNode ? pinchNode.scale.clone() : new Vector3(1, 1, 1),
      pinch: new PinchScale(entry.pinch),
    };
  }

  private applyPinch(scene: MountedScene): void {
    scene.pinchNode?.scale.copy(scene.pinchBase).multiplyScalar(scene.pinch.factor);
  }

  private start(scene: MountedScene): void {
    scene.mixer.stopAllAction();
    for (const clip of scene.prepared.animations) scene.mixer.clipAction(clip).reset().play();
    scene.mixer.setTime(0);
    scene.prepared.restart();
    scene.pinch.reset();
    this.applyPinch(scene);
    scene.container.visible = true;
    this.active = scene;
  }
}
