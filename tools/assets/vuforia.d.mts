// Types of vuforia.mjs for the TypeScript unit tests.
export interface VuforiaTarget {
  name: string;
  size: [number, number];
  texture: Buffer;
}

export function readVuforiaTargets(apkPath: string): VuforiaTarget[];
