import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './e2e',
  fullyParallel: false,
  reporter: [['list']],
  use: {
    baseURL: 'http://127.0.0.1:5174',
    trace: 'on-first-retry',
  },
  webServer: [
    {
      command: 'node scripts/playwright-mock-ai.mjs',
      cwd: '../server',
      env: {
        PORT: '3320',
      },
      url: 'http://127.0.0.1:3320/v1/health',
      reuseExistingServer: false,
      timeout: 30000,
    },
    {
      command: 'node scripts/playwright-server.mjs',
      cwd: '../server',
      env: {
        PORT: '3310',
        JWT_SECRET: 'linkbox-playwright-secret',
        LOCAL_LLM_URL: 'http://127.0.0.1:3320/v1',
        BACKGROUND_QUEUE_CONCURRENCY: '1',
      },
      url: 'http://127.0.0.1:3310/api/settings/ai',
      reuseExistingServer: false,
      timeout: 30000,
    },
    {
      command: 'npm run dev -- --host 127.0.0.1 --port 5174',
      cwd: '.',
      env: {
        VITE_API_PROXY: 'http://127.0.0.1:3310',
      },
      url: 'http://127.0.0.1:5174',
      reuseExistingServer: false,
      timeout: 30000,
    },
  ],
  projects: [
    {
      name: 'chromium',
      testIgnore: /responsive\.spec\.ts/,
      use: { ...devices['Desktop Chrome'] },
    },
    {
      name: 'mobile-chromium',
      testMatch: /responsive\.spec\.ts/,
      use: { ...devices['Pixel 5'] },
    },
  ],
});
