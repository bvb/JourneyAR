import { defineConfig, devices } from '@playwright/test';

const PORT = 5174;
const BASE_URL = `https://localhost:${PORT}`;

export default defineConfig({
  testDir: 'tests/e2e',
  fullyParallel: true,
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
  // The virtual camera (recordings to tools/.out), and the app, whose dev server has the WebRTC
  // signaling relay the camera connects to.
  webServer: [
    {
      command: 'npm run dev',
      url: BASE_URL,
      ignoreHTTPSErrors: true,
      reuseExistingServer: !process.env.CI,
      timeout: 60_000,
      env: { VCAM_RECORDINGS_DIR: '../tools/.out/recordings-e2e' },
    },
    {
      command: 'npm run dev',
      cwd: '../journey-ar',
      url: 'https://localhost:5173',
      ignoreHTTPSErrors: true,
      reuseExistingServer: !process.env.CI,
      timeout: 60_000,
    },
  ],
});
