import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './tests', fullyParallel: true, reporter: 'list',
  use: { ...devices['Desktop Chrome'], baseURL: 'http://127.0.0.1:3000', channel: 'chrome', trace: 'retain-on-failure' },
  webServer: { command: 'pnpm dev --port 3000 --strictPort', url: 'http://127.0.0.1:3000', reuseExistingServer: !process.env.CI },
});
