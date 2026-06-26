# AI Model Routing Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Route LinkBox AI calls by purpose so background organization can use a cheap/local model while interactive Assistant answers use a stronger cloud model.

**Architecture:** Keep the existing OpenAI-compatible provider abstraction, but add purpose-scoped settings on top of it. `organize`, `agent`, and `vision` configs fall back to legacy `ai:*` keys for compatibility, and call sites choose an explicit purpose where behavior matters.

**Tech Stack:** Node.js ESM, Express, better-sqlite3 settings table, existing React settings UI, Node test runner, Vite builds.

---

## File Map

- `server/utils/aiConfig.js`: Owns provider presets, purpose-scoped config resolution, update/test helpers, and chat completion calls.
- `server/routes/settings.js`: Exposes purpose-aware AI settings and system health payload.
- `server/routes/assistant.js`: Sends final Assistant generation through `purpose: 'agent'`.
- `server/utils/aiSummarize.js`: Uses `purpose: 'organize'`.
- `server/utils/generateLearningNote.js`: Uses `purpose: 'organize'`.
- `server/utils/videoTranscriptExtractor.js`: Uses `purpose: 'organize'` for text cleanup calls.
- `server/utils/llmUnderstandingAnnotations.js`: Uses `purpose: 'organize'`.
- `server/utils/imageVisionService.js`: Uses `purpose: 'vision'`.
- `server/utils/systemHealth.js`: Adds purpose-specific AI endpoint checks.
- `server/test/aiConfig.test.mjs`: New focused tests for purpose fallback, update, call routing, and sanitization.
- `server/test/assistantRoutes.test.mjs`: Verifies Assistant streaming uses the `agent` purpose.
- `server/test/settingsSystem.test.mjs`: Verifies system status exposes purpose health checks.
- `client/src/api/client.ts`: Adds purpose-aware AI config types and API methods.
- `client/src/pages/settingsConfig.ts`: Adds defaults and purpose helpers.
- `client/src/pages/AISettingsPanel.tsx`: Supports a purpose label/description and purpose-scoped props.
- `client/src/pages/SettingsPage.tsx`: Manages organize/agent/vision config state and save/test actions.
- `client/src/pages/settingsConfig.test.js`: Covers purpose config normalization and provider presets.
- `docs/development.md`: Records purpose-based model routing.
- `docs/taishanpi-deploy.md`: Records RK3576 default split.

---

### Task 1: Purpose-Scoped AI Config Core

**Files:**
- Modify: `server/utils/aiConfig.js`
- Create: `server/test/aiConfig.test.mjs`

- [ ] **Step 1: Write focused tests for fallback and sanitized output**

Create `server/test/aiConfig.test.mjs` with a temporary database setup matching the existing route tests:

```js
import test, { afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';

async function withAiConfig(fn) {
  const dir = mkdtempSync(join(tmpdir(), 'linkbox-ai-config-test-'));
  const oldDbPath = process.env.DB_PATH;
  const oldDataDir = process.env.DATA_DIR;
  const oldUploadsDir = process.env.UPLOADS_DIR;
  process.env.DB_PATH = join(dir, 'test.db');
  process.env.DATA_DIR = dir;
  process.env.UPLOADS_DIR = join(dir, 'uploads');
  const token = `${Date.now()}-${Math.random()}`;
  try {
    const dbModule = await import(`../db.js?ai-config-test=${token}`);
    const aiConfig = await import(`../utils/aiConfig.js?ai-config-test=${token}`);
    const db = dbModule.default;
    db.prepare("DELETE FROM settings WHERE key LIKE 'ai:%'").run();
    return await fn({ db, aiConfig });
  } finally {
    process.env.DB_PATH = oldDbPath;
    process.env.DATA_DIR = oldDataDir;
    process.env.UPLOADS_DIR = oldUploadsDir;
    rmSync(dir, { recursive: true, force: true });
  }
}

test('purpose AI config falls back to legacy ai keys', async () => withAiConfig(async ({ db, aiConfig }) => {
  db.prepare("INSERT INTO settings (key, value) VALUES ('ai:provider', 'custom')").run();
  db.prepare("INSERT INTO settings (key, value) VALUES ('ai:base_url', 'http://legacy.example/v1')").run();
  db.prepare("INSERT INTO settings (key, value) VALUES ('ai:model', 'legacy-model')").run();
  db.prepare("INSERT INTO settings (key, value) VALUES ('ai:api_key', 'legacy-secret')").run();

  const publicConfig = aiConfig.getAIConfig({ purpose: 'agent' });
  assert.equal(publicConfig.provider, 'custom');
  assert.equal(publicConfig.baseUrl, 'http://legacy.example/v1');
  assert.equal(publicConfig.model, 'legacy-model');
  assert.equal(publicConfig.apiKeyConfigured, true);
  assert.equal(Object.hasOwn(publicConfig, 'apiKey'), false);

  const secretConfig = aiConfig.getAIConfig({ purpose: 'agent', includeSecret: true });
  assert.equal(secretConfig.apiKey, 'legacy-secret');
}));

test('purpose AI config stores purpose keys without changing legacy keys', async () => withAiConfig(async ({ db, aiConfig }) => {
  db.prepare("INSERT INTO settings (key, value) VALUES ('ai:model', 'legacy-model')").run();

  const updated = aiConfig.updateAIConfig({
    provider: 'custom',
    baseUrl: 'http://agent.example/v1/',
    model: 'agent-model',
    visionModel: 'agent-vision',
    apiKey: 'agent-secret',
    temperature: 0.2,
    enableThinking: true,
  }, { purpose: 'agent' });

  assert.equal(updated.model, 'agent-model');
  assert.equal(updated.baseUrl, 'http://agent.example/v1');
  assert.equal(updated.apiKeyConfigured, true);
  assert.equal(Object.hasOwn(updated, 'apiKey'), false);
  assert.equal(db.prepare("SELECT value FROM settings WHERE key = 'ai:model'").get().value, 'legacy-model');
  assert.equal(db.prepare("SELECT value FROM settings WHERE key = 'ai:agent:model'").get().value, 'agent-model');
  assert.equal(db.prepare("SELECT value FROM settings WHERE key = 'ai:agent:api_key'").get().value, 'agent-secret');
}));

test('getAIPurposeConfigs exposes organize, agent, and vision configs', async () => withAiConfig(async ({ db, aiConfig }) => {
  db.prepare("INSERT INTO settings (key, value) VALUES ('ai:organize:model', 'organize-model')").run();
  db.prepare("INSERT INTO settings (key, value) VALUES ('ai:agent:model', 'agent-model')").run();

  const configs = aiConfig.getAIPurposeConfigs();
  assert.equal(configs.organize.model, 'organize-model');
  assert.equal(configs.agent.model, 'agent-model');
  assert.equal(configs.vision.model.length > 0, true);
  assert.equal(Object.hasOwn(configs.agent, 'apiKey'), false);
}));
```

- [ ] **Step 2: Run the new test and verify it fails**

Run:

```bash
cd server
node --test test/aiConfig.test.mjs
```

Expected: failure because `updateAIConfig(input, { purpose })` and `getAIPurposeConfigs` do not exist yet.

- [ ] **Step 3: Implement purpose settings in `aiConfig.js`**

Add constants and helpers:

```js
const AI_PURPOSES = ['organize', 'agent', 'vision'];
const DEFAULT_PURPOSE = 'organize';

function normalizePurpose(purpose = DEFAULT_PURPOSE) {
  const value = String(purpose || DEFAULT_PURPOSE).trim().toLowerCase();
  return AI_PURPOSES.includes(value) ? value : DEFAULT_PURPOSE;
}

function purposeKey(purpose, key) {
  return `ai:${normalizePurpose(purpose)}:${key}`;
}

function legacyKey(key) {
  return SETTINGS_KEYS[key];
}

function getPurposeSetting(purpose, key) {
  return getSetting(purposeKey(purpose, key)) ?? getSetting(legacyKey(key));
}

function setPurposeSetting(purpose, key, value) {
  setSetting(purposeKey(purpose, key), value);
}
```

Change these exported function signatures. Each function should keep its
current request/parsing behavior, but resolve config with the supplied purpose:

```js
export function getAIConfig({ purpose = DEFAULT_PURPOSE, includeSecret = false } = {})
export function getAIPurposeConfigs({ includeSecret = false } = {})
export function updateAIConfig(input = {}, { purpose = DEFAULT_PURPOSE } = {})
export async function testAIConfig(input = {}, { purpose = DEFAULT_PURPOSE } = {})
export async function callAIChat({ purpose = DEFAULT_PURPOSE, messages, model, maxTokens = 200, temperature, timeoutMs = 60000 })
export async function streamAIChat({ purpose = DEFAULT_PURPOSE, messages, model, maxTokens = 200, temperature, enableThinking, timeoutMs = 90000, onToken })
```

Inside `getAIConfig`, read from `getPurposeSetting(purpose, 'provider')`, `getPurposeSetting(purpose, 'baseUrl')`, and so on. Add `purpose` to the returned public config.

Inside `updateAIConfig`, write purpose-scoped keys with `setPurposeSetting`. Do not write legacy `ai:*` keys.

For `vision`, if no purpose-specific model exists, use `visionModel` from the organize/global fallback before provider defaults:

```js
const fallbackVisionModel = getPurposeSetting('organize', 'visionModel') || getPurposeSetting(DEFAULT_PURPOSE, 'model');
```

- [ ] **Step 4: Run tests**

Run:

```bash
cd server
node --test test/aiConfig.test.mjs
node --test test/embeddingConfig.test.mjs
```

Expected: both pass. Embedding tests confirm the reserved settings behavior still treats `ai:*` and `embedding:*` as reserved.

- [ ] **Step 5: Commit**

```bash
git add server/utils/aiConfig.js server/test/aiConfig.test.mjs
git commit -m "Add purpose-scoped AI config"
```

---

### Task 2: Route Settings And Purpose Health

**Files:**
- Modify: `server/routes/settings.js`
- Modify: `server/utils/systemHealth.js`
- Modify: `server/test/settingsSystem.test.mjs`
- Test: `server/test/aiConfig.test.mjs`

- [ ] **Step 1: Add route tests for purpose settings**

In `server/test/aiConfig.test.mjs`, add an Express settings route test:

```js
import express from 'express';
import { generateToken } from '../middleware/auth.js';

test('settings AI endpoints read, update, and test a specific purpose', async () => withAiConfig(async ({ db }) => {
  db.prepare("INSERT INTO users (id, username, password_hash) VALUES (1, 'admin', 'hash')").run();
  const token = `${Date.now()}-${Math.random()}`;
  const settingsModule = await import(`../routes/settings.js?ai-config-route-test=${token}`);
  const app = express();
  app.use(express.json());
  app.use('/api/settings', settingsModule.default);
  const server = await new Promise((resolve, reject) => {
    const listening = app.listen(0, '127.0.0.1', () => resolve(listening));
    listening.on('error', reject);
  });
  try {
    const baseUrl = `http://127.0.0.1:${server.address().port}`;
    const headers = {
      Authorization: `Bearer ${generateToken(1)}`,
      'Content-Type': 'application/json',
    };
    const put = await fetch(`${baseUrl}/api/settings/ai/agent`, {
      method: 'PUT',
      headers,
      body: JSON.stringify({
        provider: 'custom',
        baseUrl: 'http://agent.example/v1',
        model: 'agent-model',
        apiKey: 'agent-secret',
      }),
    });
    const putBody = await put.json();
    assert.equal(put.status, 200);
    assert.equal(putBody.config.purpose, 'agent');
    assert.equal(putBody.config.model, 'agent-model');
    assert.equal(Object.hasOwn(putBody.config, 'apiKey'), false);

    const get = await fetch(`${baseUrl}/api/settings/ai`, { headers });
    const getBody = await get.json();
    assert.equal(getBody.purposes.agent.model, 'agent-model');
    assert.equal(getBody.purposes.organize.providers.length > 0, true);
  } finally {
    await new Promise(resolve => server.close(resolve));
  }
}));
```

- [ ] **Step 2: Implement purpose route endpoints**

In `server/routes/settings.js`:

```js
import {
  getAIConfig,
  getAIPurposeConfigs,
  updateAIConfig,
  testAIConfig,
} from '../utils/aiConfig.js';
```

Change `GET /api/settings/ai` to return:

```js
router.get('/ai', authMiddleware, requireAdmin, (req, res) => {
  const purposes = getAIPurposeConfigs();
  res.json({
    ...purposes.organize,
    purposes,
    providers: purposes.organize.providers,
  });
});
```

Add:

```js
router.get('/ai/:purpose', authMiddleware, requireAdmin, (req, res) => {
  res.json(getAIConfig({ purpose: req.params.purpose }));
});

router.put('/ai/:purpose', authMiddleware, requireAdmin, (req, res) => {
  try {
    const config = updateAIConfig(req.body || {}, { purpose: req.params.purpose });
    res.json({ ok: true, config });
  } catch (e) {
    jsonError(res, httpError(400, e.message || 'AI 配置无效'), 'AI 配置无效');
  }
});

router.post('/ai/:purpose/test', authMiddleware, requireAdmin, async (req, res) => {
  try {
    const result = await testAIConfig(req.body || {}, { purpose: req.params.purpose });
    res.json(result);
  } catch (e) {
    const payload = errorPayload(httpError(400, e.message || 'AI 接口测试失败'), 'AI 接口测试失败');
    res.status(payload.status).json({ ok: false, ...payload.body });
  }
});
```

Keep old `PUT /api/settings/ai` and `POST /api/settings/ai/test` as organize-compatible endpoints.

- [ ] **Step 3: Add purpose AI health checks**

In `server/utils/systemHealth.js`, add:

```js
export async function checkAiPurposeHealth(config, options = {}) {
  return checkAiEndpointHealth(config?.baseUrl || '', options);
}
```

Change the `getSystemHealth` signature to destructure `aiConfigs` with the
existing options:

```js
export async function getSystemHealth({
  db,
  queue,
  uploadsDir,
  localLlmUrl = process.env.LOCAL_LLM_URL || '',
  aiConfigs = null,
  execFile = execFileCallback,
  fetch = globalThis.fetch,
  fs = { accessSync, constants: fsConstants },
  timeoutMs = DEFAULT_TIMEOUT_MS,
} = {}) {
  // Existing body continues below.
}
```

Build checks with the destructured `aiConfigs`:

```js
const aiChecks = aiConfigs
  ? {
      aiOrganize: await checkAiPurposeHealth(aiConfigs.organize, { fetch, timeoutMs }),
      aiAgent: await checkAiPurposeHealth(aiConfigs.agent, { fetch, timeoutMs }),
      aiVision: await checkAiPurposeHealth(aiConfigs.vision, { fetch, timeoutMs }),
    }
  : { ai: await checkAiEndpointHealth(localLlmUrl, { fetch, timeoutMs }) };
```

Merge `aiChecks` into `checks`.

In `server/routes/settings.js`, pass `getAIPurposeConfigs({ includeSecret: true })` to `getSystemHealth`.

- [ ] **Step 4: Run route and health tests**

Run:

```bash
cd server
node --test test/aiConfig.test.mjs
node --test test/settingsSystem.test.mjs
```

Expected: pass. If existing `settingsSystem` tests assert a single `ai` check, update the assertion to accept `aiOrganize`, `aiAgent`, and `aiVision`.

- [ ] **Step 5: Commit**

```bash
git add server/routes/settings.js server/utils/systemHealth.js server/test/aiConfig.test.mjs server/test/settingsSystem.test.mjs
git commit -m "Expose purpose-aware AI settings"
```

---

### Task 3: Route AI Call Sites By Purpose

**Files:**
- Modify: `server/routes/assistant.js`
- Modify: `server/utils/aiSummarize.js`
- Modify: `server/utils/generateLearningNote.js`
- Modify: `server/utils/videoTranscriptExtractor.js`
- Modify: `server/utils/llmUnderstandingAnnotations.js`
- Modify: `server/utils/imageVisionService.js`
- Inspect: `server/utils/extractors/shared.js`
- Test: `server/test/assistantRoutes.test.mjs`
- Test: existing focused tests for modified utilities

- [ ] **Step 1: Add Assistant route test for `agent` purpose**

In `server/test/assistantRoutes.test.mjs`, extend the mock fetch in the existing stream test or add a new test:

```js
test('assistant stream sends final answer through the agent purpose config', async () => withMockAnswerLlmStream(async (mockLlm) => withAssistantApp(async ({ db, baseUrl, headers }) => {
  db.prepare(`
    INSERT OR REPLACE INTO settings (key, value)
    VALUES
      ('ai:organize:provider', 'custom'),
      ('ai:organize:base_url', 'http://organize.invalid/v1'),
      ('ai:organize:model', 'organize-model'),
      ('ai:agent:provider', 'custom'),
      ('ai:agent:base_url', 'http://agent.invalid/v1'),
      ('ai:agent:model', 'agent-model')
  `).run();
  db.prepare(`
    INSERT INTO links (id, user_id, type, title, imported_at, content_md)
    VALUES (1, 1, 'file', 'Agent Routing Note', '2026-06-11T00:00:00.000Z', 'Agent routing evidence.')
  `).run();

  const response = await fetch(`${baseUrl}/api/assistant/chat/stream`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ question: 'Agent routing evidence', task: 'ask' }),
  });
  const events = await readSse(response);
  assert.equal(events.some(event => event.event === 'done'), true);
  assert.equal(mockLlm.requests[0].model, 'agent-model');
})));
```

Implement `withMockAnswerLlmStream` near `withMockEmptyLlmStream`:

```js
async function withMockAnswerLlmStream(fn) {
  const originalFetch = globalThis.fetch;
  const requests = [];
  try {
    globalThis.fetch = async (url, options = {}) => {
      if (String(url).includes('/chat/completions')) {
        requests.push(JSON.parse(String(options.body || '{}')));
        return new Response('data: {"choices":[{"delta":{"content":"根据资料回答。[1]"}}]}\n\ndata: [DONE]\n\n', {
          status: 200,
          headers: { 'Content-Type': 'text/event-stream; charset=utf-8' },
        });
      }
      return originalFetch(url, options);
    };
    return await fn({ requests });
  } finally {
    globalThis.fetch = originalFetch;
  }
}
```

- [ ] **Step 2: Update Assistant route calls**

In `server/routes/assistant.js`, change:

```js
await streamAIChat({
```

to:

```js
await streamAIChat({
  purpose: 'agent',
```

and change non-stream `callAIChat` similarly:

```js
const answer = await callAIChat({
  purpose: 'agent',
  messages: buildMessages(question, ranked, task, {
    memoryItems: agentTurn.memory.items,
    plan: agentTurn.plan,
    retrievalConfidence: agentTurn.retrievalConfidence,
    verification: agentTurn.verification,
  }),
  maxTokens: ASSISTANT_MAX_TOKENS,
  timeoutMs: 90000,
});
```

- [ ] **Step 3: Update background organize calls**

Update imported `callAIChat` invocations:

```js
await callAIChat({
  purpose: 'organize',
  messages,
  maxTokens,
  temperature,
  timeoutMs,
});
```

Apply to:

- `server/utils/aiSummarize.js`
- `server/utils/generateLearningNote.js`
- `server/utils/videoTranscriptExtractor.js`
- `server/utils/llmUnderstandingAnnotations.js`

For direct `fetch` to chat completions in utility files, use
`getAIConfig({ purpose: 'organize', includeSecret: true })` for text cleanup
and `getAIConfig({ purpose: 'vision', includeSecret: true })` for image input.
Inspect `server/utils/extractors/shared.js`; if it builds image or text AI
payloads directly, update that local config lookup with the same rule.

- [ ] **Step 4: Update vision calls**

In `server/utils/imageVisionService.js`, change AI config resolution to:

```js
const aiConfig = runtime.getAIConfig({ purpose: 'vision', includeSecret: true });
```

Where the runtime injects `getAIConfig`, preserve compatibility by supporting both old and new call signatures:

```js
const aiConfig = runtime.getAIConfig.length
  ? runtime.getAIConfig({ purpose: 'vision', includeSecret: true })
  : runtime.getAIConfig({ includeSecret: true });
```

- [ ] **Step 5: Run focused tests**

Run:

```bash
cd server
node --test test/assistantRoutes.test.mjs --test-name-pattern "agent purpose"
node --test test/linkAiActions.test.mjs test/videoTranscriptExtractor.test.mjs test/imageVisionService.test.mjs test/llmUnderstandingAnnotations.test.mjs
```

Expected: pass.

- [ ] **Step 6: Commit**

```bash
git add server/routes/assistant.js server/utils/aiSummarize.js server/utils/generateLearningNote.js server/utils/videoTranscriptExtractor.js server/utils/llmUnderstandingAnnotations.js server/utils/imageVisionService.js server/test/assistantRoutes.test.mjs
git commit -m "Route AI calls by purpose"
```

---

### Task 4: Desktop Settings UI For Model Purposes

**Files:**
- Modify: `client/src/api/client.ts`
- Modify: `client/src/pages/settingsConfig.ts`
- Modify: `client/src/pages/settingsConfig.test.js`
- Modify: `client/src/pages/AISettingsPanel.tsx`
- Modify: `client/src/pages/SettingsPage.tsx`

- [ ] **Step 1: Update client API types**

In `client/src/api/client.ts`, add:

```ts
export type AIPurpose = 'organize' | 'agent' | 'vision';

export interface AIPurposeConfigs {
  organize: AIConfig;
  agent: AIConfig;
  vision: AIConfig;
}
```

Extend `AIConfig` with:

```ts
purpose?: AIPurpose | string;
purposes?: AIPurposeConfigs;
```

Add API methods:

```ts
getAIPurposeConfig: (purpose: AIPurpose): Promise<AIConfig> =>
  request(`/settings/ai/${purpose}`),
updateAIPurposeConfig: (purpose: AIPurpose, data: Partial<AIConfig>): Promise<{ ok: boolean; config: AIConfig }> =>
  request(`/settings/ai/${purpose}`, { method: 'PUT', body: JSON.stringify(data) }),
testAIPurposeConfig: (purpose: AIPurpose, data: Partial<AIConfig>) =>
  request(`/settings/ai/${purpose}/test`, { method: 'POST', body: JSON.stringify(data) }),
```

- [ ] **Step 2: Add config helpers and tests**

In `client/src/pages/settingsConfig.ts`, add:

```ts
export const AI_PURPOSE_LABELS = {
  organize: {
    title: '资料整理模型',
    description: '用于摘要、学习笔记、转写润色和后台结构化整理。',
  },
  agent: {
    title: '问答 Agent 模型',
    description: '用于资料助理最终回答，建议使用稳定的云端大模型。',
  },
  vision: {
    title: '图片理解模型',
    description: '用于图片描述和视觉理解；未单独配置时可沿用整理模型。',
  },
} as const;

export function normalizeAIPurposeConfigs(config: AIConfig): Record<AIPurpose, AIConfig> {
  return {
    organize: { ...DEFAULT_AI_CONFIG, ...(config.purposes?.organize || config), apiKey: '' },
    agent: { ...DEFAULT_AI_CONFIG, ...(config.purposes?.agent || config), apiKey: '' },
    vision: { ...DEFAULT_AI_CONFIG, ...(config.purposes?.vision || config), apiKey: '' },
  };
}
```

In `client/src/pages/settingsConfig.test.js`, add tests for `normalizeAIPurposeConfigs` and `applyProviderPreset`.

- [ ] **Step 3: Generalize `AISettingsPanel`**

Add props:

```ts
title?: string;
description?: string;
saving?: boolean;
saved?: boolean;
onSave?: () => void;
```

Render `title || 'AI 配置'` and `description || existing text`. If `onSave` exists, render a small save button inside the panel. Keep the existing external global save button working during the transition.

- [ ] **Step 4: Update `SettingsPage` state**

Replace single `aiConfig` state with:

```ts
const [aiConfigs, setAIConfigs] = useState<Record<AIPurpose, AIConfig>>({
  organize: DEFAULT_AI_CONFIG,
  agent: DEFAULT_AI_CONFIG,
  vision: DEFAULT_AI_CONFIG,
});
const [activeAIPurpose, setActiveAIPurpose] = useState<AIPurpose>('organize');
const activeAIConfig = aiConfigs[activeAIPurpose];
```

On load:

```ts
api.getAIConfig()
  .then((config) => setAIConfigs(normalizeAIPurposeConfigs(config)))
  .catch(() => {});
```

Update field/provider/test/save handlers to use `activeAIPurpose`.

For first implementation, saving the global settings button can save all three purpose configs:

```ts
for (const purpose of ['organize', 'agent', 'vision'] as AIPurpose[]) {
  const payload = { ...aiConfigs[purpose] };
  if (!payload.apiKey) delete payload.apiKey;
  await api.updateAIPurposeConfig(purpose, payload);
}
```

Render a segmented control above `AISettingsPanel`:

```tsx
{(['organize', 'agent', 'vision'] as AIPurpose[]).map(purpose => (
  <button type="button" onClick={() => setActiveAIPurpose(purpose)}>
    {AI_PURPOSE_LABELS[purpose].title}
  </button>
))}
```

- [ ] **Step 5: Run frontend tests and build**

Run:

```bash
cd client
npm test
npm run build
```

Expected: pass.

- [ ] **Step 6: Commit**

```bash
git add client/src/api/client.ts client/src/pages/settingsConfig.ts client/src/pages/settingsConfig.test.js client/src/pages/AISettingsPanel.tsx client/src/pages/SettingsPage.tsx
git commit -m "Add purpose model settings UI"
```

---

### Task 5: Docs, Deployment Defaults, And Full Verification

**Files:**
- Modify: `docs/development.md`
- Modify: `docs/taishanpi-deploy.md`
- Inspect: `README.md`

- [ ] **Step 1: Update development docs**

Add to `docs/development.md` current checkpoint section:

```md
- AI chat configuration is purpose-scoped. `organize` handles background
  enrichment, `agent` handles interactive Assistant answers, and `vision`
  handles image understanding. Legacy `ai:*` settings remain compatibility
  fallbacks, while embedding stays in `embedding:*`.
```

Inspect `README.md` with:

```bash
rg -n "AI 配置|AI config|LOCAL_LLM|模型|assistant" README.md
```

If README describes a single global AI model, update that paragraph to say
LinkBox now supports purpose-scoped `organize`, `agent`, and `vision` model
configuration. If README does not describe AI model configuration, leave it
unchanged and do not include it in the docs commit.

- [ ] **Step 2: Update RK3576 docs**

In `docs/taishanpi-deploy.md`, add the recommended split:

```md
For RK3576, keep final Assistant answers on a cloud OpenAI-compatible provider
when possible:

- `ai:organize:*` -> local RKLLM adapter or cheap model
- `ai:agent:*` -> cloud model for interactive answers
- `ai:vision:*` -> local RKLLM initially, cloud if image reliability matters
```

Add env notes if the implementation supports purpose environment defaults.

- [ ] **Step 3: Run backend and frontend verification**

Run:

```bash
git diff --check
cd server && npm test
cd ../client && npm test && npm run build
cd ../mobile && npm test && npm run build
```

Expected: all pass.

- [ ] **Step 4: Deploy to RK3576**

Package from `/Users/wq`:

```bash
tar --exclude='.git' --exclude='node_modules' --exclude='client/node_modules' --exclude='mobile/node_modules' --exclude='server/node_modules' --exclude='data' --exclude='uploads' --exclude='certs' --exclude='server/uploads' -czf /tmp/linkbox-r76s-update.tar.gz -C /Users/wq LinkBox
```

Deploy with backup:

```bash
sshpass -p 'fa' scp -o StrictHostKeyChecking=no /tmp/linkbox-r76s-update.tar.gz root@192.168.1.50:/tmp/linkbox-r76s-update.tar.gz
sshpass -p 'fa' ssh -o StrictHostKeyChecking=no root@192.168.1.50 '
set -e
stamp=$(date +%Y%m%d-%H%M%S)
backup=/opt/linkbox-prev-$stamp
rm -rf /opt/linkbox-new
mkdir -p /opt/linkbox-new
tar -xzf /tmp/linkbox-r76s-update.tar.gz -C /opt/linkbox-new --strip-components=1
cd /opt/linkbox-new/server && npm ci --omit=dev
cd /opt/linkbox-new/client && npm ci && npm run build
cd /opt/linkbox-new/mobile && npm ci && npm run build
systemctl stop linkbox
mv /opt/linkbox "$backup"
mv /opt/linkbox-new /opt/linkbox
ln -sfn /var/lib/linkbox/linkbox.db /opt/linkbox/server/linkbox.db
rm -rf /opt/linkbox/server/uploads
ln -sfn /var/lib/linkbox/uploads /opt/linkbox/server/uploads
systemctl start linkbox
echo rollback=$backup
systemctl is-active linkbox
'
```

- [ ] **Step 5: RK3576 smoke test**

Run:

```bash
sshpass -p 'fa' ssh root@192.168.1.50 '
curl -s -o /tmp/linkbox-root.html -w "root=%{http_code}\n" http://127.0.0.1:3100/
curl -s -o /tmp/linkbox-mobile.html -w "mobile=%{http_code}\n" http://127.0.0.1:3100/mobile/
systemctl is-active linkbox rkllm-openai-adapter frpc
'
curl -s -o /tmp/linkbox-r76s-public-root.html -w "public_root=%{http_code}\n" http://150.158.146.192:7130/
curl -s -o /tmp/linkbox-r76s-public-mobile.html -w "public_mobile=%{http_code}\n" http://150.158.146.192:7130/mobile/
```

Expected: all HTTP checks return `200`; services return `active`.

- [ ] **Step 6: Commit docs and final status**

```bash
git add docs/development.md docs/taishanpi-deploy.md README.md
git commit -m "Document purpose-based AI routing"
```

If docs were already included in earlier commits, skip this commit and report that no docs-only changes remain.
