import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './e2e',
  fullyParallel: false,
  reporter: [['list']],
  use: {
    baseURL: 'http://127.0.0.1:5173',
    trace: 'on-first-retry',
  },
  webServer: [
    {
      command: 'node scripts/playwright-server.mjs',
      cwd: '../server',
      env: {
        PORT: '3100',
        JWT_SECRET: 'linkbox-playwright-secret',
        LOCAL_LLM_URL: 'http://127.0.0.1:1/v1',
        BACKGROUND_QUEUE_CONCURRENCY: '1',
      },
      url: 'http://127.0.0.1:3100/api/settings/ai',
      reuseExistingServer: !process.env.CI,
      timeout: 30000,
    },
    {
      command: 'npm run dev -- --host 127.0.0.1 --port 5173',
      cwd: '.',
      url: 'http://127.0.0.1:5173',
      reuseExistingServer: !process.env.CI,
      timeout: 30000,
    },
  ],
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
});
