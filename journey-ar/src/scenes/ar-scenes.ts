import { AnimationMixer, Group, PointLight, SpotLight } from 'three';
import { loadScene } from './load-scene';
import { type SceneEntry, anchorMatrix } from './manifest';
import type { PreparedScene } from './prepare-scene';

interface MountedScene {
  entry: SceneEntry;
  prepared: PreparedScene;
  /** Places the scene on its page: target frame -> page frame (scenes.json anchor). */
  container: Group;
  mixer: AnimationMixer;
}

export interface ArScenesState {
  /** Scene of the tracked page, or null. */
  active: string | null;
  /** The active scene is loaded and on screen. */
  shown: boolean;
  loaded: string[];
  /** Animation time of the shown scene, seconds since it appeared. */
  time: number;
}

/**
 * The AR scenes on the tracked page (page frame: `anchor`, posed by the tracker). A scene is
 * shown while its page is tracked and hidden at once when the page is lost; every new detection
 * starts its animations and texture scrolling from the beginning. Scenes load lazily, on the
 * first detection of their page, and in the background with preloadAll().
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
  }

  get state(): ArScenesState {
    return {
      active: this.activeId,
      shown: this.active?.container.visible ?? false,
      loaded: [...this.loaded],
      time: this.active?.mixer.time ?? 0,
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
    return { entry, prepared, container, mixer: new AnimationMixer(prepared.root) };
  }

  private start(scene: MountedScene): void {
    scene.mixer.stopAllAction();
    for (const clip of scene.prepared.animations) scene.mixer.clipAction(clip).reset().play();
    scene.mixer.setTime(0);
    scene.prepared.restart();
    scene.container.visible = true;
    this.active = scene;
  }
}
