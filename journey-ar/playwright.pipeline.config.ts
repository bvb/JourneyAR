import { defineConfig, devices } from '@playwright/test';

// Asset pipeline checks (not app tests): render the converted scenes next to the Unity
// reference renders (tools/unity-reference). Needs `npm run apk:convert` (tools/.out/export).
const PORT = 5173;
const BASE_URL = `https://localhost:${PORT}`;

export default defineConfig({
  testDir: 'tests/pipeline',
  outputDir: 'test-results/pipeline',
  fullyParallel: true,
  reporter: [['list']],
  timeout: 60_000,
  use: {
    baseURL: BASE_URL,
    ignoreHTTPSErrors: true,
    viewport: { width: 1640, height: 760 },
  },
  projects: [{ name: 'edge', use: { ...devices['Desktop Edge'], channel: 'msedge' } }],
  webServer: {
    command: 'npm run dev',
    url: BASE_URL,
    ignoreHTTPSErrors: true,
    reuseExistingServer: true,
    timeout: 60_000,
  },
});
