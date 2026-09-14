import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './tests',
  testMatch: '*.spec.ts',
  use: {
    channel: 'chromium',
    baseURL: 'http://127.0.0.1:4311',
    viewport: { width: 1440, height: 1000 },
    trace: 'retain-on-failure',
  },
  webServer: {
    command: 'pnpm exec tsx tests/server.ts',
    url: 'http://127.0.0.1:4311',
    reuseExistingServer: false,
  },
});
