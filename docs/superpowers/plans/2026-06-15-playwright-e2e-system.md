# Playwright E2E System Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a systematic browser E2E suite for LinkBox that verifies the real desktop web app flows without coupling test-only behavior into production features.

**Architecture:** Keep browser tests in `client/e2e`, Playwright orchestration in `client/playwright.config.ts`, and server-side test harness scripts under `server/scripts/playwright-*`. Every E2E run starts an isolated backend with a temporary SQLite database and uploads directory, then starts a Vite dev server whose `/api` proxy points at that backend.

**Tech Stack:** Playwright Test, React/Vite desktop app, Express backend, better-sqlite3 temporary database, Node.js ESM support scripts.

---

## Testing Principles

- Browser E2E is a separate verification layer, not product code.
- E2E tests should drive the UI like a user: click, fill, upload, search, filter, download, and verify visible outcomes.
- Test infrastructure may live in `client/e2e`, `client/playwright.config.ts`, and `server/scripts/playwright-*`.
- Production routes must not gain test-only endpoints. If seeding is needed, use a Playwright support script or direct database setup against the isolated test database.
- AI-dependent tests must use a local mock OpenAI-compatible server, not the real model endpoint.
- Each task below should be committed separately when implemented.

## File Structure

- Modify `client/package.json`: keep `test:e2e` as the browser E2E entry point and add optional developer helper scripts if needed.
- Modify `client/playwright.config.ts`: define projects, web servers, base URL, retries, traces, and test output behavior.
- Modify `client/vite.config.ts`: allow Playwright to point Vite's `/api` proxy at the isolated backend through `VITE_API_PROXY`.
- Create `client/e2e/helpers/auth.ts`: register/login helpers that only use UI or public API.
- Create `client/e2e/helpers/fixtures.ts`: file and text fixture helpers for uploads.
- Create `client/e2e/helpers/downloads.ts`: download parsing helpers.
- Create `client/e2e/settings-health.spec.ts`: existing admin settings and health smoke.
- Create `client/e2e/item-crud.spec.ts`: core text/link add, list, search, filter, update, delete flow.
- Create `client/e2e/file-processing.spec.ts`: file upload and processing status flow.
- Create `client/e2e/assistant.spec.ts`: assistant chat flow with mock AI.
- Create `client/e2e/export.spec.ts`: JSON and Markdown export flow.
- Create `client/e2e/responsive.spec.ts`: mobile-width desktop-app smoke.
- Create `server/scripts/playwright-server.mjs`: isolated backend launcher with temporary database and uploads.
- Create `server/scripts/playwright-mock-ai.mjs`: local OpenAI-compatible mock for assistant tests.
- Create `docs/development.md` updates: document how to run E2E locally and how CI should install browsers.

---

## Task 1: Harden The Playwright Harness

**Files:**
- Modify: `client/playwright.config.ts`
- Modify: `client/vite.config.ts`
- Modify: `server/scripts/playwright-server.mjs`
- Test: `client/e2e/settings-health.spec.ts`

- [x] **Step 1: Configure Vite API proxy override**

Use `VITE_API_PROXY` in `client/vite.config.ts` so Playwright can point the browser app at a temporary backend:

```ts
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      '/api': process.env.VITE_API_PROXY || 'http://localhost:3100',
    },
  },
});
```

- [x] **Step 2: Use dedicated E2E ports**

Set Playwright to run the backend on `3310` and the frontend on `5174`.

```ts
use: {
  baseURL: 'http://127.0.0.1:5174',
  trace: 'on-first-retry',
},
webServer: [
  {
    command: 'node scripts/playwright-server.mjs',
    cwd: '../server',
    env: {
      PORT: '3310',
      JWT_SECRET: 'linkbox-playwright-secret',
      LOCAL_LLM_URL: 'http://127.0.0.1:1/v1',
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
]
```

- [x] **Step 3: Keep backend state isolated**

`server/scripts/playwright-server.mjs` must create a temporary `DATA_DIR`, `DB_PATH`, and `UPLOADS_DIR`, then remove them when the child server exits.

```js
const dataDir = mkdtempSync(join(tmpdir(), 'linkbox-playwright-'));
const uploadsDir = join(dataDir, 'uploads');
mkdirSync(uploadsDir, { recursive: true });

const app = spawn(process.execPath, ['index.js'], {
  cwd: process.cwd(),
  env: {
    ...process.env,
    DATA_DIR: dataDir,
    DB_PATH: join(dataDir, 'linkbox.db'),
    UPLOADS_DIR: uploadsDir,
  },
  stdio: 'inherit',
});
```

- [x] **Step 4: Verify the harness**

Run:

```bash
cd client
npm run test:e2e
```

Expected: the settings health test passes in Chromium, and no real local database is touched.

- [x] **Step 5: Commit**

```bash
git add client/playwright.config.ts client/vite.config.ts server/scripts/playwright-server.mjs client/e2e/settings-health.spec.ts
git commit -m "Harden Playwright e2e harness"
```

---

## Task 2: Add Auth And Test Data Helpers

**Files:**
- Create: `client/e2e/helpers/auth.ts`
- Create: `client/e2e/helpers/fixtures.ts`
- Modify: `client/e2e/settings-health.spec.ts`
- Test: `client/e2e/settings-health.spec.ts`

- [x] **Step 1: Create auth helper**

Create `client/e2e/helpers/auth.ts`:

```ts
import { expect, type Page } from '@playwright/test';

export async function registerViaUi(page: Page, username = `pw-${Date.now()}`) {
  await page.goto('/');
  await page.getByRole('button', { name: '注册' }).click();
  await page.getByPlaceholder('用户名').fill(username);
  await page.getByPlaceholder('密码').fill('pass1234');
  await page.getByRole('button', { name: '注册' }).click();
  await expect(page.getByRole('link', { name: /系统设置/ })).toBeVisible();
  return { username, password: 'pass1234' };
}
```

- [x] **Step 2: Create fixture helper**

Create `client/e2e/helpers/fixtures.ts`:

```ts
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from '@playwright/test';

export function createTextFixture(name: string, content: string) {
  const filePath = join(test.info().outputDir, name);
  writeFileSync(filePath, content);
  return filePath;
}
```

- [x] **Step 3: Refactor settings health test**

Update `client/e2e/settings-health.spec.ts` to use the helper:

```ts
import { expect, test } from '@playwright/test';
import { registerViaUi } from './helpers/auth';

test('admin can view system health checks in settings', async ({ page }) => {
  await registerViaUi(page);

  await page.getByRole('link', { name: /系统设置/ }).click();

  await expect(page.getByRole('heading', { name: '系统健康' })).toBeVisible();
  await expect(page.getByText(/状态：(健康|降级|异常|未知)/)).toBeVisible();
  await expect(page.getByText('SQLite', { exact: true })).toBeVisible();
  await expect(page.getByText('Uploads', { exact: true })).toBeVisible();
  await expect(page.getByText('Queue', { exact: true })).toBeVisible();
  await expect(page.getByText('AI Endpoint', { exact: true })).toBeVisible();
  await expect(page.getByText('pdftotext', { exact: true })).toBeVisible();
  await expect(page.getByText('LibreOffice', { exact: true })).toBeVisible();
});
```

- [x] **Step 4: Verify helper extraction**

Run:

```bash
cd client
npm run test:e2e -- settings-health.spec.ts
```

Expected: the settings health test passes.

- [x] **Step 5: Commit**

```bash
git add client/e2e/helpers/auth.ts client/e2e/helpers/fixtures.ts client/e2e/settings-health.spec.ts
git commit -m "Add Playwright e2e helpers"
```

---

## Task 3: Cover Core Item CRUD

**Files:**
- Create: `client/e2e/item-crud.spec.ts`
- Modify: `client/e2e/helpers/auth.ts`
- Test: `client/e2e/item-crud.spec.ts`

- [x] **Step 1: Add a text-note creation test**

Create `client/e2e/item-crud.spec.ts`:

```ts
import { expect, test } from '@playwright/test';
import { registerViaUi } from './helpers/auth';

test('user can create, search, update, and delete a text item', async ({ page }) => {
  await registerViaUi(page);

  await page.getByRole('button', { name: /添加/ }).click();
  await page.getByRole('button', { name: '文字' }).click();
  await page.getByPlaceholder('笔记标题').fill('E2E Text Note');
  await page.getByPlaceholder(/写下你的想法/).fill('Playwright text note body with searchable-token-731.');
  await page.getByRole('button', { name: '保存' }).click();

  await expect(page.getByText('E2E Text Note')).toBeVisible();
  await page.getByPlaceholder(/搜索|筛选|关键词/).fill('searchable-token-731');
  await expect(page.getByText('E2E Text Note')).toBeVisible();

  await page.getByRole('button', { name: /编辑/ }).first().click();
  await page.getByDisplayValue('E2E Text Note').fill('E2E Text Note Updated');
  await page.getByRole('button', { name: /保存/ }).click();
  await expect(page.getByText('E2E Text Note Updated')).toBeVisible();

  page.once('dialog', dialog => dialog.accept());
  await page.getByRole('button', { name: /删除/ }).first().click();
  await expect(page.getByText('E2E Text Note Updated')).toHaveCount(0);
});
```

- [x] **Step 2: Run the new test and capture selector failures**

Run:

```bash
cd client
npm run test:e2e -- item-crud.spec.ts
```

Expected: the test may fail if current buttons lack accessible names.

- [x] **Step 3: Fix only accessibility names needed for stable testing**

If the test cannot find edit/delete buttons, update the relevant buttons in `client/src/components/LinkCard.tsx` with explicit labels:

```tsx
<button type="button" aria-label="编辑收藏" ...>
```

```tsx
<button type="button" aria-label="删除收藏" ...>
```

- [x] **Step 4: Verify the core item flow**

Run:

```bash
cd client
npm run test:e2e -- item-crud.spec.ts
```

Expected: PASS.

- [x] **Step 5: Commit**

```bash
git add client/e2e/item-crud.spec.ts client/src/components/LinkCard.tsx
git commit -m "Add core item browser e2e"
```

---

## Task 4: Cover File Upload And Processing Status

**Files:**
- Create: `client/e2e/file-processing.spec.ts`
- Modify: `client/e2e/helpers/fixtures.ts`
- Test: `client/e2e/file-processing.spec.ts`

- [x] **Step 1: Add upload fixture helper**

Extend `client/e2e/helpers/fixtures.ts`:

```ts
export function createMarkdownFixture(name = 'playwright-note.md') {
  return createTextFixture(
    name,
    '# Playwright Upload\n\nThis uploaded markdown file contains e2e-upload-token-942.'
  );
}
```

- [x] **Step 2: Add file upload test**

Create `client/e2e/file-processing.spec.ts`:

```ts
import { expect, test } from '@playwright/test';
import { registerViaUi } from './helpers/auth';
import { createMarkdownFixture } from './helpers/fixtures';

test('user can upload a file and see it in the collection', async ({ page }) => {
  await registerViaUi(page);
  const filePath = createMarkdownFixture();

  await page.getByRole('button', { name: /添加/ }).click();
  await page.getByRole('button', { name: '文件' }).click();
  await page.getByLabel(/选择文件/).setInputFiles(filePath);
  await page.getByPlaceholder(/文件标题/).fill('E2E Markdown Upload');
  await page.getByRole('button', { name: '保存' }).click();

  await expect(page.getByText('E2E Markdown Upload')).toBeVisible();
  await expect(page.getByText(/处理中|已完成|等待处理|处理失败/)).toBeVisible();
});
```

- [x] **Step 3: Run file upload test**

Run:

```bash
cd client
npm run test:e2e -- file-processing.spec.ts
```

Expected: PASS after selectors are adjusted to current UI text.

- [x] **Step 4: Commit**

```bash
git add client/e2e/file-processing.spec.ts client/e2e/helpers/fixtures.ts
git commit -m "Add file upload browser e2e"
```

---

## Task 5: Add Mock AI And Assistant E2E

**Files:**
- Create: `server/scripts/playwright-mock-ai.mjs`
- Modify: `client/playwright.config.ts`
- Create: `client/e2e/assistant.spec.ts`
- Test: `client/e2e/assistant.spec.ts`

- [x] **Step 1: Create mock AI server**

Create `server/scripts/playwright-mock-ai.mjs`:

```js
import http from 'node:http';

const PORT = Number(process.env.PORT || 3320);

const server = http.createServer((req, res) => {
  if (req.url === '/v1/health') {
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ ok: true }));
    return;
  }

  if (req.url === '/v1/chat/completions') {
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({
      choices: [{
        message: {
          content: '这是 Playwright mock AI 回答，基于测试资料生成。[资料1]',
        },
      }],
    }));
    return;
  }

  res.writeHead(404, { 'content-type': 'application/json' });
  res.end(JSON.stringify({ error: 'not found' }));
});

server.listen(PORT, '127.0.0.1', () => {
  console.log(`Playwright mock AI listening on http://127.0.0.1:${PORT}`);
});

process.on('SIGTERM', () => server.close(() => process.exit(0)));
process.on('SIGINT', () => server.close(() => process.exit(0)));
```

- [x] **Step 2: Start mock AI before backend**

Add a third web server entry to `client/playwright.config.ts`, before the backend:

```ts
{
  command: 'node scripts/playwright-mock-ai.mjs',
  cwd: '../server',
  env: {
    PORT: '3320',
  },
  url: 'http://127.0.0.1:3320/v1/health',
  reuseExistingServer: false,
  timeout: 30000,
}
```

Then set backend `LOCAL_LLM_URL` to the mock:

```ts
LOCAL_LLM_URL: 'http://127.0.0.1:3320/v1',
```

- [x] **Step 3: Add assistant browser test**

Create `client/e2e/assistant.spec.ts`:

```ts
import { expect, test } from '@playwright/test';
import { registerViaUi } from './helpers/auth';

test('assistant answers from the user collection with visible citations', async ({ page }) => {
  await registerViaUi(page);

  await page.getByRole('button', { name: /添加/ }).click();
  await page.getByRole('button', { name: '文字' }).click();
  await page.getByPlaceholder('笔记标题').fill('E2E Assistant Source');
  await page.getByPlaceholder(/写下你的想法/).fill('The assistant should find e2e-assistant-token-515 in this source.');
  await page.getByRole('button', { name: '保存' }).click();
  await expect(page.getByText('E2E Assistant Source')).toBeVisible();

  await page.getByRole('link', { name: /资料助理/ }).click();
  await page.getByPlaceholder(/问一个|总结|报告|整理|待办/).fill('e2e-assistant-token-515 是什么？');
  await page.getByRole('button', { name: /发送/ }).click();

  await expect(page.getByText(/Playwright mock AI 回答/)).toBeVisible();
  await expect(page.getByText(/引用资料/)).toBeVisible();
});
```

- [x] **Step 4: Verify assistant flow**

Run:

```bash
cd client
npm run test:e2e -- assistant.spec.ts
```

Expected: PASS using the mock AI server only.

- [x] **Step 5: Commit**

```bash
git add server/scripts/playwright-mock-ai.mjs client/playwright.config.ts client/e2e/assistant.spec.ts
git commit -m "Add assistant browser e2e with mock AI"
```

---

## Task 6: Cover Exports

**Files:**
- Create: `client/e2e/helpers/downloads.ts`
- Create: `client/e2e/export.spec.ts`
- Test: `client/e2e/export.spec.ts`

- [x] **Step 1: Add download helper**

Create `client/e2e/helpers/downloads.ts`:

```ts
import { readFileSync } from 'node:fs';
import type { Download } from '@playwright/test';

export async function readDownload(download: Download) {
  const path = await download.path();
  if (!path) throw new Error('Download path was not available');
  return readFileSync(path, 'utf8');
}
```

- [x] **Step 2: Add export test**

Create `client/e2e/export.spec.ts`:

```ts
import { expect, test } from '@playwright/test';
import { registerViaUi } from './helpers/auth';
import { readDownload } from './helpers/downloads';

test('user can export collection data as JSON', async ({ page }) => {
  await registerViaUi(page);

  await page.getByRole('button', { name: /添加/ }).click();
  await page.getByRole('button', { name: '文字' }).click();
  await page.getByPlaceholder('笔记标题').fill('E2E Export Item');
  await page.getByPlaceholder(/写下你的想法/).fill('export-token-884');
  await page.getByRole('button', { name: '保存' }).click();
  await expect(page.getByText('E2E Export Item')).toBeVisible();

  await page.getByRole('button', { name: /导出/ }).click();
  const downloadPromise = page.waitForEvent('download');
  await page.getByText(/数据导出/).click();
  const content = await readDownload(await downloadPromise);

  expect(content).toContain('E2E Export Item');
  expect(content).toContain('export-token-884');
});
```

- [x] **Step 3: Verify export flow**

Run:

```bash
cd client
npm run test:e2e -- export.spec.ts
```

Expected: PASS.

- [x] **Step 4: Commit**

```bash
git add client/e2e/helpers/downloads.ts client/e2e/export.spec.ts
git commit -m "Add export browser e2e"
```

---

## Task 7: Add Responsive Smoke Coverage

**Files:**
- Modify: `client/playwright.config.ts`
- Create: `client/e2e/responsive.spec.ts`
- Test: `client/e2e/responsive.spec.ts`

- [x] **Step 1: Add mobile-sized browser project**

Add a second Playwright project:

```ts
projects: [
  {
    name: 'chromium',
    use: { ...devices['Desktop Chrome'] },
  },
  {
    name: 'mobile-chromium',
    use: {
      ...devices['Pixel 5'],
    },
  },
],
```

- [x] **Step 2: Add responsive smoke test**

Create `client/e2e/responsive.spec.ts`:

```ts
import { expect, test } from '@playwright/test';
import { registerViaUi } from './helpers/auth';

test('primary navigation and add dialog work on mobile width', async ({ page }) => {
  await registerViaUi(page);

  await expect(page.getByRole('heading', { name: '我的收藏' })).toBeVisible();
  await page.getByRole('button', { name: /添加/ }).click();
  await expect(page.getByRole('heading', { name: '添加收藏' })).toBeVisible();
  await expect(page.getByRole('button', { name: '链接' })).toBeVisible();
  await expect(page.getByRole('button', { name: '文字' })).toBeVisible();
});
```

- [x] **Step 3: Run only responsive project**

Run:

```bash
cd client
npm run test:e2e -- --project=mobile-chromium responsive.spec.ts
```

Expected: PASS.

- [x] **Step 4: Commit**

```bash
git add client/playwright.config.ts client/e2e/responsive.spec.ts
git commit -m "Add responsive browser e2e"
```

---

## Task 8: Document Local And CI E2E Usage

**Files:**
- Modify: `docs/development.md`
- Modify: `.gitignore`
- Test: documentation plus command verification

- [x] **Step 1: Ensure generated output is ignored**

Add to `.gitignore`:

```gitignore
client/playwright-report/
client/test-results/
```

- [x] **Step 2: Document local setup**

Add this section to `docs/development.md`:

````md
## Browser E2E Tests

Install dependencies:

```bash
cd client
npm install
npx playwright install chromium
```

Run the browser suite:

```bash
cd client
npm run test:e2e
```

The Playwright config starts an isolated backend on port `3310` with a temporary SQLite database and uploads directory. It also starts Vite on port `5174` with `/api` proxied to that backend, so tests do not use the normal development database.
````

- [x] **Step 3: Verify commands from documentation**

Run:

```bash
cd client
npm run test:e2e
npm test
npm run build
```

Expected: all commands PASS.

- [x] **Step 4: Commit**

```bash
git add .gitignore docs/development.md
git commit -m "Document browser e2e workflow"
```

---

## Task 9: Final E2E Gate

**Files:**
- Test-only task

- [ ] **Step 1: Run full server tests**

Run:

```bash
cd server
npm test
```

Expected: all Node tests PASS.

- [ ] **Step 2: Run full client tests**

Run:

```bash
cd client
npm test
npm run build
npm run test:e2e
```

Expected: unit tests, build, and Playwright browser E2E all PASS.

- [ ] **Step 3: Check git diff hygiene**

Run:

```bash
git diff --check
git status --short
```

Expected: no whitespace errors; only intentional files are changed before final commit.

- [ ] **Step 4: Push**

```bash
git push origin main
```

Expected: remote `main` contains the completed E2E system work.

---

## Current Progress

- [x] Playwright dependency and `npm run test:e2e` entry exist in the client package.
- [x] Browser E2E output directories are ignored.
- [x] First browser E2E smoke covers admin registration and system health settings.
- [x] Isolated Playwright backend launcher exists.
- [x] Auth/test-data helpers are extracted.
- [x] Core item CRUD browser flow is covered for text item create, search, update, and delete.
- [x] File upload browser flow is covered for markdown upload and visible processing state.
- [x] Assistant flow has mock AI browser coverage.
- [x] Export browser flow is covered for JSON download.
- [x] Mobile-width browser smoke is covered.
- [x] Local E2E documentation is updated.
