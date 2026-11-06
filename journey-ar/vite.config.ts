import basicSsl from '@vitejs/plugin-basic-ssl';
import { createReadStream, existsSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Plugin } from 'vite';
import { defineConfig } from 'vitest/config';

const PIPELINE_OUT = fileURLToPath(new URL('../tools/.out/', import.meta.url));
const CONTENT_TYPES: Record<string, string> = {
  '.glb': 'model/gltf-binary',
  '.json': 'application/json',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
};

/**
 * Dev server only: serves the asset pipeline output (tools/.out) under /__pipeline/ so the
 * scene preview page can load raw exports and Unity reference renders.
 */
function pipelineOutput(): Plugin {
  return {
    name: 'journey-pipeline-output',
    apply: 'serve',
    configureServer(server) {
      server.middlewares.use('/__pipeline', (req, res, next) => {
        const relative = decodeURIComponent((req.url ?? '/').split('?')[0] ?? '/');
        const file = path.resolve(PIPELINE_OUT, `.${relative}`);
        if (!file.startsWith(PIPELINE_OUT) || !existsSync(file) || !statSync(file).isFile()) {
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
  plugins: [basicSsl(), pipelineOutput()],
  server: { host: true, port: 5173, strictPort: true },
  preview: { host: true, port: 4173, strictPort: true },
  test: {
    include: ['tests/unit/**/*.test.ts'],
    environment: 'node',
  },
});
