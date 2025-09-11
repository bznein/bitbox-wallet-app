import { defineConfig } from '@playwright/test';
import path from 'path';

export default defineConfig({
  testDir: path.join(__dirname, 'tests'),
  testMatch: ['**/*.spec.ts'],
  webServer: [
    {
      command: 'make -C ../.. webdev',
      port: 8080, // adjust if frontend runs elsewhere
      reuseExistingServer: !process.env.CI,
    },
  ],
  timeout: 120_000,
  use: {
    baseURL: 'http://localhost:8080',
    // headless: true,
    headless: false,
    video: 'retain-on-failure',
    screenshot: 'only-on-failure', // optional, capture screenshots on failures
    trace: 'retain-on-failure',     // optional, trace for debuggin
    launchOptions: {
        slowMo: 1000, // slows down all actions by 200ms
    },
  },
});
