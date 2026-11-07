import { defineConfig, devices } from '@playwright/test';

const PORT = 5173;
const BASE_URL = `https://localhost:${PORT}`;

export default defineConfig({
  testDir: 'tests/e2e',
  fullyParallel: true,
  // Every test page runs WebGL, the tracker's WASM, scene loading and audio; more workers only
  // slow them all down and make the timing checks flaky.
  workers: 2,
  forbidOnly: !!process.env.CI,
  reporter: [['list'], ['html', { open: 'never' }]],
  use: {
    baseURL: BASE_URL,
    ignoreHTTPSErrors: true,
    trace: 'retain-on-failure',
  },
  projects: [
    // Primary browser: the installed Microsoft Edge.
    { name: 'edge', use: { ...devices['Desktop Edge'], channel: 'msedge' } },
    // Fallback: the isolated Chromium build bundled with Playwright.
    { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
  ],
  // The app, and the virtual camera for the WebRTC source (its recordings go to tools/.out).
  webServer: [
    {
      command: 'npm run dev',
      url: BASE_URL,
      ignoreHTTPSErrors: true,
      reuseExistingServer: !process.env.CI,
      timeout: 60_000,
    },
    {
      command: 'npm run dev',
      cwd: '../journey-virtual-book-camera',
      url: 'https://localhost:5174',
      ignoreHTTPSErrors: true,
      reuseExistingServer: !process.env.CI,
      timeout: 60_000,
      env: { VCAM_RECORDINGS_DIR: '../tools/.out/recordings-e2e' },
    },
  ],
});
