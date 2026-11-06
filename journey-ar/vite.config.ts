import basicSsl from '@vitejs/plugin-basic-ssl';
import { createReadStream, existsSync, statSync } from 'node:fs';
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

// Camera access needs a secure context, so the dev server runs on HTTPS with a
// self-signed certificate. `host: true` exposes it on the LAN for the Android phone.
export default defineConfig({
  publicDir: 'assets',
  plugins: [
    basicSsl(),
    serveFolder('/__pipeline', PIPELINE_OUT),
    serveFolder('/__recordings', RECORDINGS),
    signalRelay(),
  ],
  server: { host: true, port: 5173, strictPort: true },
  preview: { host: true, port: 4173, strictPort: true },
  test: {
    include: ['tests/unit/**/*.test.ts'],
    environment: 'node',
  },
});
