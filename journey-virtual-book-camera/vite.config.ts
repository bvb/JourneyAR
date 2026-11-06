import basicSsl from '@vitejs/plugin-basic-ssl';
import ffmpeg from 'ffmpeg-static';
import { spawnSync } from 'node:child_process';
import { mkdirSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Plugin } from 'vite';
import { defineConfig } from 'vitest/config';

// Recordings go to the app's test recordings (`?source=video`); tests redirect them elsewhere.
const RECORDINGS = process.env['VCAM_RECORDINGS_DIR']
  ? path.resolve(process.env['VCAM_RECORDINGS_DIR'])
  : fileURLToPath(new URL('../journey-ar/tests/recordings/', import.meta.url));

/**
 * Dev server only: POST /__recordings/<name>.webm|json saves a recording. MediaRecorder WebM
 * files have no duration or seek index, so the video is remuxed with ffmpeg (no re-encoding).
 */
function recordingsEndpoint(): Plugin {
  return {
    name: 'vcam-recordings',
    apply: 'serve',
    configureServer(server) {
      server.middlewares.use('/__recordings', (req, res, next) => {
        if (req.method !== 'POST') {
          next();
          return;
        }
        const name = decodeURIComponent((req.url ?? '').split('?')[0]!.replace(/^\//, ''));
        if (!/^[\w-]+\.(webm|json)$/.test(name)) {
          res.statusCode = 400;
          res.end('Invalid recording name');
          return;
        }
        const chunks: Buffer[] = [];
        req.on('data', (chunk: Buffer) => chunks.push(chunk));
        req.on('end', () => {
          mkdirSync(RECORDINGS, { recursive: true });
          const target = path.join(RECORDINGS, name);
          const body = Buffer.concat(chunks);
          if (name.endsWith('.webm') && ffmpeg) {
            const raw = `${target}.raw`;
            writeFileSync(raw, body);
            const result = spawnSync(ffmpeg, [
              '-v',
              'error',
              '-y',
              '-i',
              raw,
              '-c',
              'copy',
              '-f',
              'webm',
              target,
            ]);
            if (result.status === 0) rmSync(raw);
            else renameSync(raw, target);
          } else {
            writeFileSync(target, body);
          }
          res.setHeader('Content-Type', 'application/json');
          const shown = path.relative(path.resolve('..'), target).split(path.sep).join('/');
          res.end(JSON.stringify({ path: shown }));
        });
      });
    },
  };
}

// HTTPS like the app, so the phone can open it in the LAN and both share one certificate story.
export default defineConfig({
  plugins: [basicSsl(), recordingsEndpoint()],
  server: { host: true, port: 5174, strictPort: true },
  preview: { host: true, port: 4174, strictPort: true },
  test: {
    include: ['tests/unit/**/*.test.ts'],
    environment: 'node',
  },
});
