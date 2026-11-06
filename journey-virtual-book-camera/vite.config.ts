import basicSsl from '@vitejs/plugin-basic-ssl';
import { defineConfig } from 'vite';

export default defineConfig({
  plugins: [basicSsl()],
  server: { host: true, port: 5174, strictPort: true },
  preview: { host: true, port: 4174, strictPort: true },
});
