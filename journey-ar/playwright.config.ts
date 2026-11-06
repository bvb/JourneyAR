import { defineConfig, devices } from '@playwright/test';

const PORT = 5173;
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
  webServer: {
    command: 'npm run dev',
    url: BASE_URL,
    ignoreHTTPSErrors: true,
    reuseExistingServer: !process.env.CI,
    timeout: 60_000,
  },
});
