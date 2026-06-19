import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './e2e',
  fullyParallel: false,
  reporter: [['list']],
  use: {
    baseURL: 'http://127.0.0.1:5176',
    trace: 'on-first-retry',
  },
  webServer: [
    {
      command: 'node scripts/playwright-mock-ai.mjs',
      cwd: '../server',
      env: {
        PORT: '3330',
      },
      url: 'http://127.0.0.1:3330/v1/health',
      reuseExistingServer: false,
      timeout: 30000,
    },
    {
      command: 'node scripts/playwright-server.mjs',
      cwd: '../server',
      env: {
        PORT: '3311',
        JWT_SECRET: 'linkbox-playwright-canonical-secret',
        LOCAL_LLM_URL: 'http://127.0.0.1:3330/v1',
        BACKGROUND_QUEUE_CONCURRENCY: '1',
        ASSISTANT_ENABLE_LEGACY_FALLBACK: '0',
      },
      url: 'http://127.0.0.1:3311/api/settings/ai',
      reuseExistingServer: false,
      timeout: 30000,
    },
    {
      command: 'npm run dev -- --host 127.0.0.1 --port 5176',
      cwd: '.',
      env: {
        VITE_API_PROXY: 'http://127.0.0.1:3311',
      },
      url: 'http://127.0.0.1:5176',
      reuseExistingServer: false,
      timeout: 30000,
    },
  ],
  projects: [
    {
      name: 'canonical-chromium',
      testMatch: /canonical-assistant\.spec\.ts/,
      use: { ...devices['Desktop Chrome'] },
    },
  ],
});
