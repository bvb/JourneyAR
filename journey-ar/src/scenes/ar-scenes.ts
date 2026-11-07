import { AnimationMixer, Group, Matrix4, PointLight, SpotLight } from 'three';
import { ScenePlacement } from '../interaction/scene-placement';
import { loadScene } from './load-scene';
import { type SceneEntry, type ScenesManifest, anchorMatrix } from './manifest';
import type { PendingLoads } from '../ui/pending-loads';
import { type PinchNode, pinchNode, scalePinchNode } from './pinch-pivot';
import type { PreparedScene } from './prepare-scene';
import { ResumeWindow } from './resume-window';

interface MountedScene {
  entry: SceneEntry;
  prepared: PreparedScene;
  /**
   * Places the scene on its page: target frame -> page frame (scenes.json anchor), moved by the
   * user's offset.
   */
  container: Group;
  /** Target frame -> page frame without the offset. */
  anchorMatrix: Matrix4;
  mixer: AnimationMixer;
  /** The node the original PinchScale script scaled (not animated). */
  pinch: PinchNode | null;
  placement: ScenePlacement;
}

export interface ArScenesState {
  /** Scene of the tracked page, or null. */
  active: string | null;
  /** The active scene is loaded and on screen. */
  shown: boolean;
  loaded: string[];
  /** Animation time of the shown scene, seconds since its animations started. */
  time: number;
  /** Pinch scale of the shown scene (1: original size). */
  scale: number;
  /** Offset of the shown scene on the page (page plane, mm). */
  offset: [number, number];
}

/**
 * The AR scenes on the tracked page (page frame: `anchor`, posed by the tracker). A scene is
 * shown while its page is tracked and hidden at once when the page is lost; a new detection
 * starts its animations and texture scrolling from the beginning, unless the page comes back
 * soon after it was lost (ResumeWindow): then they continue where they stopped. Scenes load
 * lazily, on the first detection of their page, and in the background with preloadAll().
 *
 * Pinching scales the scene's pinch node (scenes.json `pinch`) about its own origin or the
 * scene's pivot, within the limits, and dragging moves the scene on the page. Each scene keeps
 * its size and place across detections until resetPlacement().
 */
export class ArScenes {
  private readonly loads = new Map<string, Promise<MountedScene>>();
  private readonly mounted = new Map<string, MountedScene>();
  private active: MountedScene | null = null;
  private activeId: string | null = null;
  private readonly resumeWindow = new ResumeWindow();

  private readonly scenes: readonly SceneEntry[];

  constructor(
    private readonly anchor: Group,
    private readonly manifest: ScenesManifest,
    private readonly baseUrl: string,
    private readonly onError: (error: unknown) => void,
    /** Told when a scene has loaded (`model:<id>`). */
    private readonly pendingLoads?: PendingLoads,
  ) {
    this.scenes = manifest.scenes;
  }

  /** Loads the scenes one after another (book order), so they are ready when their page shows. */
  async preloadAll(): Promise<void> {
    for (const { id } of this.scenes) await this.load(id).catch(this.onError);
  }

  /** Shows the scene of the tracked page; null hides the current one. */
  setTracked(id: string | null): void {
    if (id === this.activeId) return;
    if (this.active) {
      // Hidden, its animations are no longer advanced: paused where they are.
      this.active.container.visible = false;
      this.resumeWindow.lose(this.active.entry.id);
    }
    this.active = null;
    this.activeId = id;
    if (!id) return;
    const resume = this.resumeWindow.resumes(id);
    this.load(id).then((scene) => {
      // The page may have been lost (or another found) while the scene was loading.
      if (this.activeId === id) this.start(scene, resume);
    }, this.onError);
  }

  update(deltaSeconds: number): void {
    if (!this.active) return;
    this.active.mixer.update(deltaSeconds);
    this.active.prepared.update(deltaSeconds);
  }

  pinchBegin(): void {
    this.active?.placement.scaleBegin();
  }

  pinchChange(ratio: number): void {
    if (!this.active) return;
    this.active.placement.scaleChange(ratio);
    this.applyPlacement(this.active);
  }

  pinchEnd(): void {
    this.active?.placement.scaleEnd();
  }

  /** Moves the shown scene on the page by (dx, dy) mm. */
  moveBy(dx: number, dy: number): void {
    if (!this.active) return;
    this.active.placement.moveBy(dx, dy);
    this.applyPlacement(this.active);
  }

  /** Puts the shown scene back to its original size and place. */
  resetPlacement(): void {
    if (!this.active) return;
    this.active.placement.reset();
    this.applyPlacement(this.active);
  }

  /** Centre of the scene's target on the page with the user's offset, mm (page frame). */
  centerOf(id: string): [number, number] | null {
    const entry = this.scenes.find((s) => s.id === id);
    if (!entry) return null;
    const offset = this.mounted.get(id)?.placement.offset ?? [0, 0];
    return [entry.anchor.center[0] + offset[0], entry.anchor.center[1] + offset[1]];
  }

  get state(): ArScenesState {
    return {
      active: this.activeId,
      shown: this.active?.container.visible ?? false,
      loaded: [...this.mounted.keys()],
      time: this.active?.mixer.time ?? 0,
      scale: this.active?.placement.scale ?? 1,
      offset: this.active ? [...this.active.placement.offset] : [0, 0],
    };
  }

  private load(id: string): Promise<MountedScene> {
    let pending = this.loads.get(id);
    if (!pending) {
      const entry = this.scenes.find((s) => s.id === id);
      if (!entry) return Promise.reject(new Error(`Unknown scene "${id}"`));
      const url = new URL(entry.model, new URL(this.baseUrl, window.location.href)).href;
      const task = `model:${id}`;
      pending = loadScene(url).then((prepared) => this.mount(entry, prepared));
      this.loads.set(id, pending);
      void pending.finally(() => this.pendingLoads?.done(task)).catch(() => undefined);
    }
    return pending;
  }

  private mount(entry: SceneEntry, prepared: PreparedScene): MountedScene {
    const container = new Group();
    container.name = `scene:${entry.id}`;
    container.matrixAutoUpdate = false;
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
    const node = prepared.root.getObjectByName(entry.pinch.node);
    if (!node) console.warn(`Scene "${entry.id}": no pinch node "${entry.pinch.node}"`);
    const { width, height } = this.manifest.page;
    const scene: MountedScene = {
      entry,
      prepared,
      container,
      anchorMatrix: anchorMatrix(entry.anchor),
      mixer: new AnimationMixer(prepared.root),
      pinch: node ? pinchNode(prepared.root, node, entry.pinch.pivot) : null,
      placement: new ScenePlacement(entry.pinch, { halfWidth: width / 2, halfHeight: height / 2 }),
    };
    this.mounted.set(entry.id, scene);
    this.applyPlacement(scene);
    return scene;
  }

  private applyPlacement(scene: MountedScene): void {
    const { scale, offset } = scene.placement;
    if (scene.pinch) scalePinchNode(scene.pinch, scale);
    scene.container.matrix.makeTranslation(offset[0], offset[1], 0).multiply(scene.anchorMatrix);
  }

  /** Shows the scene: animations from the beginning, or continued where they stopped. */
  private start(scene: MountedScene, resume: boolean): void {
    if (!resume) {
      scene.mixer.stopAllAction();
      for (const clip of scene.prepared.animations) scene.mixer.clipAction(clip).reset().play();
      scene.mixer.setTime(0);
      scene.prepared.restart();
    }
    scene.container.visible = true;
    this.active = scene;
  }
}
