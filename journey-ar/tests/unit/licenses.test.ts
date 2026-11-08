import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  bundledPackages,
  copyrightHeader,
  licensesText,
  readPackageLicense,
} from '../../dev/licenses';

// three does not export its package.json; the workspaces share the root node_modules.
const threeDir = fileURLToPath(new URL('../../../node_modules/three', import.meta.url));

describe('licenses.txt of the production build (dev/licenses.ts)', () => {
  it('groups bundled modules by their package folder', () => {
    const packages = bundledPackages([
      'C:\\repo\\node_modules\\three\\build\\three.module.js',
      'C:\\repo\\node_modules\\three\\examples\\jsm\\loaders\\GLTFLoader.js?v=1',
      'C:\\repo\\node_modules\\three\\build\\three.module.js',
      '\0/repo/node_modules/@webarkit/jsartoolkit-nft/dist/ARToolkitNFT.js',
      '/repo/node_modules/a/node_modules/b/index.js',
      '/repo/journey-ar/src/main.ts',
      '\0vite/preload-helper.js',
    ]);
    expect([...packages.keys()]).toEqual([
      '/repo/node_modules/@webarkit/jsartoolkit-nft',
      '/repo/node_modules/a/node_modules/b',
      'C:/repo/node_modules/three',
    ]);
    expect(packages.get('C:/repo/node_modules/three')).toEqual([
      'C:/repo/node_modules/three/build/three.module.js',
      'C:/repo/node_modules/three/examples/jsm/loaders/GLTFLoader.js',
    ]);
  });

  it('keeps copyright headers of source files and nothing else', () => {
    expect(
      copyrightHeader(
        '// Part of a library, MIT License.\n// Copyright (C) 2016, A. Author\nvar x;',
      ),
    ).toBe('Part of a library, MIT License.\nCopyright (C) 2016, A. Author');
    expect(copyrightHeader('/**\n * @license\n * Copyright 2010 Authors\n */\nexport {};')).toBe(
      '@license\nCopyright 2010 Authors',
    );
    expect(copyrightHeader('// A helper.\nexport const a = 1; // Copyright')).toBeNull();
    expect(copyrightHeader('export const a = 1;')).toBeNull();
  });

  it('lists the license text, the notices of bundled files and the GPL for the LGPL', () => {
    const decoder = path.join(threeDir, 'examples/jsm/libs/meshopt_decoder.module.js');
    const three = readPackageLicense(threeDir, [decoder]);
    expect(three.name).toBe('three');
    expect(three.license).toBe('MIT');
    expect(three.text).toContain('Permission is hereby granted');
    expect(three.notices).toEqual([
      {
        file: 'examples/jsm/libs/meshopt_decoder.module.js',
        text: expect.stringMatching(/Kapoulkine/),
      },
    ]);

    const text = licensesText([three, { ...three, name: 'lib', license: 'LGPL-3.0', notices: [] }]);
    expect(text).toMatch(/^Journey AR\n/);
    expect(text).toContain('NOTICE.md');
    expect(text).toContain(`three ${three.version}: MIT`);
    expect(text).toContain(
      'examples/jsm/libs/meshopt_decoder.module.js:\nThis file is part of meshoptimizer',
    );
    expect(text.match(/gpl-3\.0\.txt/g)).toHaveLength(1);
  });
});
