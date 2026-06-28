# Local Agent Knowledge Factory Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the first local Agent Knowledge Factory milestone so LinkBox can show item maturity, local Agent reports, suggestions, and accepted rules without requiring cloud APIs.

**Architecture:** Add a thin local factory layer on top of existing durable jobs, canonical documents, item understanding, and purpose-based AI routing. The first milestone is additive: new migration tables, focused server utilities, settings/admin APIs, and a dense settings-page workbench. It does not replace the job queue or Assistant chat Agent.

**Tech Stack:** Node.js ESM, Express, better-sqlite3, existing migration runner, React/Vite settings UI, Node test runner.

**Execution status:** Complete on `main` through commit `cc25df8`.
Verification passed with `git diff --check`, backend tests, client tests/build,
and mobile tests/build. RK3576 deployment was attempted after completion, but
all known LAN/FRP SSH entrypoints rejected or closed the current credentials, so
the production box still needs a reachable SSH entrypoint before this build can
be installed there.

---

## File Map

- `server/utils/localAgentSchema.js`: Creates local factory tables (`agent_runs`, `agent_reports`, `agent_suggestions`, `agent_rules`, `item_maturity_events`).
- `server/utils/dbMigrations.js`: Adds migration `016_local_agent_factory_schema`.
- `server/utils/itemMaturity.js`: Derives maturity state and coverage from existing links/jobs/documents/item understanding/suggestions.
- `server/utils/localAgentFactory.js`: Generates local reports, starts/completes factory runs, creates topic suggestions, and resolves suggestion lifecycle.
- `server/routes/settings.js`: Adds admin endpoints under `/api/settings/local-agent`.
- `server/test/localAgentFactory.test.mjs`: Covers schema, maturity derivation, report generation, suggestion lifecycle, and rule creation.
- `server/test/settingsLocalAgent.test.mjs`: Covers admin API payloads and auth behavior.
- `client/src/api/client.ts`: Adds local Agent workbench types and API methods.
- `client/src/pages/LocalAgentWorkbenchPanel.tsx`: Admin settings UI for maturity coverage, latest report, suggestions, and rules.
- `client/src/pages/localAgentWorkbenchUtils.ts`: Display helpers for local Agent payloads.
- `client/src/pages/localAgentWorkbenchUtils.test.js`: Covers display helper behavior.
- `client/src/pages/SettingsPage.tsx`: Loads local Agent status and renders the workbench.
- `docs/development.md`: Records the first local Agent factory milestone.
- `docs/taishanpi-deploy.md`: Adds RK3576 operational guidance for the local Agent workbench.

---

### Task 1: Local Agent Schema

**Files:**
- Create: `server/utils/localAgentSchema.js`
- Modify: `server/utils/dbMigrations.js`
- Create: `server/test/localAgentFactory.test.mjs`

- [x] **Step 1: Write the failing schema test**

Create `server/test/localAgentFactory.test.mjs`:

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import Database from 'better-sqlite3';

import { initLocalAgentSchema } from '../utils/localAgentSchema.js';

function withDb(fn) {
  const db = new Database(':memory:');
  db.pragma('foreign_keys = ON');
  try {
    db.exec(`
      CREATE TABLE users (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        username TEXT NOT NULL,
        password_hash TEXT NOT NULL
      );
      CREATE TABLE links (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER NOT NULL,
        type TEXT DEFAULT 'link',
        url TEXT DEFAULT '',
        title TEXT DEFAULT '',
        summary TEXT DEFAULT '',
        content TEXT DEFAULT '',
        content_md TEXT DEFAULT '',
        description TEXT DEFAULT '',
        status TEXT DEFAULT '',
        imported_at TEXT DEFAULT (datetime('now'))
      );
      INSERT INTO users (id, username, password_hash) VALUES (1, 'admin', 'hash');
    `);
    return fn(db);
  } finally {
    db.close();
  }
}

test('initLocalAgentSchema creates local Agent factory tables', () => withDb((db) => {
  initLocalAgentSchema(db);

  const tables = db.prepare(`
    SELECT name
    FROM sqlite_master
    WHERE type = 'table'
      AND name IN ('agent_runs', 'agent_reports', 'agent_suggestions', 'agent_rules', 'item_maturity_events')
    ORDER BY name
  `).all().map(row => row.name);

  assert.deepEqual(tables, [
    'agent_reports',
    'agent_rules',
    'agent_runs',
    'agent_suggestions',
    'item_maturity_events',
  ]);
}));
```

- [x] **Step 2: Run the schema test and verify it fails**

Run:

```bash
cd server
node --test test/localAgentFactory.test.mjs
```

Expected: fail with `Cannot find module '../utils/localAgentSchema.js'`.

- [x] **Step 3: Implement `initLocalAgentSchema`**

Create `server/utils/localAgentSchema.js`:

```js
export function initLocalAgentSchema(db) {
  if (!db) throw new Error('initLocalAgentSchema requires a database');
  db.exec(`
    CREATE TABLE IF NOT EXISTS agent_runs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      run_type TEXT NOT NULL DEFAULT 'local_factory',
      status TEXT NOT NULL DEFAULT 'running',
      plan_json TEXT DEFAULT '{}',
      summary_json TEXT DEFAULT '{}',
      started_at TEXT DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
      completed_at TEXT DEFAULT '',
      created_at TEXT DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    );
    CREATE INDEX IF NOT EXISTS idx_agent_runs_user ON agent_runs(user_id, created_at);
    CREATE INDEX IF NOT EXISTS idx_agent_runs_type_status ON agent_runs(run_type, status);

    CREATE TABLE IF NOT EXISTS agent_reports (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      scope_type TEXT NOT NULL DEFAULT 'personal',
      scope_id INTEGER,
      report_type TEXT NOT NULL DEFAULT 'daily',
      content_json TEXT NOT NULL DEFAULT '{}',
      created_at TEXT DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    );
    CREATE INDEX IF NOT EXISTS idx_agent_reports_user ON agent_reports(user_id, created_at);
    CREATE INDEX IF NOT EXISTS idx_agent_reports_type ON agent_reports(report_type, created_at);

    CREATE TABLE IF NOT EXISTS agent_suggestions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      item_id INTEGER,
      suggestion_type TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'pending',
      proposal_json TEXT NOT NULL DEFAULT '{}',
      reason TEXT DEFAULT '',
      confidence REAL DEFAULT 0,
      evidence_json TEXT NOT NULL DEFAULT '{}',
      created_at TEXT DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
      updated_at TEXT DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
      resolved_at TEXT DEFAULT '',
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
      FOREIGN KEY (item_id) REFERENCES links(id) ON DELETE CASCADE
    );
    CREATE INDEX IF NOT EXISTS idx_agent_suggestions_user_status ON agent_suggestions(user_id, status, created_at);
    CREATE INDEX IF NOT EXISTS idx_agent_suggestions_item ON agent_suggestions(item_id, status);

    CREATE TABLE IF NOT EXISTS agent_rules (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      rule_type TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'active',
      title TEXT NOT NULL,
      condition_json TEXT NOT NULL DEFAULT '{}',
      action_json TEXT NOT NULL DEFAULT '{}',
      source_suggestion_id INTEGER,
      created_at TEXT DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
      updated_at TEXT DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
      FOREIGN KEY (source_suggestion_id) REFERENCES agent_suggestions(id) ON DELETE SET NULL
    );
    CREATE INDEX IF NOT EXISTS idx_agent_rules_user_status ON agent_rules(user_id, status, rule_type);

    CREATE TABLE IF NOT EXISTS item_maturity_events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      item_id INTEGER NOT NULL,
      user_id INTEGER NOT NULL,
      from_state TEXT DEFAULT '',
      to_state TEXT NOT NULL,
      reason TEXT DEFAULT '',
      metadata_json TEXT NOT NULL DEFAULT '{}',
      created_at TEXT DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
      FOREIGN KEY (item_id) REFERENCES links(id) ON DELETE CASCADE,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    );
    CREATE INDEX IF NOT EXISTS idx_item_maturity_events_item ON item_maturity_events(item_id, created_at);
    CREATE INDEX IF NOT EXISTS idx_item_maturity_events_user ON item_maturity_events(user_id, created_at);
  `);
}
```

- [x] **Step 4: Add migration `016_local_agent_factory_schema`**

Modify `server/utils/dbMigrations.js`:

```js
import { initLocalAgentSchema } from './localAgentSchema.js';
```

Add after migration `015_assistant_memory_schema`:

```js
  {
    name: '016_local_agent_factory_schema',
    up(db) {
      initLocalAgentSchema(db);
    },
  },
```

- [x] **Step 5: Run tests**

Run:

```bash
cd server
node --test test/localAgentFactory.test.mjs
node --test test/dbMigrations.test.mjs
```

Expected: pass.

- [x] **Step 6: Commit**

```bash
git add server/utils/localAgentSchema.js server/utils/dbMigrations.js server/test/localAgentFactory.test.mjs
git commit -m "Add local agent factory schema"
```

---

### Task 2: Item Maturity Derivation

**Files:**
- Create: `server/utils/itemMaturity.js`
- Modify: `server/test/localAgentFactory.test.mjs`

- [x] **Step 1: Add failing maturity tests**

Append to `server/test/localAgentFactory.test.mjs`:

```js
import { deriveItemMaturity, getMaturityCoverage } from '../utils/itemMaturity.js';

function seedItem(db, fields = {}) {
  const result = db.prepare(`
    INSERT INTO links (user_id, type, title, summary, content, content_md, description, status, imported_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    fields.userId || 1,
    fields.type || 'link',
    fields.title || 'Example item',
    fields.summary || '',
    fields.content || '',
    fields.contentMd || '',
    fields.description || '',
    fields.status || '',
    fields.importedAt || '2026-06-26T00:00:00.000Z',
  );
  return result.lastInsertRowid;
}

test('deriveItemMaturity reports raw converted indexed understood summarized and review states', () => withDb((db) => {
  initLocalAgentSchema(db);
  db.exec(`
    CREATE TABLE documents (id INTEGER PRIMARY KEY AUTOINCREMENT, item_id INTEGER NOT NULL, user_id INTEGER NOT NULL);
    CREATE TABLE document_chunks (id INTEGER PRIMARY KEY AUTOINCREMENT, document_id INTEGER NOT NULL, chunk_index INTEGER NOT NULL, content TEXT NOT NULL);
    CREATE TABLE item_understanding_runs (item_id INTEGER PRIMARY KEY, user_id INTEGER NOT NULL, updated_at TEXT DEFAULT '');
    CREATE TABLE jobs (id INTEGER PRIMARY KEY AUTOINCREMENT, type TEXT NOT NULL, link_id INTEGER, status TEXT NOT NULL, last_error TEXT DEFAULT '');
  `);
  const rawId = seedItem(db);
  const summarizedId = seedItem(db, { contentMd: '# Body', summary: 'Useful summary' });
  const documentId = db.prepare('INSERT INTO documents (item_id, user_id) VALUES (?, 1)').run(summarizedId).lastInsertRowid;
  db.prepare('INSERT INTO document_chunks (document_id, chunk_index, content) VALUES (?, 0, ?)').run(documentId, 'Body chunk');
  db.prepare('INSERT INTO item_understanding_runs (item_id, user_id) VALUES (?, 1)').run(summarizedId);
  db.prepare("INSERT INTO agent_suggestions (user_id, item_id, suggestion_type, status, proposal_json) VALUES (1, ?, 'topic_suggestion', 'pending', '{}')").run(summarizedId);

  assert.equal(deriveItemMaturity(db, rawId).state, 'raw');
  const maturity = deriveItemMaturity(db, summarizedId);
  assert.equal(maturity.state, 'review_needed');
  assert.deepEqual(maturity.flags, {
    hasContent: true,
    hasDocument: true,
    hasChunks: true,
    hasUnderstanding: true,
    hasSummary: true,
    hasPendingSuggestion: true,
    hasFailedJob: false,
  });
}));

test('getMaturityCoverage counts states for a user library', () => withDb((db) => {
  initLocalAgentSchema(db);
  db.exec(`
    CREATE TABLE documents (id INTEGER PRIMARY KEY AUTOINCREMENT, item_id INTEGER NOT NULL, user_id INTEGER NOT NULL);
    CREATE TABLE document_chunks (id INTEGER PRIMARY KEY AUTOINCREMENT, document_id INTEGER NOT NULL, chunk_index INTEGER NOT NULL, content TEXT NOT NULL);
    CREATE TABLE item_understanding_runs (item_id INTEGER PRIMARY KEY, user_id INTEGER NOT NULL, updated_at TEXT DEFAULT '');
    CREATE TABLE jobs (id INTEGER PRIMARY KEY AUTOINCREMENT, type TEXT NOT NULL, link_id INTEGER, status TEXT NOT NULL, last_error TEXT DEFAULT '');
  `);
  seedItem(db);
  const convertedId = seedItem(db, { contentMd: 'Converted markdown' });
  const documentId = db.prepare('INSERT INTO documents (item_id, user_id) VALUES (?, 1)').run(convertedId).lastInsertRowid;
  db.prepare('INSERT INTO document_chunks (document_id, chunk_index, content) VALUES (?, 0, ?)').run(documentId, 'Chunk');

  const coverage = getMaturityCoverage(db, { userId: 1 });
  assert.equal(coverage.total, 2);
  assert.equal(coverage.states.raw, 1);
  assert.equal(coverage.states.indexed, 1);
  assert.equal(coverage.reviewNeeded, 0);
}));
```

- [x] **Step 2: Run the maturity tests and verify they fail**

Run:

```bash
cd server
node --test test/localAgentFactory.test.mjs
```

Expected: fail with missing `server/utils/itemMaturity.js`.

- [x] **Step 3: Implement `itemMaturity.js`**

Create `server/utils/itemMaturity.js`:

```js
function tableExists(db, table) {
  return Boolean(db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?").get(table));
}

function hasRow(db, sql, ...params) {
  return Boolean(db.prepare(sql).get(...params));
}

function itemRow(db, itemId) {
  return db.prepare('SELECT * FROM links WHERE id = ?').get(itemId);
}

export function deriveItemMaturity(db, itemId) {
  if (!db) throw new Error('deriveItemMaturity requires a database');
  const item = itemRow(db, itemId);
  if (!item) throw new Error('Item not found');

  const hasContent = Boolean(
    item.content_md || item.content || item.description || item.summary || item.html_note || item.image_path,
  );
  const hasSummary = Boolean(String(item.summary || '').trim());
  const hasDocument = tableExists(db, 'documents') && hasRow(db, 'SELECT id FROM documents WHERE item_id = ? LIMIT 1', itemId);
  const hasChunks = tableExists(db, 'documents') && tableExists(db, 'document_chunks') && hasRow(db, `
    SELECT c.id
    FROM document_chunks c
    JOIN documents d ON d.id = c.document_id
    WHERE d.item_id = ?
    LIMIT 1
  `, itemId);
  const hasUnderstanding = tableExists(db, 'item_understanding_runs')
    && hasRow(db, 'SELECT item_id FROM item_understanding_runs WHERE item_id = ? LIMIT 1', itemId);
  const hasPendingSuggestion = tableExists(db, 'agent_suggestions')
    && hasRow(db, "SELECT id FROM agent_suggestions WHERE item_id = ? AND status = 'pending' LIMIT 1", itemId);
  const hasFailedJob = tableExists(db, 'jobs')
    && hasRow(db, "SELECT id FROM jobs WHERE link_id = ? AND status = 'failed' LIMIT 1", itemId);

  let state = 'raw';
  if (hasContent) state = 'converted';
  if (hasChunks) state = 'indexed';
  if (hasUnderstanding) state = 'understood';
  if (hasSummary && (state === 'converted' || state === 'indexed' || state === 'understood')) state = 'summarized';
  if (hasPendingSuggestion || hasFailedJob) state = 'review_needed';

  return {
    itemId,
    state,
    flags: {
      hasContent,
      hasDocument,
      hasChunks,
      hasUnderstanding,
      hasSummary,
      hasPendingSuggestion,
      hasFailedJob,
    },
  };
}

export function getMaturityCoverage(db, { userId = 1, limit = 5000 } = {}) {
  if (!db) throw new Error('getMaturityCoverage requires a database');
  const rows = db.prepare(`
    SELECT id
    FROM links
    WHERE user_id = ?
    ORDER BY datetime(imported_at) DESC, id DESC
    LIMIT ?
  `).all(userId, Math.max(1, Math.min(20000, Number(limit) || 5000)));

  const states = {
    raw: 0,
    converted: 0,
    indexed: 0,
    understood: 0,
    summarized: 0,
    review_needed: 0,
    reviewed: 0,
  };
  const items = rows.map((row) => {
    const maturity = deriveItemMaturity(db, row.id);
    states[maturity.state] = (states[maturity.state] || 0) + 1;
    return maturity;
  });

  return {
    total: rows.length,
    states,
    reviewNeeded: states.review_needed,
    ready: states.indexed + states.understood + states.summarized,
    items,
  };
}
```

- [x] **Step 4: Run tests**

Run:

```bash
cd server
node --test test/localAgentFactory.test.mjs
```

Expected: pass.

- [x] **Step 5: Commit**

```bash
git add server/utils/itemMaturity.js server/test/localAgentFactory.test.mjs
git commit -m "Derive local agent item maturity"
```

---

### Task 3: Local Agent Reports

**Files:**
- Create: `server/utils/localAgentFactory.js`
- Modify: `server/test/localAgentFactory.test.mjs`

- [x] **Step 1: Add failing report tests**

Append to `server/test/localAgentFactory.test.mjs`:

```js
import {
  generateLocalAgentReport,
  getLocalAgentStatus,
} from '../utils/localAgentFactory.js';

test('generateLocalAgentReport records a local factory run and report', () => withDb((db) => {
  initLocalAgentSchema(db);
  db.exec(`
    CREATE TABLE documents (id INTEGER PRIMARY KEY AUTOINCREMENT, item_id INTEGER NOT NULL, user_id INTEGER NOT NULL);
    CREATE TABLE document_chunks (id INTEGER PRIMARY KEY AUTOINCREMENT, document_id INTEGER NOT NULL, chunk_index INTEGER NOT NULL, content TEXT NOT NULL);
    CREATE TABLE item_understanding_runs (item_id INTEGER PRIMARY KEY, user_id INTEGER NOT NULL, updated_at TEXT DEFAULT '');
    CREATE TABLE jobs (id INTEGER PRIMARY KEY AUTOINCREMENT, type TEXT NOT NULL, link_id INTEGER, status TEXT NOT NULL, last_error TEXT DEFAULT '');
  `);
  seedItem(db, { contentMd: 'Ready article', summary: 'Summary' });
  db.prepare("INSERT INTO jobs (type, link_id, status, last_error) VALUES ('image.describe', 1, 'failed', 'empty output')").run();

  const report = generateLocalAgentReport(db, { userId: 1 });

  assert.equal(report.reportType, 'daily');
  assert.equal(report.content.library.total, 1);
  assert.equal(report.content.jobs.failed, 1);
  assert.equal(report.content.headline.includes('本地 Agent'), true);
  assert.equal(db.prepare('SELECT COUNT(*) AS count FROM agent_reports').get().count, 1);
  assert.equal(db.prepare('SELECT status FROM agent_runs ORDER BY id DESC LIMIT 1').get().status, 'completed');
}));

test('getLocalAgentStatus returns coverage latest report suggestions and rules', () => withDb((db) => {
  initLocalAgentSchema(db);
  db.exec(`
    CREATE TABLE documents (id INTEGER PRIMARY KEY AUTOINCREMENT, item_id INTEGER NOT NULL, user_id INTEGER NOT NULL);
    CREATE TABLE document_chunks (id INTEGER PRIMARY KEY AUTOINCREMENT, document_id INTEGER NOT NULL, chunk_index INTEGER NOT NULL, content TEXT NOT NULL);
    CREATE TABLE item_understanding_runs (item_id INTEGER PRIMARY KEY, user_id INTEGER NOT NULL, updated_at TEXT DEFAULT '');
    CREATE TABLE jobs (id INTEGER PRIMARY KEY AUTOINCREMENT, type TEXT NOT NULL, link_id INTEGER, status TEXT NOT NULL, last_error TEXT DEFAULT '');
  `);
  seedItem(db);
  generateLocalAgentReport(db, { userId: 1 });

  const status = getLocalAgentStatus(db, { userId: 1 });

  assert.equal(status.coverage.total, 1);
  assert.equal(status.latestReport.reportType, 'daily');
  assert.deepEqual(status.suggestions, []);
  assert.deepEqual(status.rules, []);
}));
```

- [x] **Step 2: Run tests and verify failure**

Run:

```bash
cd server
node --test test/localAgentFactory.test.mjs
```

Expected: fail with missing exports from `localAgentFactory.js`.

- [x] **Step 3: Implement report generation**

Create `server/utils/localAgentFactory.js`:

```js
import { initLocalAgentSchema } from './localAgentSchema.js';
import { getMaturityCoverage } from './itemMaturity.js';

function nowIso() {
  return new Date().toISOString();
}

function parseJson(raw, fallback) {
  try {
    return JSON.parse(raw || '');
  } catch {
    return fallback;
  }
}

function jobCounts(db) {
  const exists = db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'jobs'").get();
  if (!exists) return { queued: 0, running: 0, done: 0, failed: 0 };
  const rows = db.prepare('SELECT status, COUNT(*) AS count FROM jobs GROUP BY status').all();
  return {
    queued: 0,
    running: 0,
    done: 0,
    failed: 0,
    ...Object.fromEntries(rows.map(row => [row.status, Number(row.count || 0)])),
  };
}

function pendingSuggestionCount(db, userId) {
  return Number(db.prepare(`
    SELECT COUNT(*) AS count
    FROM agent_suggestions
    WHERE user_id = ? AND status = 'pending'
  `).get(userId)?.count || 0);
}

function activeRuleCount(db, userId) {
  return Number(db.prepare(`
    SELECT COUNT(*) AS count
    FROM agent_rules
    WHERE user_id = ? AND status = 'active'
  `).get(userId)?.count || 0);
}

function buildHeadline({ coverage, jobs, suggestions }) {
  return `本地 Agent 已观察 ${coverage.total} 条资料，${coverage.ready} 条可检索，${coverage.reviewNeeded + suggestions} 条需要你确认，${jobs.failed} 个任务失败。`;
}

function insertRun(db, { userId, plan }) {
  const result = db.prepare(`
    INSERT INTO agent_runs (user_id, run_type, status, plan_json)
    VALUES (?, 'local_factory.report', 'running', ?)
  `).run(userId, JSON.stringify(plan));
  return result.lastInsertRowid;
}

function completeRun(db, { runId, summary }) {
  db.prepare(`
    UPDATE agent_runs
    SET status = 'completed',
        summary_json = ?,
        completed_at = ? 
    WHERE id = ?
  `).run(JSON.stringify(summary), nowIso(), runId);
}

export function generateLocalAgentReport(db, { userId = 1, reportType = 'daily' } = {}) {
  initLocalAgentSchema(db);
  const plan = {
    observe: ['library_maturity', 'jobs', 'suggestions', 'rules'],
    reportType,
  };
  const runId = insertRun(db, { userId, plan });
  const coverage = getMaturityCoverage(db, { userId });
  const jobs = jobCounts(db);
  const suggestions = pendingSuggestionCount(db, userId);
  const rules = activeRuleCount(db, userId);
  const content = {
    headline: buildHeadline({ coverage, jobs, suggestions }),
    library: {
      total: coverage.total,
      states: coverage.states,
      ready: coverage.ready,
      reviewNeeded: coverage.reviewNeeded,
    },
    jobs,
    suggestions: {
      pending: suggestions,
    },
    rules: {
      active: rules,
    },
    generatedAt: nowIso(),
  };
  db.prepare(`
    INSERT INTO agent_reports (user_id, report_type, content_json)
    VALUES (?, ?, ?)
  `).run(userId, reportType, JSON.stringify(content));
  completeRun(db, { runId, summary: content });
  return {
    reportType,
    content,
  };
}

export function listLocalAgentSuggestions(db, { userId = 1, status = 'pending', limit = 20 } = {}) {
  initLocalAgentSchema(db);
  return db.prepare(`
    SELECT id, user_id, item_id, suggestion_type, status, proposal_json, reason,
           confidence, evidence_json, created_at, updated_at, resolved_at
    FROM agent_suggestions
    WHERE user_id = ? AND status = ?
    ORDER BY datetime(created_at) DESC, id DESC
    LIMIT ?
  `).all(userId, status, Math.max(1, Math.min(100, Number(limit) || 20))).map(row => ({
    ...row,
    proposal: parseJson(row.proposal_json, {}),
    evidence: parseJson(row.evidence_json, {}),
    proposal_json: undefined,
    evidence_json: undefined,
  }));
}

export function listLocalAgentRules(db, { userId = 1, limit = 20 } = {}) {
  initLocalAgentSchema(db);
  return db.prepare(`
    SELECT id, user_id, rule_type, status, title, condition_json, action_json,
           source_suggestion_id, created_at, updated_at
    FROM agent_rules
    WHERE user_id = ?
    ORDER BY datetime(created_at) DESC, id DESC
    LIMIT ?
  `).all(userId, Math.max(1, Math.min(100, Number(limit) || 20))).map(row => ({
    ...row,
    condition: parseJson(row.condition_json, {}),
    action: parseJson(row.action_json, {}),
    condition_json: undefined,
    action_json: undefined,
  }));
}

export function latestLocalAgentReport(db, { userId = 1 } = {}) {
  initLocalAgentSchema(db);
  const row = db.prepare(`
    SELECT id, report_type, content_json, created_at
    FROM agent_reports
    WHERE user_id = ?
    ORDER BY datetime(created_at) DESC, id DESC
    LIMIT 1
  `).get(userId);
  if (!row) return null;
  return {
    id: row.id,
    reportType: row.report_type,
    content: parseJson(row.content_json, {}),
    createdAt: row.created_at,
  };
}

export function getLocalAgentStatus(db, { userId = 1 } = {}) {
  initLocalAgentSchema(db);
  return {
    coverage: getMaturityCoverage(db, { userId }),
    latestReport: latestLocalAgentReport(db, { userId }),
    suggestions: listLocalAgentSuggestions(db, { userId }),
    rules: listLocalAgentRules(db, { userId }),
  };
}
```

- [x] **Step 4: Run tests**

Run:

```bash
cd server
node --test test/localAgentFactory.test.mjs
```

Expected: pass.

- [x] **Step 5: Commit**

```bash
git add server/utils/localAgentFactory.js server/test/localAgentFactory.test.mjs
git commit -m "Generate local agent reports"
```

---

### Task 4: Suggestions And Rules Lifecycle

**Files:**
- Modify: `server/utils/localAgentFactory.js`
- Modify: `server/test/localAgentFactory.test.mjs`

- [x] **Step 1: Add failing suggestion lifecycle tests**

Append to `server/test/localAgentFactory.test.mjs`:

```js
import {
  createTopicSuggestions,
  resolveLocalAgentSuggestion,
} from '../utils/localAgentFactory.js';

test('createTopicSuggestions creates pending suggestions from item topics', () => withDb((db) => {
  initLocalAgentSchema(db);
  db.exec(`
    CREATE TABLE documents (id INTEGER PRIMARY KEY AUTOINCREMENT, item_id INTEGER NOT NULL, user_id INTEGER NOT NULL);
    CREATE TABLE document_chunks (id INTEGER PRIMARY KEY AUTOINCREMENT, document_id INTEGER NOT NULL, chunk_index INTEGER NOT NULL, content TEXT NOT NULL);
    CREATE TABLE item_understanding_runs (item_id INTEGER PRIMARY KEY, user_id INTEGER NOT NULL, updated_at TEXT DEFAULT '');
    CREATE TABLE item_topics (id INTEGER PRIMARY KEY AUTOINCREMENT, item_id INTEGER NOT NULL, user_id INTEGER NOT NULL, name TEXT NOT NULL, weight REAL DEFAULT 1);
    CREATE TABLE jobs (id INTEGER PRIMARY KEY AUTOINCREMENT, type TEXT NOT NULL, link_id INTEGER, status TEXT NOT NULL, last_error TEXT DEFAULT '');
  `);
  const itemId = seedItem(db, { title: 'Codex Agent note', contentMd: 'Codex can automate local work.' });
  db.prepare("INSERT INTO item_topics (item_id, user_id, name, weight) VALUES (?, 1, 'AI Agent', 0.92)").run(itemId);

  const result = createTopicSuggestions(db, { userId: 1 });

  assert.equal(result.created, 1);
  const suggestion = db.prepare('SELECT * FROM agent_suggestions').get();
  assert.equal(suggestion.suggestion_type, 'topic_suggestion');
  assert.equal(suggestion.status, 'pending');
  assert.equal(JSON.parse(suggestion.proposal_json).topic, 'AI Agent');
}));

test('resolveLocalAgentSuggestion accepts a suggestion and creates an active rule', () => withDb((db) => {
  initLocalAgentSchema(db);
  const itemId = seedItem(db, { title: 'Codex Agent note' });
  const suggestionId = db.prepare(`
    INSERT INTO agent_suggestions (user_id, item_id, suggestion_type, status, proposal_json, reason, confidence, evidence_json)
    VALUES (1, ?, 'topic_suggestion', 'pending', ?, 'Topic appears repeatedly', 0.9, ?)
  `).run(
    itemId,
    JSON.stringify({ topic: 'AI Agent', title: '把类似资料归到 AI Agent' }),
    JSON.stringify({ topic: 'AI Agent' }),
  ).lastInsertRowid;

  const result = resolveLocalAgentSuggestion(db, {
    userId: 1,
    suggestionId,
    action: 'accept',
  });

  assert.equal(result.status, 'accepted');
  const rule = db.prepare('SELECT * FROM agent_rules WHERE source_suggestion_id = ?').get(suggestionId);
  assert.equal(rule.status, 'active');
  assert.equal(rule.rule_type, 'topic_preference');
  assert.equal(JSON.parse(rule.action_json).topic, 'AI Agent');
}));

test('resolveLocalAgentSuggestion rejects a suggestion without creating a rule', () => withDb((db) => {
  initLocalAgentSchema(db);
  const suggestionId = db.prepare(`
    INSERT INTO agent_suggestions (user_id, suggestion_type, status, proposal_json)
    VALUES (1, 'topic_suggestion', 'pending', ?)
  `).run(JSON.stringify({ topic: 'Noise' })).lastInsertRowid;

  const result = resolveLocalAgentSuggestion(db, {
    userId: 1,
    suggestionId,
    action: 'reject',
  });

  assert.equal(result.status, 'rejected');
  assert.equal(db.prepare('SELECT COUNT(*) AS count FROM agent_rules').get().count, 0);
}));
```

- [x] **Step 2: Run tests and verify failure**

Run:

```bash
cd server
node --test test/localAgentFactory.test.mjs
```

Expected: fail with missing `createTopicSuggestions` and `resolveLocalAgentSuggestion`.

- [x] **Step 3: Implement suggestions and rules**

Add to `server/utils/localAgentFactory.js`:

```js
function tableExists(db, table) {
  return Boolean(db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?").get(table));
}

function suggestionFromRow(row) {
  return {
    ...row,
    proposal: parseJson(row.proposal_json, {}),
    evidence: parseJson(row.evidence_json, {}),
    proposal_json: undefined,
    evidence_json: undefined,
  };
}

export function createTopicSuggestions(db, { userId = 1, limit = 20 } = {}) {
  initLocalAgentSchema(db);
  if (!tableExists(db, 'item_topics')) return { created: 0 };
  const rows = db.prepare(`
    SELECT t.item_id, t.name, MAX(t.weight) AS weight, l.title
    FROM item_topics t
    JOIN links l ON l.id = t.item_id
    LEFT JOIN agent_suggestions s
      ON s.item_id = t.item_id
      AND s.suggestion_type = 'topic_suggestion'
      AND s.status IN ('pending', 'accepted')
    WHERE t.user_id = ?
      AND s.id IS NULL
    GROUP BY t.item_id, t.name, l.title
    ORDER BY weight DESC, t.item_id DESC
    LIMIT ?
  `).all(userId, Math.max(1, Math.min(100, Number(limit) || 20)));

  const insert = db.prepare(`
    INSERT INTO agent_suggestions (
      user_id, item_id, suggestion_type, status, proposal_json, reason, confidence, evidence_json
    ) VALUES (?, ?, 'topic_suggestion', 'pending', ?, ?, ?, ?)
  `);
  let created = 0;
  const tx = db.transaction(() => {
    for (const row of rows) {
      insert.run(
        userId,
        row.item_id,
        JSON.stringify({ topic: row.name, title: `将资料归入主题：${row.name}` }),
        `本地结构化理解识别出主题「${row.name}」。`,
        Math.max(0, Math.min(1, Number(row.weight || 0.7))),
        JSON.stringify({ itemTitle: row.title || '', topic: row.name }),
      );
      created += 1;
    }
  });
  tx();
  return { created };
}

function createRuleForSuggestion(db, suggestion) {
  const proposal = parseJson(suggestion.proposal_json, {});
  if (suggestion.suggestion_type !== 'topic_suggestion') return null;
  const result = db.prepare(`
    INSERT INTO agent_rules (
      user_id, rule_type, status, title, condition_json, action_json, source_suggestion_id
    ) VALUES (?, 'topic_preference', 'active', ?, ?, ?, ?)
  `).run(
    suggestion.user_id,
    proposal.title || `主题偏好：${proposal.topic || '未命名主题'}`,
    JSON.stringify({ source: 'accepted_topic_suggestion' }),
    JSON.stringify({ topic: proposal.topic || '' }),
    suggestion.id,
  );
  return result.lastInsertRowid;
}

export function resolveLocalAgentSuggestion(db, { userId = 1, suggestionId, action } = {}) {
  initLocalAgentSchema(db);
  if (!Number.isInteger(Number(suggestionId))) throw new Error('Invalid suggestion id');
  if (!['accept', 'reject'].includes(action)) throw new Error('Invalid suggestion action');

  const suggestion = db.prepare(`
    SELECT *
    FROM agent_suggestions
    WHERE id = ? AND user_id = ?
  `).get(Number(suggestionId), userId);
  if (!suggestion) throw new Error('Suggestion not found');
  if (suggestion.status !== 'pending') throw new Error('Suggestion is already resolved');

  const status = action === 'accept' ? 'accepted' : 'rejected';
  const resolvedAt = nowIso();
  const tx = db.transaction(() => {
    db.prepare(`
      UPDATE agent_suggestions
      SET status = ?, updated_at = ?, resolved_at = ?
      WHERE id = ?
    `).run(status, resolvedAt, resolvedAt, suggestion.id);
    if (action === 'accept') createRuleForSuggestion(db, suggestion);
  });
  tx();

  const updated = db.prepare('SELECT * FROM agent_suggestions WHERE id = ?').get(suggestion.id);
  return suggestionFromRow(updated);
}
```

Update `listLocalAgentSuggestions` to use `suggestionFromRow(row)` instead of duplicating mapping.

- [x] **Step 4: Run tests**

Run:

```bash
cd server
node --test test/localAgentFactory.test.mjs
```

Expected: pass.

- [x] **Step 5: Commit**

```bash
git add server/utils/localAgentFactory.js server/test/localAgentFactory.test.mjs
git commit -m "Add local agent suggestion lifecycle"
```

---

### Task 5: Admin Local Agent API

**Files:**
- Modify: `server/routes/settings.js`
- Create: `server/test/settingsLocalAgent.test.mjs`

- [x] **Step 1: Write failing route tests**

Create `server/test/settingsLocalAgent.test.mjs`:

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import Database from 'better-sqlite3';
import { generateToken } from '../middleware/auth.js';
import { createSettingsRouter } from '../routes/settings.js';
import { createJobQueue } from '../utils/jobQueue.js';
import { initLocalAgentSchema } from '../utils/localAgentSchema.js';

function createApp() {
  const db = new Database(':memory:');
  db.pragma('foreign_keys = ON');
  db.exec(`
    CREATE TABLE users (id INTEGER PRIMARY KEY AUTOINCREMENT, username TEXT NOT NULL, password_hash TEXT NOT NULL);
    CREATE TABLE links (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      type TEXT DEFAULT 'link',
      url TEXT DEFAULT '',
      title TEXT DEFAULT '',
      summary TEXT DEFAULT '',
      content TEXT DEFAULT '',
      content_md TEXT DEFAULT '',
      description TEXT DEFAULT '',
      status TEXT DEFAULT '',
      imported_at TEXT DEFAULT (datetime('now'))
    );
    CREATE TABLE settings (key TEXT PRIMARY KEY, value TEXT DEFAULT '');
    CREATE TABLE documents (id INTEGER PRIMARY KEY AUTOINCREMENT, item_id INTEGER NOT NULL, user_id INTEGER NOT NULL);
    CREATE TABLE document_chunks (id INTEGER PRIMARY KEY AUTOINCREMENT, document_id INTEGER NOT NULL, chunk_index INTEGER NOT NULL, content TEXT NOT NULL);
    CREATE TABLE item_understanding_runs (item_id INTEGER PRIMARY KEY, user_id INTEGER NOT NULL, updated_at TEXT DEFAULT '');
    INSERT INTO users (id, username, password_hash) VALUES (1, 'admin', 'hash'), (2, 'user', 'hash');
    INSERT INTO links (id, user_id, title, content_md, summary) VALUES (1, 1, 'Agent note', 'Markdown body', 'Summary');
  `);
  initLocalAgentSchema(db);
  const queue = createJobQueue({ db, autoStart: false });
  const app = express();
  app.use(express.json());
  app.use('/api/settings', createSettingsRouter({
    database: db,
    getQueue: () => queue,
    uploadsDir: '/tmp/uploads',
  }));
  return { app, db, queue };
}

async function listen(app) {
  return new Promise((resolve, reject) => {
    const server = app.listen(0, '127.0.0.1', () => resolve(server));
    server.on('error', reject);
  });
}

test('GET /api/settings/local-agent returns local factory status for admin', async () => {
  const { app, db } = createApp();
  const server = await listen(app);
  try {
    db.prepare(`
      INSERT INTO agent_suggestions (user_id, item_id, suggestion_type, status, proposal_json)
      VALUES (1, 1, 'topic_suggestion', 'pending', ?)
    `).run(JSON.stringify({ topic: 'AI Agent' }));
    const response = await fetch(`http://127.0.0.1:${server.address().port}/api/settings/local-agent`, {
      headers: { Authorization: `Bearer ${generateToken(1)}` },
    });
    const body = await response.json();

    assert.equal(response.status, 200);
    assert.equal(body.coverage.total, 1);
    assert.equal(body.suggestions.length, 1);
  } finally {
    await new Promise(resolve => server.close(resolve));
    db.close();
  }
});

test('POST /api/settings/local-agent/report creates a local factory report', async () => {
  const { app, db } = createApp();
  const server = await listen(app);
  try {
    const response = await fetch(`http://127.0.0.1:${server.address().port}/api/settings/local-agent/report`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${generateToken(1)}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ reportType: 'daily' }),
    });
    const body = await response.json();

    assert.equal(response.status, 200);
    assert.equal(body.ok, true);
    assert.equal(body.report.reportType, 'daily');
    assert.equal(db.prepare('SELECT COUNT(*) AS count FROM agent_reports').get().count, 1);
  } finally {
    await new Promise(resolve => server.close(resolve));
    db.close();
  }
});

test('POST /api/settings/local-agent/suggestions/:id/resolve accepts a suggestion', async () => {
  const { app, db } = createApp();
  const suggestionId = db.prepare(`
    INSERT INTO agent_suggestions (user_id, item_id, suggestion_type, status, proposal_json)
    VALUES (1, 1, 'topic_suggestion', 'pending', ?)
  `).run(JSON.stringify({ topic: 'AI Agent' })).lastInsertRowid;
  const server = await listen(app);
  try {
    const response = await fetch(`http://127.0.0.1:${server.address().port}/api/settings/local-agent/suggestions/${suggestionId}/resolve`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${generateToken(1)}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ action: 'accept' }),
    });
    const body = await response.json();

    assert.equal(response.status, 200);
    assert.equal(body.suggestion.status, 'accepted');
    assert.equal(db.prepare('SELECT COUNT(*) AS count FROM agent_rules').get().count, 1);
  } finally {
    await new Promise(resolve => server.close(resolve));
    db.close();
  }
});

test('local Agent endpoints require admin', async () => {
  const { app, db } = createApp();
  const server = await listen(app);
  try {
    const response = await fetch(`http://127.0.0.1:${server.address().port}/api/settings/local-agent`, {
      headers: { Authorization: `Bearer ${generateToken(2)}` },
    });
    assert.equal(response.status, 403);
  } finally {
    await new Promise(resolve => server.close(resolve));
    db.close();
  }
});
```

- [x] **Step 2: Run route tests and verify failure**

Run:

```bash
cd server
node --test test/settingsLocalAgent.test.mjs
```

Expected: fail with 404 responses for local Agent endpoints.

- [x] **Step 3: Add settings routes**

Modify `server/routes/settings.js` imports:

```js
import {
  createTopicSuggestions,
  generateLocalAgentReport,
  getLocalAgentStatus,
  resolveLocalAgentSuggestion,
} from '../utils/localAgentFactory.js';
```

Add routes before `// PUT /api/settings - update one or more settings`:

```js
// GET /api/settings/local-agent - local Agent factory workbench payload
router.get('/local-agent', authMiddleware, requireAdmin, (req, res) => {
  res.json(getLocalAgentStatus(database, { userId: req.userId }));
});

// POST /api/settings/local-agent/report - generate local Agent report
router.post('/local-agent/report', authMiddleware, requireAdmin, (req, res) => {
  const report = generateLocalAgentReport(database, {
    userId: req.userId,
    reportType: req.body?.reportType || 'daily',
  });
  res.json({
    ok: true,
    report,
    status: getLocalAgentStatus(database, { userId: req.userId }),
  });
});

// POST /api/settings/local-agent/suggestions/generate - create topic suggestions
router.post('/local-agent/suggestions/generate', authMiddleware, requireAdmin, (req, res) => {
  const result = createTopicSuggestions(database, {
    userId: req.userId,
    limit: req.body?.limit,
  });
  res.json({
    ok: true,
    ...result,
    status: getLocalAgentStatus(database, { userId: req.userId }),
  });
});

// POST /api/settings/local-agent/suggestions/:id/resolve - accept/reject suggestion
router.post('/local-agent/suggestions/:id/resolve', authMiddleware, requireAdmin, (req, res) => {
  try {
    const suggestion = resolveLocalAgentSuggestion(database, {
      userId: req.userId,
      suggestionId: Number(req.params.id),
      action: req.body?.action,
    });
    res.json({
      ok: true,
      suggestion,
      status: getLocalAgentStatus(database, { userId: req.userId }),
    });
  } catch (e) {
    jsonError(res, httpError(400, e.message || 'Agent 建议处理失败'), 'Agent 建议处理失败');
  }
});
```

- [x] **Step 4: Run route tests**

Run:

```bash
cd server
node --test test/settingsLocalAgent.test.mjs
node --test test/settingsSystem.test.mjs
```

Expected: pass.

- [x] **Step 5: Commit**

```bash
git add server/routes/settings.js server/test/settingsLocalAgent.test.mjs
git commit -m "Expose local agent workbench API"
```

---

### Task 6: Client API And Display Helpers

**Files:**
- Modify: `client/src/api/client.ts`
- Create: `client/src/pages/localAgentWorkbenchUtils.ts`
- Create: `client/src/pages/localAgentWorkbenchUtils.test.js`

- [x] **Step 1: Write failing display helper tests**

Create `client/src/pages/localAgentWorkbenchUtils.test.js`:

```js
import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  maturityPercent,
  maturityRows,
  suggestionActionLabel,
} from './localAgentWorkbenchUtils.ts';

test('maturityPercent calculates rounded coverage percentage', () => {
  assert.equal(maturityPercent(3, 10), 30);
  assert.equal(maturityPercent(0, 0), 0);
});

test('maturityRows returns stable local Agent state labels', () => {
  const rows = maturityRows({
    raw: 1,
    converted: 2,
    indexed: 3,
    understood: 4,
    summarized: 5,
    review_needed: 6,
    reviewed: 7,
  });

  assert.deepEqual(rows.map(row => row.key), [
    'raw',
    'converted',
    'indexed',
    'understood',
    'summarized',
    'review_needed',
    'reviewed',
  ]);
  assert.equal(rows.at(-1).label, '已确认');
});

test('suggestionActionLabel maps suggestion types to user-facing commands', () => {
  assert.equal(suggestionActionLabel('topic_suggestion'), '主题建议');
  assert.equal(suggestionActionLabel('unknown'), 'Agent 建议');
});
```

- [x] **Step 2: Run client tests and verify failure**

Run:

```bash
cd client
node --test src/pages/localAgentWorkbenchUtils.test.js
```

Expected: fail with missing `localAgentWorkbenchUtils.ts`.

- [x] **Step 3: Add API types and methods**

Modify `client/src/api/client.ts` near settings types:

```ts
export interface LocalAgentCoverage {
  total: number;
  states: Record<string, number>;
  reviewNeeded: number;
  ready: number;
}

export interface LocalAgentReport {
  id?: number;
  reportType: string;
  content: {
    headline?: string;
    library?: {
      total?: number;
      states?: Record<string, number>;
      ready?: number;
      reviewNeeded?: number;
    };
    jobs?: Record<string, number>;
    suggestions?: { pending?: number };
    rules?: { active?: number };
    generatedAt?: string;
  };
  createdAt?: string;
}

export interface LocalAgentSuggestion {
  id: number;
  item_id?: number | null;
  suggestion_type: string;
  status: string;
  proposal?: Record<string, unknown>;
  reason?: string;
  confidence?: number;
  evidence?: Record<string, unknown>;
  created_at?: string;
  updated_at?: string;
  resolved_at?: string;
}

export interface LocalAgentRule {
  id: number;
  rule_type: string;
  status: string;
  title: string;
  condition?: Record<string, unknown>;
  action?: Record<string, unknown>;
  created_at?: string;
}

export interface LocalAgentStatus {
  coverage: LocalAgentCoverage;
  latestReport: LocalAgentReport | null;
  suggestions: LocalAgentSuggestion[];
  rules: LocalAgentRule[];
}
```

Add API methods near settings API:

```ts
  getLocalAgentStatus: (): Promise<LocalAgentStatus> => request('/settings/local-agent'),
  generateLocalAgentReport: (reportType = 'daily'): Promise<{ ok: boolean; report: LocalAgentReport; status: LocalAgentStatus }> =>
    request('/settings/local-agent/report', { method: 'POST', body: JSON.stringify({ reportType }) }),
  generateLocalAgentSuggestions: (): Promise<{ ok: boolean; created: number; status: LocalAgentStatus }> =>
    request('/settings/local-agent/suggestions/generate', { method: 'POST', body: JSON.stringify({}) }),
  resolveLocalAgentSuggestion: (id: number, action: 'accept' | 'reject'): Promise<{ ok: boolean; suggestion: LocalAgentSuggestion; status: LocalAgentStatus }> =>
    request(`/settings/local-agent/suggestions/${id}/resolve`, { method: 'POST', body: JSON.stringify({ action }) }),
```

- [x] **Step 4: Add display helpers**

Create `client/src/pages/localAgentWorkbenchUtils.ts`:

```ts
const MATURITY_LABELS: Array<{ key: string; label: string; tone: string }> = [
  { key: 'raw', label: '原始资料', tone: 'gray' },
  { key: 'converted', label: '已转文本', tone: 'blue' },
  { key: 'indexed', label: '已索引', tone: 'sky' },
  { key: 'understood', label: '已理解', tone: 'indigo' },
  { key: 'summarized', label: '已总结', tone: 'emerald' },
  { key: 'review_needed', label: '待确认', tone: 'amber' },
  { key: 'reviewed', label: '已确认', tone: 'green' },
];

export function maturityPercent(value: number, total: number) {
  if (!total) return 0;
  return Math.round((Number(value || 0) / Number(total || 0)) * 100);
}

export function maturityRows(states: Record<string, number> = {}) {
  return MATURITY_LABELS.map((row) => ({
    ...row,
    value: Number(states[row.key] || 0),
  }));
}

export function suggestionActionLabel(type: string) {
  const labels: Record<string, string> = {
    tag_suggestion: '标签建议',
    topic_suggestion: '主题建议',
    project_suggestion: '项目建议',
    todo_suggestion: '待办建议',
    duplicate_suggestion: '重复资料',
    rule_suggestion: '规则建议',
    retry_suggestion: '重试建议',
  };
  return labels[type] || 'Agent 建议';
}

export function formatPercent(value: number) {
  return `${Math.max(0, Math.min(100, Number(value || 0)))}%`;
}
```

- [x] **Step 5: Run client tests**

Run:

```bash
cd client
node --test src/pages/localAgentWorkbenchUtils.test.js
npm test
```

Expected: pass.

- [x] **Step 6: Commit**

```bash
git add client/src/api/client.ts client/src/pages/localAgentWorkbenchUtils.ts client/src/pages/localAgentWorkbenchUtils.test.js
git commit -m "Add local agent client helpers"
```

---

### Task 7: Agent Workbench UI

**Files:**
- Create: `client/src/pages/LocalAgentWorkbenchPanel.tsx`
- Modify: `client/src/pages/SettingsPage.tsx`

- [x] **Step 1: Create `LocalAgentWorkbenchPanel.tsx`**

Create `client/src/pages/LocalAgentWorkbenchPanel.tsx`:

```tsx
import { Bot, Check, RefreshCw, Sparkles, X } from 'lucide-react';
import type { LocalAgentStatus, LocalAgentSuggestion } from '../api/client';
import {
  formatPercent,
  maturityPercent,
  maturityRows,
  suggestionActionLabel,
} from './localAgentWorkbenchUtils';

interface Props {
  status: LocalAgentStatus | null;
  loading: boolean;
  generatingReport: boolean;
  generatingSuggestions: boolean;
  resolvingSuggestionId: number | null;
  message: string;
  onRefresh: () => void;
  onGenerateReport: () => void;
  onGenerateSuggestions: () => void;
  onResolveSuggestion: (id: number, action: 'accept' | 'reject') => void;
}

function number(value: number | undefined) {
  return new Intl.NumberFormat().format(value || 0);
}

function suggestionTitle(suggestion: LocalAgentSuggestion) {
  const proposal = suggestion.proposal || {};
  return String(proposal.title || proposal.topic || suggestion.reason || suggestionActionLabel(suggestion.suggestion_type));
}

export default function LocalAgentWorkbenchPanel({
  status,
  loading,
  generatingReport,
  generatingSuggestions,
  resolvingSuggestionId,
  message,
  onRefresh,
  onGenerateReport,
  onGenerateSuggestions,
  onResolveSuggestion,
}: Props) {
  const total = status?.coverage.total || 0;
  const rows = maturityRows(status?.coverage.states || {});
  const readyPercent = maturityPercent(status?.coverage.ready || 0, total);

  return (
    <div className="rounded-xl border p-5 space-y-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h2 className="font-semibold flex items-center gap-2">
            <Bot className="w-4 h-4 text-indigo-500" />
            本地 Agent 工作台
          </h2>
          <p className="text-sm text-gray-500 mt-0.5">
            查看小盒子已完成的资料加工、待确认建议和本地规则。
          </p>
        </div>
        <button
          type="button"
          onClick={onRefresh}
          disabled={loading}
          className="btn-secondary flex items-center gap-2 shrink-0"
        >
          <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
          刷新
        </button>
      </div>

      <div className="rounded-lg border bg-gray-50 dark:bg-gray-800 px-4 py-3">
        <div className="flex items-center justify-between gap-3">
          <div>
            <div className="text-sm text-gray-500">知识工厂成熟度</div>
            <div className="text-2xl font-semibold">{formatPercent(readyPercent)}</div>
          </div>
          <div className="text-right text-sm text-gray-500">
            <div>{number(status?.coverage.ready)} 条可调用</div>
            <div>{number(total)} 条总资料</div>
          </div>
        </div>
        <div className="mt-3 h-2 rounded-full bg-gray-200 dark:bg-gray-700 overflow-hidden">
          <div className="h-full bg-indigo-500" style={{ width: formatPercent(readyPercent) }} />
        </div>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        {rows.map((row) => (
          <div key={row.key} className="rounded-lg border px-3 py-2">
            <div className="text-xs text-gray-500">{row.label}</div>
            <div className="text-lg font-semibold">{number(row.value)}</div>
          </div>
        ))}
      </div>

      <div className="rounded-lg border px-3 py-3 space-y-2">
        <div className="flex items-start justify-between gap-3">
          <div>
            <div className="text-sm font-medium">最近报告</div>
            <div className="text-xs text-gray-500">
              {status?.latestReport?.createdAt ? new Date(status.latestReport.createdAt).toLocaleString() : '尚未生成报告'}
            </div>
          </div>
          <button
            type="button"
            onClick={onGenerateReport}
            disabled={generatingReport}
            className="btn-secondary flex items-center gap-2"
          >
            <Sparkles className="w-4 h-4" />
            {generatingReport ? '生成中…' : '生成报告'}
          </button>
        </div>
        <div className="text-sm text-gray-600 dark:text-gray-300">
          {status?.latestReport?.content?.headline || '本地 Agent 会基于队列、成熟度、建议和规则生成工作报告。'}
        </div>
      </div>

      <div className="rounded-lg border px-3 py-3 space-y-3">
        <div className="flex items-start justify-between gap-3">
          <div>
            <div className="text-sm font-medium">待确认建议</div>
            <div className="text-xs text-gray-500">接受建议会沉淀成本地整理规则。</div>
          </div>
          <button
            type="button"
            onClick={onGenerateSuggestions}
            disabled={generatingSuggestions}
            className="btn-secondary"
          >
            {generatingSuggestions ? '生成中…' : '生成主题建议'}
          </button>
        </div>
        {(status?.suggestions || []).length ? (
          <div className="space-y-2">
            {(status?.suggestions || []).map((suggestion) => (
              <div key={suggestion.id} className="rounded-md bg-gray-50 dark:bg-gray-800 px-3 py-2">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="text-sm font-medium truncate">{suggestionTitle(suggestion)}</div>
                    <div className="text-xs text-gray-500 mt-0.5">
                      {suggestionActionLabel(suggestion.suggestion_type)} · 置信度 {Math.round(Number(suggestion.confidence || 0) * 100)}%
                    </div>
                    {suggestion.reason && <div className="text-xs text-gray-500 mt-1">{suggestion.reason}</div>}
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    <button
                      type="button"
                      className="btn-secondary px-2 py-1"
                      disabled={resolvingSuggestionId === suggestion.id}
                      onClick={() => onResolveSuggestion(suggestion.id, 'reject')}
                    >
                      <X className="w-3 h-3" />
                    </button>
                    <button
                      type="button"
                      className="btn-primary px-2 py-1"
                      disabled={resolvingSuggestionId === suggestion.id}
                      onClick={() => onResolveSuggestion(suggestion.id, 'accept')}
                    >
                      <Check className="w-3 h-3" />
                    </button>
                  </div>
                </div>
              </div>
            ))}
          </div>
        ) : (
          <div className="text-sm text-gray-500">暂无待确认建议。</div>
        )}
      </div>

      <div className="rounded-lg border px-3 py-3">
        <div className="text-sm font-medium">已学习规则</div>
        <div className="text-xs text-gray-500 mt-0.5">
          {status?.rules?.length ? `${number(status.rules.length)} 条活跃规则` : '接受建议后会在这里出现本地整理规则。'}
        </div>
        {!!status?.rules?.length && (
          <div className="mt-2 space-y-1">
            {status.rules.slice(0, 5).map((rule) => (
              <div key={rule.id} className="text-sm text-gray-600 dark:text-gray-300 truncate">
                {rule.title}
              </div>
            ))}
          </div>
        )}
      </div>

      {message && <div className="text-sm text-green-600">{message}</div>}
    </div>
  );
}
```

- [x] **Step 2: Wire panel into `SettingsPage.tsx`**

Modify imports:

```ts
import { api, type AIConfig, type AIProvider, type AIPurpose, type EmbeddingConfig, type LocalAgentStatus, type SystemStatus } from '../api/client';
import LocalAgentWorkbenchPanel from './LocalAgentWorkbenchPanel';
```

Add state near system state:

```ts
  const [localAgentStatus, setLocalAgentStatus] = useState<LocalAgentStatus | null>(null);
  const [loadingLocalAgent, setLoadingLocalAgent] = useState(false);
  const [generatingAgentReport, setGeneratingAgentReport] = useState(false);
  const [generatingAgentSuggestions, setGeneratingAgentSuggestions] = useState(false);
  const [resolvingSuggestionId, setResolvingSuggestionId] = useState<number | null>(null);
  const [localAgentMessage, setLocalAgentMessage] = useState('');
```

In the admin `useEffect`, call:

```ts
    refreshLocalAgentStatus();
```

Add handlers:

```ts
  const refreshLocalAgentStatus = async () => {
    setLoadingLocalAgent(true);
    setLocalAgentMessage('');
    try {
      setLocalAgentStatus(await api.getLocalAgentStatus());
    } catch (e: any) {
      const message = e.message || '本地 Agent 状态加载失败';
      setError(message);
      toast.error('本地 Agent 状态加载失败', message);
    } finally {
      setLoadingLocalAgent(false);
    }
  };

  const handleGenerateAgentReport = async () => {
    setGeneratingAgentReport(true);
    setLocalAgentMessage('');
    try {
      const result = await api.generateLocalAgentReport();
      setLocalAgentStatus(result.status);
      setLocalAgentMessage('本地 Agent 报告已生成');
      toast.success('本地 Agent 报告已生成');
    } catch (e: any) {
      const message = e.message || '生成本地 Agent 报告失败';
      setError(message);
      toast.error('生成本地 Agent 报告失败', message);
    } finally {
      setGeneratingAgentReport(false);
    }
  };

  const handleGenerateAgentSuggestions = async () => {
    setGeneratingAgentSuggestions(true);
    setLocalAgentMessage('');
    try {
      const result = await api.generateLocalAgentSuggestions();
      setLocalAgentStatus(result.status);
      setLocalAgentMessage(result.created ? `已生成 ${result.created} 条建议` : '没有新的建议');
      toast.success('本地 Agent 建议已更新');
    } catch (e: any) {
      const message = e.message || '生成本地 Agent 建议失败';
      setError(message);
      toast.error('生成本地 Agent 建议失败', message);
    } finally {
      setGeneratingAgentSuggestions(false);
    }
  };

  const handleResolveAgentSuggestion = async (id: number, action: 'accept' | 'reject') => {
    setResolvingSuggestionId(id);
    setLocalAgentMessage('');
    try {
      const result = await api.resolveLocalAgentSuggestion(id, action);
      setLocalAgentStatus(result.status);
      setLocalAgentMessage(action === 'accept' ? '建议已接受并沉淀为规则' : '建议已拒绝');
      toast.success(action === 'accept' ? '建议已接受' : '建议已拒绝');
    } catch (e: any) {
      const message = e.message || '处理本地 Agent 建议失败';
      setError(message);
      toast.error('处理本地 Agent 建议失败', message);
    } finally {
      setResolvingSuggestionId(null);
    }
  };
```

Render after `SystemHealthPanel` or before `DocumentMaintenancePanel`:

```tsx
      <LocalAgentWorkbenchPanel
        status={localAgentStatus}
        loading={loadingLocalAgent}
        generatingReport={generatingAgentReport}
        generatingSuggestions={generatingAgentSuggestions}
        resolvingSuggestionId={resolvingSuggestionId}
        message={localAgentMessage}
        onRefresh={refreshLocalAgentStatus}
        onGenerateReport={handleGenerateAgentReport}
        onGenerateSuggestions={handleGenerateAgentSuggestions}
        onResolveSuggestion={handleResolveAgentSuggestion}
      />
```

- [x] **Step 3: Run client verification**

Run:

```bash
cd client
npm test
npm run build
```

Expected: pass.

- [x] **Step 4: Commit**

```bash
git add client/src/pages/LocalAgentWorkbenchPanel.tsx client/src/pages/SettingsPage.tsx
git commit -m "Add local agent workbench UI"
```

---

### Task 8: Docs And Full Verification

**Files:**
- Modify: `docs/development.md`
- Modify: `docs/taishanpi-deploy.md`

- [x] **Step 1: Update development docs**

Add to `docs/development.md` checkpoint bullets:

```md
- Local Agent Knowledge Factory first milestone is available through the admin
  settings workbench. It derives item maturity from existing content,
  documents, chunks, understanding rows, jobs, and suggestions; stores local
  factory runs/reports/suggestions/rules in additive tables; and can generate
  topic suggestions from deterministic `item_topics` without requiring cloud
  APIs.
```

- [x] **Step 2: Update RK3576 docs**

Add to `docs/taishanpi-deploy.md` under Current runtime improvements:

```md
- The admin Local Agent workbench shows whether the box is actually doing
  useful work: maturity coverage, latest local report, pending suggestions,
  learned rules, and failed jobs. This is the primary operational view for the
  "plug it in and let it work" model.
```

- [x] **Step 3: Run full verification**

Run:

```bash
git diff --check
cd server && npm test
cd ../client && npm test && npm run build
cd ../mobile && npm test && npm run build
```

Expected: all pass.

- [x] **Step 4: Commit docs**

```bash
git add docs/development.md docs/taishanpi-deploy.md
git commit -m "Document local agent factory milestone"
```

- [x] **Step 5: Push**

Run:

```bash
git push
```

Expected: `main -> main` pushed.
