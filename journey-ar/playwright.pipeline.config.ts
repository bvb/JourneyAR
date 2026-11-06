import { defineConfig, devices } from '@playwright/test';

// Asset pipeline checks (not app tests): render exported scenes next to the Unity references.
// Needs the outputs of `npm run unity:render` and `npm run unity:export` in tools/.out.
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
