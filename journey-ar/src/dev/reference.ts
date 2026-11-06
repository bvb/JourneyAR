import type { Vec3 } from '../scenes/unity-space';

/** reference.json written by the Unity ReferenceRenderer (Unity coordinates, target-local frame). */
export interface ReferenceFile {
  frame: string;
  width: number;
  height: number;
  background: number[];
  targets: ReferenceTarget[];
}

export interface ReferenceTarget {
  id: string;
  trackable: string;
  root: string;
  image: string;
  time: number;
  camera: { fov: number; near: number; far: number; position: Vec3; target: Vec3; up: Vec3 };
  page: {
    vertices: Vec3[];
    uv: [number, number][];
    triangles: number[];
    image: string | null;
    imageSize: [number, number] | null;
  } | null;
  lights: {
    name: string;
    type: string;
    color: number[];
    intensity: number;
    range: number;
    spotAngle: number;
    position: Vec3;
    direction: Vec3;
    inTarget: boolean;
  }[];
  ambient: number[];
}

/** State exposed on `window.__preview` for the Playwright comparison run. */
export interface ScenePreviewState {
  ready: boolean;
  error?: string;
  scene: string;
  time: number;
  triangles: number;
  drawCalls: number;
  animations: { name: string; duration: number }[];
}

declare global {
  interface Window {
    __preview?: ScenePreviewState;
  }
}
