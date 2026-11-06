import basicSsl from '@vitejs/plugin-basic-ssl';
import { defineConfig } from 'vitest/config';

// Camera access needs a secure context, so the dev server runs on HTTPS with a
// self-signed certificate. `host: true` exposes it on the LAN for the Android phone.
export default defineConfig({
  publicDir: 'assets',
  plugins: [basicSsl()],
  server: { host: true, port: 5173, strictPort: true },
  preview: { host: true, port: 4173, strictPort: true },
  test: {
    include: ['tests/unit/**/*.test.ts'],
    environment: 'node',
  },
});
