import { readdirSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import type { Plugin } from 'vite';

// Production builds get a `licenses.txt` next to index.html: the license of the app, a note on
// the Journey content and the license texts of every npm package bundled into the build. The
// packages are found from the module ids of the output chunks, so a new dependency is listed
// without editing anything here.

export interface PackageLicense {
  name: string;
  version: string;
  license: string;
  homepage: string;
  text: string;
  /** Copyright headers of bundled files of the package (minification drops them). */
  notices: { file: string; text: string }[];
}

const LICENSE_FILE = /^(licen[cs]e|copying)(\.|$)/i;
const RULE = '='.repeat(72);

// Locale-independent order, so that licenses.txt is the same on every machine.
const byCodePoint = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);

const HEADER = `Journey AR
https://github.com/bvb/JourneyAR

The code of the app is licensed under the MIT License (LICENSE in the repository).

The content of Journey used by the app (3D scenes, music and sounds, page images, icons,
background picture) is not covered by the MIT License: all rights to it belong to its rights
holders, and it is used with their permission. See NOTICE.md in the repository.

This build contains the following third-party software.`;

// The LGPL is a set of additional permissions on top of the GPL and refers to its text.
const GPL_NOTE =
  'The GNU GPL version 3, referred to above: https://www.gnu.org/licenses/gpl-3.0.txt';

/**
 * Bundled module ids grouped by package folder (the last `node_modules/<name>` of each path);
 * the files are module paths with `/` separators.
 */
export function bundledPackages(moduleIds: Iterable<string>): Map<string, string[]> {
  const packages = new Map<string, string[]>();
  for (const id of moduleIds) {
    const file = (id.replace(/^\0/, '').split('?')[0] ?? '').replaceAll('\\', '/');
    const match = /^(.*\/node_modules\/(?:@[^/]+\/)?[^/]+)\//.exec(file);
    if (!match?.[1]) continue;
    const files = packages.get(match[1]) ?? [];
    if (!files.includes(file)) files.push(file);
    packages.set(match[1], files);
  }
  return new Map([...packages].sort(([a], [b]) => byCodePoint(a, b)));
}

/** The comment a source file starts with, if it holds a copyright notice. */
export function copyrightHeader(source: string): string | null {
  const match = /^\s*((?:\/\/[^\n]*\n\s*)+|\/\*[\s\S]*?\*\/)/.exec(source);
  if (!match?.[1] || !/copyright/i.test(match[1])) return null;
  return match[1]
    .split('\n')
    .map((line) => line.replace(/^\s*(\/\/|\/\*+!?|\*\/|\*)\s?/, '').replace(/\s*\*\/$/, ''))
    .filter((line) => line.trim())
    .join('\n');
}

export function readPackageLicense(dir: string, files: readonly string[] = []): PackageLicense {
  const pkg = JSON.parse(readFileSync(path.join(dir, 'package.json'), 'utf8')) as {
    name: string;
    version: string;
    license?: string;
    homepage?: string;
    repository?: string | { url?: string };
  };
  const file = readdirSync(dir).find((name) => LICENSE_FILE.test(name));
  if (!file) throw new Error(`${pkg.name}: no license file in ${dir}`);
  if (!pkg.license) throw new Error(`${pkg.name}: no license in package.json`);
  const repository = typeof pkg.repository === 'string' ? pkg.repository : pkg.repository?.url;
  const notices = files.flatMap((filePath) => {
    const text = copyrightHeader(readFileSync(filePath, 'utf8').replaceAll('\r\n', '\n'));
    return text ? [{ file: path.relative(dir, filePath).replaceAll('\\', '/'), text }] : [];
  });
  return {
    name: pkg.name,
    version: pkg.version,
    license: pkg.license,
    homepage: pkg.homepage ?? repository?.replace(/^git\+/, '') ?? '',
    text: readFileSync(path.join(dir, file), 'utf8').replaceAll('\r\n', '\n').trim(),
    notices: notices.sort((a, b) => byCodePoint(a.file, b.file)),
  };
}

export function licensesText(packages: readonly PackageLicense[]): string {
  const sections = packages.map((pkg) => {
    const parts = [`${RULE}\n${pkg.name} ${pkg.version}: ${pkg.license}\n${pkg.homepage}\n${RULE}`];
    parts.push(pkg.text);
    if (pkg.license.includes('LGPL')) parts.push(GPL_NOTE);
    for (const notice of pkg.notices) parts.push(`${notice.file}:\n${notice.text}`);
    return parts.join('\n\n');
  });
  return `${[HEADER, ...sections].join('\n\n')}\n`;
}

/**
 * Emits `licenses.txt` in production builds. `extraPackages` are packages shipped as files
 * rather than bundled modules (the NFT worker scripts).
 */
export function thirdPartyLicenses(extraPackages: readonly string[] = []): Plugin {
  const resolve = createRequire(import.meta.url).resolve;
  return {
    name: 'journey-licenses',
    apply: 'build',
    generateBundle(_, bundle) {
      const ids = Object.values(bundle).flatMap((item) =>
        item.type === 'chunk' ? item.moduleIds : [],
      );
      const packages = [...bundledPackages(ids)].map(([dir, files]) =>
        readPackageLicense(dir, files),
      );
      for (const name of extraPackages) {
        const dir = path.dirname(resolve(`${name}/package.json`));
        if (!packages.some((pkg) => pkg.name === name)) packages.push(readPackageLicense(dir));
      }
      packages.sort((a, b) => byCodePoint(a.name, b.name));
      this.emitFile({ type: 'asset', fileName: 'licenses.txt', source: licensesText(packages) });
    },
  };
}
