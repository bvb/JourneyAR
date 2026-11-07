import { existsSync, readFileSync } from 'node:fs';
import { Vector3 } from 'three';
import { describe, expect, it } from 'vitest';
import { anchorMatrix, parseScenesManifest } from '../../src/scenes/manifest';

const ASSETS = new URL('../../assets/', import.meta.url);
const PAGES = new URL('../../../book-ar-pages/', import.meta.url);

function readJson(url: URL): unknown {
  return JSON.parse(readFileSync(url, 'utf8'));
}

/** Node names from the JSON chunk of a GLB file. */
function glbNodeNames(url: URL): string[] {
  const bytes = readFileSync(url);
  const jsonLength = bytes.readUInt32LE(12);
  const json = JSON.parse(bytes.toString('utf8', 20, 20 + jsonLength)) as {
    nodes?: { name?: string }[];
  };
  return (json.nodes ?? []).map((node) => node.name ?? '');
}

describe('shipped scenes.json', () => {
  const manifest = parseScenesManifest(readJson(new URL('scenes.json', ASSETS)));

  it('lists the five book scenes', () => {
    expect(manifest.scenes.map((s) => s.id).sort()).toEqual([
      'architecture',
      'character',
      'creature',
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
      expect(existsSync(new URL(`Artbook_Journey-${scene.page}-image1.jpg`, PAGES))).toBe(true);
      expect(glbNodeNames(new URL(scene.model, ASSETS))).toContain(scene.pinch.node);
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
  });

  it('rejects duplicate ids and inverted pinch limits', () => {
    expect(() =>
      parseScenesManifest({ ...valid, scenes: [...valid.scenes, ...valid.scenes] }),
    ).toThrow('unique');
    const inverted = structuredClone(valid);
    inverted.scenes[0]!.pinch.max = 0.5;
    expect(() => parseScenesManifest(inverted)).toThrow('pinch.max');
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
