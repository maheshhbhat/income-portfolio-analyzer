import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './test',
  testMatch: 'horizonComparisonChrome.test.js',
  fullyParallel: false,
  forbidOnly: true,
  retries: 0,
  workers: 1,
  reporter: 'line',
  use: {
    baseURL: 'http://127.0.0.1:4173'
  },
  webServer: {
    command: 'npm start',
    url: 'http://127.0.0.1:4173',
    env: { PORT: '4173' },
    reuseExistingServer: false,
    timeout: 30_000
  },
  projects: [
    {
      name: 'chrome',
      use: {
        browserName: 'chromium',
        channel: 'chrome',
        headless: true
      }
    }
  ]
});
