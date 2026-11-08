import { existsSync, readFileSync } from 'node:fs';
import { Euler, Matrix4, Vector3 } from 'three';
import { describe, expect, it } from 'vitest';
import { anchorMatrix, markerToPage, parseScenesManifest } from '../../src/scenes/manifest';

const ASSETS = new URL('../../assets/', import.meta.url);
const PAGES = new URL('../../../original-sources/book-ar-pages/', import.meta.url);

function readJson(url: URL): unknown {
  return JSON.parse(readFileSync(url, 'utf8'));
}

interface GlbJson {
  nodes?: { name?: string }[];
  images?: { name?: string }[];
  textures?: { source?: number; extensions?: { EXT_texture_webp?: { source: number } } }[];
  materials?: { extras?: { properties?: Record<string, unknown> } }[];
}

/** The JSON chunk of a GLB file. */
function glbJson(url: URL): GlbJson {
  const bytes = readFileSync(url);
  const jsonLength = bytes.readUInt32LE(12);
  return JSON.parse(bytes.toString('utf8', 20, 20 + jsonLength)) as GlbJson;
}

/** Node names from the JSON chunk of a GLB file. */
function glbNodeNames(url: URL): string[] {
  return (glbJson(url).nodes ?? []).map((node) => node.name ?? '');
}

describe('shipped scenes.json', () => {
  const manifest = parseScenesManifest(readJson(new URL('scenes.json', ASSETS)));

  it('lists the six book scenes', () => {
    expect(manifest.scenes.map((s) => s.id).sort()).toEqual([
      'architecture',
      'character',
      'creature',
      'daqri',
      'landscape',
      'sequence',
    ]);
  });

  it.each(manifest.scenes.map((s) => [s.id, s] as const))(
    '%s references existing files',
    (_, scene) => {
      expect(existsSync(new URL(scene.model, ASSETS))).toBe(true);
      for (const ext of ['iset', 'fset', 'fset3']) {
        expect(existsSync(new URL(`${scene.nft}.${ext}`, ASSETS))).toBe(true);
      }
      expect(existsSync(new URL(scene.audio.src, ASSETS))).toBe(true);
      expect(existsSync(new URL(`Artbook_Journey-${scene.page}.jpg`, PAGES))).toBe(true);
      expect(glbNodeNames(new URL(scene.model, ASSETS))).toContain(scene.pinch.node);
    },
  );

  // The optimized models are rewritten by gltf-transform (tools/assets/optimize.mjs): the
  // Unity material extras must still name glTF textures of the same images.
  it.each(manifest.scenes.map((s) => [s.id, s] as const))(
    '%s: the material extras point at the textures they name',
    (_, scene) => {
      const json = glbJson(new URL(scene.model, ASSETS));
      let refs = 0;
      for (const material of json.materials ?? []) {
        for (const value of Object.values(material.extras?.properties ?? {})) {
          if (!value || typeof value !== 'object' || !('index' in value)) continue;
          const ref = value as { index: number | null; texture: string };
          if (ref.index === null) continue;
          const texture = json.textures?.[ref.index];
          const source = texture?.source ?? texture?.extensions?.EXT_texture_webp?.source;
          expect(source === undefined ? undefined : json.images?.[source]?.name).toBe(ref.texture);
          refs += 1;
        }
      }
      expect(refs).toBeGreaterThan(0);
    },
  );

  it('places every target on its page', () => {
    for (const { anchor } of manifest.scenes) {
      expect(Math.abs(anchor.center[0])).toBeLessThan(manifest.page.width / 2);
      expect(Math.abs(anchor.center[1])).toBeLessThan(manifest.page.height / 2);
      expect(anchor.width).toBeGreaterThan(manifest.page.width / 4);
      expect(anchor.width).toBeLessThan(manifest.page.width * 1.1);
    }
  });

  it('makes the markers of whole pages, and of the cube on the daqri page', () => {
    for (const { id, marker, anchor } of manifest.scenes) {
      if (id === 'daqri') {
        // The original Vuforia target: the anchor's square, to a pixel of the normalized page.
        expect(marker.center[0]).toBeCloseTo(anchor.center[0], 0);
        expect(marker.center[1]).toBeCloseTo(anchor.center[1], 0);
        expect(marker.size[0]).toBeCloseTo(anchor.width, 0);
        expect(marker.size[1]).toBeCloseTo(anchor.width, 0);
      } else {
        expect(marker).toEqual({ center: [0, 0], size: [303, 226] });
      }
    }
  });
});

describe('parseScenesManifest', () => {
  const valid = {
    page: { width: 303, height: 226 },
    scenes: [
      {
        id: 'a',
        page: 'page1',
        model: 'models/a.glb',
        nft: 'nft/a/a',
        marker: { center: [50, -10], size: [100, 100] },
        audio: { src: 'audio/a.mp3', volume: 1, loop: true },
        anchor: { center: [0, 0], width: 200 },
        pinch: { node: 'Root', min: 1, max: 2 },
      },
    ],
  };

  it('accepts a valid manifest', () => {
    expect(parseScenesManifest(valid)).toEqual(valid);
  });

  it('names the invalid field', () => {
    const broken = structuredClone(valid);
    (broken.scenes[0]!.anchor as { width: unknown }).width = 'wide';
    expect(() => parseScenesManifest(broken)).toThrow('scenes[0].anchor.width');
    const noSize = structuredClone(valid);
    noSize.scenes[0]!.marker.size = [100, 0];
    expect(() => parseScenesManifest(noSize)).toThrow('scenes[0].marker.size[1]');
  });

  it('rejects duplicate ids and inverted pinch limits', () => {
    expect(() =>
      parseScenesManifest({ ...valid, scenes: [...valid.scenes, ...valid.scenes] }),
    ).toThrow('unique');
    const inverted = structuredClone(valid);
    inverted.scenes[0]!.pinch.max = 0.5;
    expect(() => parseScenesManifest(inverted)).toThrow('pinch.max');
  });

  it('reads an optional pinch pivot', () => {
    const withPivot = structuredClone(valid);
    (withPivot.scenes[0]!.pinch as { pivot?: unknown }).pivot = [0.1, 0.3, -0.2];
    expect(parseScenesManifest(withPivot).scenes[0]!.pinch.pivot).toEqual([0.1, 0.3, -0.2]);
    (withPivot.scenes[0]!.pinch as { pivot?: unknown }).pivot = [0.1, 0.3];
    expect(() => parseScenesManifest(withPivot)).toThrow('pinch.pivot');
  });
});

describe('markerToPage', () => {
  // A marker 100 x 60 mm centred at (50, -10) on the page; its bottom-left corner is (0, -40).
  const marker = { center: [50, -10], size: [100, 60] } as const;
  const camera = new Matrix4()
    .makeRotationFromEuler(new Euler(0.4, -0.3, 0.2))
    .setPosition(15, -20, -400);
  const markerPose = camera.clone().multiply(new Matrix4().makeTranslation(0, -40, 0));
  const pagePose = new Matrix4().fromArray(
    markerToPage(markerPose.toArray(), { center: [...marker.center], size: [...marker.size] }),
  );

  it('gives the pose of the page whose part the marker is', () => {
    for (const [a, b] of pagePose.toArray().map((v, i) => [v, camera.elements[i]!])) {
      expect(a).toBeCloseTo(b!, 9);
    }
  });

  it('keeps a whole-page marker centred on the page origin', () => {
    const corner = new Matrix4().makeTranslation(-151.5, -113, 0);
    const pose = markerToPage(corner.toArray(), { center: [0, 0], size: [303, 226] });
    expect(Array.from(pose)).toEqual(new Matrix4().toArray());
  });
});

describe('anchorMatrix', () => {
  const matrix = anchorMatrix({ center: [10, -5], width: 200 });
  const toPage = (x: number, y: number, z: number) =>
    new Vector3(x, y, z).applyMatrix4(matrix).toArray();

  it('maps the target centre to the anchor centre', () => {
    expect(toPage(0, 0, 0)).toEqual([10, -5, 0]);
  });

  it('maps image right (-X), image top (+Z) and up (+Y) to page X, Y and Z', () => {
    expect(toPage(-0.5, 0, 0)).toEqual([110, -5, 0]);
    expect(toPage(0, 0, 0.25)).toEqual([10, 45, 0]);
    expect(toPage(0, 0.1, 0)).toEqual([10, -5, 20]);
  });

  it('is a rotation and uniform scale, not a mirror', () => {
    expect(matrix.determinant()).toBeCloseTo(200 ** 3);
  });
});
