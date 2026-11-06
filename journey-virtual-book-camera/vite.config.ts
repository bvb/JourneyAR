import basicSsl from '@vitejs/plugin-basic-ssl';
import { defineConfig } from 'vitest/config';

// HTTPS like the app, so a WebRTC stream can be shared with it (phase 3) and the phone can
// open it in the LAN.
export default defineConfig({
  plugins: [basicSsl()],
  server: { host: true, port: 5174, strictPort: true },
  preview: { host: true, port: 4174, strictPort: true },
  test: {
    include: ['tests/unit/**/*.test.ts'],
    environment: 'node',
  },
});
