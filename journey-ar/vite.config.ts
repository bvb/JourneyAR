import basicSsl from '@vitejs/plugin-basic-ssl';
import { createReadStream, existsSync, readFileSync, statSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Plugin } from 'vite';
import { defineConfig } from 'vitest/config';
import { signalRelay } from './dev/signal-relay.ts';

const PIPELINE_OUT = fileURLToPath(new URL('../tools/.out/', import.meta.url));
const RECORDINGS = fileURLToPath(new URL('./tests/recordings/', import.meta.url));
const CONTENT_TYPES: Record<string, string> = {
  '.glb': 'model/gltf-binary',
  '.json': 'application/json',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.webm': 'video/webm',
  '.mp4': 'video/mp4',
};

/**
 * Dev server only: serves a local folder read-only under a URL prefix. Used for the asset
 * pipeline output (tools/.out, scene preview page) and the test recordings (`?source=video`).
 */
function serveFolder(prefix: string, folder: string): Plugin {
  return {
    name: `journey-serve${prefix.replaceAll('/', '-')}`,
    apply: 'serve',
    configureServer(server) {
      server.middlewares.use(prefix, (req, res, next) => {
        const relative = decodeURIComponent((req.url ?? '/').split('?')[0] ?? '/');
        const file = path.resolve(folder, `.${relative}`);
        if (!file.startsWith(folder) || !existsSync(file) || !statSync(file).isFile()) {
          next();
          return;
        }
        res.setHeader(
          'Content-Type',
          CONTENT_TYPES[path.extname(file)] ?? 'application/octet-stream',
        );
        res.setHeader('Cache-Control', 'no-store');
        createReadStream(file).pipe(res);
      });
    },
  };
}

// Worker files of the NFT tracker (createNFTTrackerWorker loads them by URL from workerBase):
// the default build and the SIMD one; the threaded build needs cross-origin isolation, which
// the app does not use.
const NFT_DIST = path.join(
  path.dirname(createRequire(import.meta.url).resolve('@webarkit/jsartoolkit-nft/package.json')),
  'dist',
);
const NFT_WORKER_FILES = ['NFTTracker.worker.js', 'NFTTracker_simd.worker.js'];

// Put before the worker code: the ARToolKit core prints its version and camera parameters for
// every tracker it creates (printf, not under its log level) and one harmless error when it is
// disposed (it has no square markers to detach). Warnings and other errors stay.
const NFT_WORKER_PRELUDE = `// Added by journey-ar/vite.config.ts: quiet ARToolKit diagnostics.
{
  const quiet = () => {};
  console.log = quiet;
  console.info = quiet;
  console.debug = quiet;
  const error = console.error.bind(console);
  console.error = (...args) => {
    if (!String(args[0]).includes('Error detaching pattern from arhandle')) error(...args);
  };
}
`;

function nftWorkerSource(name: string): string {
  return NFT_WORKER_PRELUDE + readFileSync(path.join(NFT_DIST, name), 'utf8');
}

/** Serves the NFT worker files under /nft-worker/ in dev and copies them there in builds. */
function nftWorkerFiles(): Plugin {
  return {
    name: 'journey-nft-worker',
    configureServer(server) {
      server.middlewares.use('/nft-worker', (req, res, next) => {
        const name = path.basename((req.url ?? '').split('?')[0] ?? '');
        if (!NFT_WORKER_FILES.includes(name)) {
          next();
          return;
        }
        res.setHeader('Content-Type', 'text/javascript');
        res.end(nftWorkerSource(name));
      });
    },
    generateBundle() {
      for (const name of NFT_WORKER_FILES) {
        this.emitFile({
          type: 'asset',
          fileName: `nft-worker/${name}`,
          source: nftWorkerSource(name),
        });
      }
    },
  };
}

// Camera access needs a secure context, so the dev server runs on HTTPS with a
// self-signed certificate. `host: true` exposes it on the LAN for the Android phone.
export default defineConfig({
  publicDir: 'assets',
  plugins: [
    basicSsl(),
    serveFolder('/__pipeline', PIPELINE_OUT),
    serveFolder('/__recordings', RECORDINGS),
    signalRelay(),
    nftWorkerFiles(),
  ],
  server: { host: true, port: 5173, strictPort: true },
  preview: { host: true, port: 4173, strictPort: true },
  test: {
    include: ['tests/unit/**/*.test.ts'],
    environment: 'node',
  },
});
