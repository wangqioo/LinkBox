# Local Agent Workbench Stage 2 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Upgrade the admin Local Agent workbench from a passive status panel into an operational dashboard with blockers, next actions, enriched suggestions, enriched rules, recent runs, and refreshed reports.

**Architecture:** Keep the existing `/api/settings/local-agent` flow and enrich the `getLocalAgentStatus()` payload in `server/utils/localAgentFactory.js`. The React settings panel continues to receive one status object, with TypeScript interfaces and formatting helpers defining the UI contract. No new schema or route family is introduced.

**Tech Stack:** Express, better-sqlite3, Node test runner, React 18, TypeScript, Vite, Tailwind CSS, lucide-react.

---

## File Structure

- Modify `server/utils/localAgentFactory.js`: enrich status with `jobs`, `nextActions`, `runs`, suggestion item context, rule source context, and report snapshots.
- Modify `server/test/localAgentFactory.test.mjs`: add focused backend tests for enriched status behavior.
- Modify `server/test/settingsLocalAgent.test.mjs`: assert the settings endpoint and command endpoints return enriched status.
- Modify `client/src/api/client.ts`: extend Local Agent TypeScript interfaces for the enriched payload.
- Modify `client/src/pages/localAgentWorkbenchUtils.ts`: add small pure formatters for severity, evidence, rule actions, and job counts.
- Modify `client/src/pages/localAgentWorkbenchUtils.test.js`: cover the new pure formatters.
- Modify `client/src/pages/LocalAgentWorkbenchPanel.tsx`: render the operational dashboard with compact metrics, next actions, recent runs, enriched suggestions, and rules.

## Task 1: Backend Status Shape

**Files:**
- Modify: `server/utils/localAgentFactory.js`
- Test: `server/test/localAgentFactory.test.mjs`

- [ ] **Step 1: Write failing backend tests for enriched status**

Add this test near the existing `getLocalAgentStatus returns coverage latest report suggestions and rules` test in `server/test/localAgentFactory.test.mjs`:

```js
test('getLocalAgentStatus returns jobs next actions runs and enriched review context', () => withDb((db) => {
  initLocalAgentSchema(db);
  db.exec(`
    CREATE TABLE documents (id INTEGER PRIMARY KEY AUTOINCREMENT, item_id INTEGER NOT NULL, user_id INTEGER NOT NULL);
    CREATE TABLE document_chunks (id INTEGER PRIMARY KEY AUTOINCREMENT, document_id INTEGER NOT NULL, chunk_index INTEGER NOT NULL, content TEXT NOT NULL);
    CREATE TABLE item_understanding_runs (item_id INTEGER PRIMARY KEY, user_id INTEGER NOT NULL, updated_at TEXT DEFAULT '');
    CREATE TABLE jobs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      type TEXT NOT NULL,
      link_id INTEGER,
      status TEXT NOT NULL,
      attempts INTEGER DEFAULT 0,
      max_attempts INTEGER DEFAULT 3,
      last_error TEXT DEFAULT '',
      updated_at TEXT DEFAULT ''
    );
  `);
  const itemId = seedItem(db, { title: 'Agent note', type: 'file', contentMd: 'Markdown body' });
  db.prepare(`
    INSERT INTO jobs (type, link_id, status, attempts, max_attempts, last_error, updated_at)
    VALUES ('document.embed', ?, 'failed', 3, 3, 'embedding timeout', '2026-06-29T10:00:00.000Z')
  `).run(itemId);
  const suggestionId = db.prepare(`
    INSERT INTO agent_suggestions (user_id, item_id, suggestion_type, status, proposal_json, reason, confidence, evidence_json)
    VALUES (1, ?, 'topic_suggestion', 'pending', ?, 'Topic appears repeatedly', 0.91, ?)
  `).run(
    itemId,
    JSON.stringify({ topic: 'AI Agent', title: '将资料归入主题：AI Agent' }),
    JSON.stringify({ itemTitle: 'Agent note', topic: 'AI Agent' }),
  ).lastInsertRowid;
  db.prepare(`
    INSERT INTO agent_rules (user_id, rule_type, status, title, condition_json, action_json, source_suggestion_id)
    VALUES (1, 'topic_preference', 'active', '主题偏好：AI Agent', ?, ?, ?)
  `).run(
    JSON.stringify({ source: 'accepted_topic_suggestion' }),
    JSON.stringify({ topic: 'AI Agent' }),
    suggestionId,
  );
  generateLocalAgentReport(db, { userId: 1 });

  const status = getLocalAgentStatus(db, { userId: 1 });

  assert.equal(status.jobs.counts.failed, 1);
  assert.equal(status.jobs.failed[0].itemTitle, 'Agent note');
  assert.equal(status.jobs.failed[0].lastError, 'embedding timeout');
  assert.equal(status.nextActions[0].kind, 'retry_failed_jobs');
  assert.equal(status.nextActions[0].severity, 'high');
  assert.equal(status.runs.length, 1);
  assert.equal(status.runs[0].status, 'completed');
  assert.equal(status.suggestions[0].itemTitle, 'Agent note');
  assert.equal(status.suggestions[0].itemType, 'file');
  assert.equal(status.rules[0].sourceSuggestion.id, suggestionId);
  assert.equal(status.rules[0].sourceItemTitle, 'Agent note');
}));
```

- [ ] **Step 2: Run the failing backend test**

Run:

```bash
cd server && npm test -- --test-name-pattern="getLocalAgentStatus returns jobs next actions runs"
```

Expected: FAIL because `status.jobs`, `status.nextActions`, `status.runs`, enriched suggestion fields, and enriched rule fields do not exist yet.

- [ ] **Step 3: Implement enriched status helpers**

In `server/utils/localAgentFactory.js`, replace the current `jobCounts`, `listLocalAgentSuggestions`, `listLocalAgentRules`, `latestLocalAgentReport`, `generateLocalAgentReport`, and `getLocalAgentStatus` area with helpers matching this shape. Keep existing exported function names.

```js
function emptyJobCounts() {
  return { queued: 0, running: 0, done: 0, failed: 0 };
}

function jobSnapshot(db, { failedLimit = 5 } = {}) {
  if (!tableExists(db, 'jobs')) return { counts: emptyJobCounts(), failed: [] };
  const rows = db.prepare('SELECT status, COUNT(*) AS count FROM jobs GROUP BY status').all();
  const counts = {
    ...emptyJobCounts(),
    ...Object.fromEntries(rows.map(row => [row.status, Number(row.count || 0)])),
  };
  const failed = db.prepare(`
    SELECT j.id, j.type, j.link_id, j.attempts, j.max_attempts, j.last_error, j.updated_at,
           l.title AS item_title
    FROM jobs j
    LEFT JOIN links l ON l.id = j.link_id
    WHERE j.status = 'failed'
    ORDER BY datetime(j.updated_at) DESC, j.id DESC
    LIMIT ?
  `).all(Math.max(1, Math.min(20, Number(failedLimit) || 5))).map(row => ({
    id: row.id,
    type: row.type,
    itemId: row.link_id,
    itemTitle: row.item_title || '',
    attempts: Number(row.attempts || 0),
    maxAttempts: Number(row.max_attempts || 0),
    lastError: row.last_error || '',
    updatedAt: row.updated_at || '',
  }));
  return { counts, failed };
}

function activeRuleCount(db, userId) {
  return Number(db.prepare(`
    SELECT COUNT(*) AS count
    FROM agent_rules
    WHERE user_id = ? AND status = 'active'
  `).get(userId)?.count || 0);
}

function acceptedSuggestionCount(db, userId) {
  return Number(db.prepare(`
    SELECT COUNT(*) AS count
    FROM agent_suggestions
    WHERE user_id = ? AND status = 'accepted'
  `).get(userId)?.count || 0);
}

function buildNextActions({ coverage, jobs, suggestions, rules, latestReport, acceptedSuggestions }) {
  if (!coverage.total) {
    return [{
      kind: 'empty_library',
      severity: 'low',
      title: '先收集资料',
      detail: '资料库里还没有资料，本地 Agent 需要先观察内容。',
      action: 'add_items',
    }];
  }

  const actions = [];
  if (jobs.counts.failed > 0) {
    actions.push({
      kind: 'retry_failed_jobs',
      severity: 'high',
      title: '重试失败任务',
      detail: `${jobs.counts.failed} 个后台任务失败，先处理最近失败的资料加工。`,
      action: 'retry_jobs',
    });
  }
  if (suggestions > 0) {
    actions.push({
      kind: 'review_suggestions',
      severity: 'medium',
      title: '确认 Agent 建议',
      detail: `${suggestions} 条建议等待确认，接受后会沉淀成本地规则。`,
      action: 'review_suggestions',
    });
  }
  const lowMaturity = Number(coverage.states.raw || 0) + Number(coverage.states.converted || 0);
  if (lowMaturity > 0) {
    actions.push({
      kind: 'improve_maturity',
      severity: 'medium',
      title: '补齐资料加工',
      detail: `${lowMaturity} 条资料还停留在原始或转文本阶段。`,
      action: 'backfill_processing',
    });
  }
  if (!latestReport) {
    actions.push({
      kind: 'generate_report',
      severity: 'low',
      title: '生成工作报告',
      detail: '生成一份当前成熟度、任务、建议和规则快照。',
      action: 'generate_report',
    });
  }
  if (!rules && acceptedSuggestions > 0) {
    actions.push({
      kind: 'learn_rules',
      severity: 'low',
      title: '检查已接受建议',
      detail: `${acceptedSuggestions} 条建议已接受，确认它们是否沉淀为可用规则。`,
      action: 'review_rules',
    });
  }

  return actions;
}

function buildHeadline({ coverage, jobs, suggestions }) {
  return `本地 Agent 已观察 ${coverage.total} 条资料，${coverage.ready} 条可检索，${coverage.reviewNeeded + suggestions} 条需要你确认，${jobs.counts.failed} 个任务失败。`;
}
```

Then update `generateLocalAgentReport` to use `jobSnapshot`, `latestLocalAgentReport`, and `buildNextActions`:

```js
export function generateLocalAgentReport(db, { userId = 1, reportType = 'daily' } = {}) {
  initLocalAgentSchema(db);
  const plan = {
    observe: ['library_maturity', 'jobs', 'suggestions', 'rules', 'next_actions'],
    reportType,
  };
  const runId = insertRun(db, { userId, plan });
  const coverage = getMaturityCoverage(db, { userId });
  const jobs = jobSnapshot(db);
  const suggestions = pendingSuggestionCount(db, userId);
  const rules = activeRuleCount(db, userId);
  const nextActions = buildNextActions({
    coverage,
    jobs,
    suggestions,
    rules,
    latestReport: latestLocalAgentReport(db, { userId }),
    acceptedSuggestions: acceptedSuggestionCount(db, userId),
  });
  const content = {
    headline: buildHeadline({ coverage, jobs, suggestions }),
    library: {
      total: coverage.total,
      states: coverage.states,
      ready: coverage.ready,
      reviewNeeded: coverage.reviewNeeded,
    },
    jobs: jobs.counts,
    suggestions: {
      pending: suggestions,
    },
    rules: {
      active: rules,
    },
    nextActions: {
      count: nextActions.length,
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
```

Update `listLocalAgentSuggestions` to join `links`:

```js
export function listLocalAgentSuggestions(db, { userId = 1, status = 'pending', limit = 20 } = {}) {
  initLocalAgentSchema(db);
  return db.prepare(`
    SELECT s.id, s.user_id, s.item_id, s.suggestion_type, s.status, s.proposal_json, s.reason,
           s.confidence, s.evidence_json, s.created_at, s.updated_at, s.resolved_at,
           l.title AS item_title, l.type AS item_type
    FROM agent_suggestions s
    LEFT JOIN links l ON l.id = s.item_id
    WHERE s.user_id = ? AND s.status = ?
    ORDER BY datetime(s.created_at) DESC, s.id DESC
    LIMIT ?
  `).all(userId, status, Math.max(1, Math.min(100, Number(limit) || 20))).map(row => ({
    ...suggestionFromRow(row),
    itemTitle: row.item_title || '',
    itemType: row.item_type || '',
  }));
}
```

Update `listLocalAgentRules` to join source suggestions and links:

```js
export function listLocalAgentRules(db, { userId = 1, limit = 20 } = {}) {
  initLocalAgentSchema(db);
  return db.prepare(`
    SELECT r.id, r.user_id, r.rule_type, r.status, r.title, r.condition_json, r.action_json,
           r.source_suggestion_id, r.created_at, r.updated_at,
           s.suggestion_type AS source_suggestion_type,
           s.proposal_json AS source_proposal_json,
           s.item_id AS source_item_id,
           l.title AS source_item_title
    FROM agent_rules r
    LEFT JOIN agent_suggestions s ON s.id = r.source_suggestion_id
    LEFT JOIN links l ON l.id = s.item_id
    WHERE r.user_id = ?
    ORDER BY datetime(r.created_at) DESC, r.id DESC
    LIMIT ?
  `).all(userId, Math.max(1, Math.min(100, Number(limit) || 20))).map(row => ({
    ...row,
    condition: parseJson(row.condition_json, {}),
    action: parseJson(row.action_json, {}),
    sourceSuggestion: row.source_suggestion_id ? {
      id: row.source_suggestion_id,
      type: row.source_suggestion_type || '',
      proposal: parseJson(row.source_proposal_json, {}),
      itemId: row.source_item_id || null,
    } : null,
    sourceItemTitle: row.source_item_title || '',
    condition_json: undefined,
    action_json: undefined,
    source_suggestion_type: undefined,
    source_proposal_json: undefined,
    source_item_id: undefined,
    source_item_title: undefined,
  }));
}
```

Add recent runs:

```js
export function listLocalAgentRuns(db, { userId = 1, limit = 5 } = {}) {
  initLocalAgentSchema(db);
  return db.prepare(`
    SELECT id, run_type, status, plan_json, summary_json, started_at, completed_at, created_at
    FROM agent_runs
    WHERE user_id = ?
    ORDER BY datetime(created_at) DESC, id DESC
    LIMIT ?
  `).all(userId, Math.max(1, Math.min(20, Number(limit) || 5))).map(row => ({
    id: row.id,
    runType: row.run_type,
    status: row.status,
    plan: parseJson(row.plan_json, {}),
    summary: parseJson(row.summary_json, {}),
    startedAt: row.started_at || '',
    completedAt: row.completed_at || '',
    createdAt: row.created_at || '',
  }));
}
```

Update `getLocalAgentStatus`:

```js
export function getLocalAgentStatus(db, { userId = 1 } = {}) {
  initLocalAgentSchema(db);
  const coverage = getMaturityCoverage(db, { userId });
  const jobs = jobSnapshot(db);
  const latestReport = latestLocalAgentReport(db, { userId });
  const pendingSuggestions = pendingSuggestionCount(db, userId);
  const rules = listLocalAgentRules(db, { userId });
  return {
    coverage,
    jobs,
    nextActions: buildNextActions({
      coverage,
      jobs,
      suggestions: pendingSuggestions,
      rules: rules.filter(rule => rule.status === 'active').length,
      latestReport,
      acceptedSuggestions: acceptedSuggestionCount(db, userId),
    }),
    latestReport,
    runs: listLocalAgentRuns(db, { userId }),
    suggestions: listLocalAgentSuggestions(db, { userId }),
    rules,
  };
}
```

- [ ] **Step 4: Run backend tests for Local Agent factory**

Run:

```bash
cd server && npm test -- --test-name-pattern="local Agent|LocalAgent|getLocalAgentStatus"
```

Expected: PASS for Local Agent factory tests. If the test-name pattern misses some tests because of Node's matching behavior, run `cd server && npm test -- test/localAgentFactory.test.mjs`.

- [ ] **Step 5: Commit backend status shape**

```bash
git add server/utils/localAgentFactory.js server/test/localAgentFactory.test.mjs
git commit -m "Enrich local agent workbench status"
```

## Task 2: Settings Route Contract

**Files:**
- Modify: `server/test/settingsLocalAgent.test.mjs`
- Existing route: `server/routes/settings.js`

- [ ] **Step 1: Add route assertions for enriched status**

In `server/test/settingsLocalAgent.test.mjs`, update `GET /api/settings/local-agent returns local factory status for admin` with these assertions after `assert.equal(body.suggestions.length, 1);`:

```js
    assert.equal(body.jobs.counts.failed, 0);
    assert.equal(Array.isArray(body.jobs.failed), true);
    assert.equal(Array.isArray(body.nextActions), true);
    assert.equal(Array.isArray(body.runs), true);
    assert.equal(body.suggestions[0].itemTitle, 'Agent note');
```

Update `POST /api/settings/local-agent/report creates a local factory report` with these assertions after `assert.equal(body.report.reportType, 'daily');`:

```js
    assert.equal(body.status.latestReport.reportType, 'daily');
    assert.equal(Array.isArray(body.status.nextActions), true);
    assert.equal(Array.isArray(body.status.runs), true);
```

- [ ] **Step 2: Run settings route tests**

Run:

```bash
cd server && npm test -- test/settingsLocalAgent.test.mjs
```

Expected: PASS. `server/routes/settings.js` should not require code changes because command endpoints already return `getLocalAgentStatus()`.

- [ ] **Step 3: Commit route contract tests**

```bash
git add server/test/settingsLocalAgent.test.mjs
git commit -m "Cover enriched local agent settings payload"
```

## Task 3: Client Types And Formatters

**Files:**
- Modify: `client/src/api/client.ts`
- Modify: `client/src/pages/localAgentWorkbenchUtils.ts`
- Test: `client/src/pages/localAgentWorkbenchUtils.test.js`

- [ ] **Step 1: Write formatter tests**

Extend the import in `client/src/pages/localAgentWorkbenchUtils.test.js`:

```js
import {
  actionSeverityLabel,
  formatJobCounts,
  maturityPercent,
  maturityRows,
  ruleActionSummary,
  suggestionActionLabel,
  suggestionEvidenceSummary,
} from './localAgentWorkbenchUtils.ts';
```

Add these tests:

```js
test('actionSeverityLabel maps action severity to concise labels', () => {
  assert.deepEqual(actionSeverityLabel('high'), { label: '优先', tone: 'red' });
  assert.deepEqual(actionSeverityLabel('medium'), { label: '建议', tone: 'amber' });
  assert.deepEqual(actionSeverityLabel('low'), { label: '可选', tone: 'gray' });
});

test('suggestionEvidenceSummary prefers topic and item evidence', () => {
  assert.equal(
    suggestionEvidenceSummary({ topic: 'AI Agent', itemTitle: 'Agent note' }),
    'Agent note · AI Agent',
  );
  assert.equal(suggestionEvidenceSummary({}), '暂无证据摘要');
});

test('ruleActionSummary describes topic preference actions', () => {
  assert.equal(ruleActionSummary({ topic: 'AI Agent' }), '归入主题：AI Agent');
  assert.equal(ruleActionSummary({}), '本地整理规则');
});

test('formatJobCounts summarizes active queue blockers', () => {
  assert.equal(formatJobCounts({ queued: 2, running: 1, done: 4, failed: 3 }), '3 失败 · 2 排队 · 1 运行');
  assert.equal(formatJobCounts({ queued: 0, running: 0, done: 4, failed: 0 }), '队列空闲');
});
```

- [ ] **Step 2: Run failing formatter tests**

Run:

```bash
cd client && npm test -- --test-name-pattern="actionSeverityLabel|suggestionEvidenceSummary|ruleActionSummary|formatJobCounts"
```

Expected: FAIL because the formatter exports do not exist yet.

- [ ] **Step 3: Extend TypeScript interfaces**

In `client/src/api/client.ts`, add these interfaces after `LocalAgentCoverage`:

```ts
export interface LocalAgentJobs {
  counts: {
    queued: number;
    running: number;
    done: number;
    failed: number;
  };
  failed: Array<{
    id: number;
    type: string;
    itemId?: number | null;
    itemTitle?: string;
    attempts?: number;
    maxAttempts?: number;
    lastError?: string;
    updatedAt?: string;
  }>;
}

export interface LocalAgentNextAction {
  kind: string;
  severity: 'high' | 'medium' | 'low' | string;
  title: string;
  detail: string;
  action: string;
}

export interface LocalAgentRun {
  id: number;
  runType: string;
  status: string;
  plan?: Record<string, unknown>;
  summary?: Record<string, unknown>;
  startedAt?: string;
  completedAt?: string;
  createdAt?: string;
}
```

Extend `LocalAgentSuggestion`:

```ts
  itemTitle?: string;
  itemType?: string;
```

Extend `LocalAgentRule`:

```ts
  sourceSuggestion?: {
    id: number;
    type?: string;
    proposal?: Record<string, unknown>;
    itemId?: number | null;
  } | null;
  sourceItemTitle?: string;
  updated_at?: string;
```

Extend `LocalAgentStatus`:

```ts
  jobs?: LocalAgentJobs;
  nextActions?: LocalAgentNextAction[];
  runs?: LocalAgentRun[];
```

- [ ] **Step 4: Implement formatter helpers**

Append these exports to `client/src/pages/localAgentWorkbenchUtils.ts`:

```ts
export function actionSeverityLabel(severity: string) {
  if (severity === 'high') return { label: '优先', tone: 'red' };
  if (severity === 'medium') return { label: '建议', tone: 'amber' };
  return { label: '可选', tone: 'gray' };
}

export function suggestionEvidenceSummary(evidence: Record<string, unknown> = {}) {
  const itemTitle = String(evidence.itemTitle || '').trim();
  const topic = String(evidence.topic || '').trim();
  if (itemTitle && topic) return `${itemTitle} · ${topic}`;
  if (itemTitle) return itemTitle;
  if (topic) return topic;
  return '暂无证据摘要';
}

export function ruleActionSummary(action: Record<string, unknown> = {}) {
  const topic = String(action.topic || '').trim();
  if (topic) return `归入主题：${topic}`;
  return '本地整理规则';
}

export function formatJobCounts(counts: { queued?: number; running?: number; done?: number; failed?: number } = {}) {
  const parts = [];
  if (counts.failed) parts.push(`${counts.failed} 失败`);
  if (counts.queued) parts.push(`${counts.queued} 排队`);
  if (counts.running) parts.push(`${counts.running} 运行`);
  return parts.length ? parts.join(' · ') : '队列空闲';
}
```

- [ ] **Step 5: Run client utility tests**

Run:

```bash
cd client && npm test -- --test-name-pattern="local Agent|actionSeverityLabel|formatJobCounts"
```

Expected: PASS for local Agent workbench utility tests.

- [ ] **Step 6: Commit client types and formatters**

```bash
git add client/src/api/client.ts client/src/pages/localAgentWorkbenchUtils.ts client/src/pages/localAgentWorkbenchUtils.test.js
git commit -m "Add local agent workbench formatters"
```

## Task 4: Operational Dashboard UI

**Files:**
- Modify: `client/src/pages/LocalAgentWorkbenchPanel.tsx`

- [ ] **Step 1: Update imports**

In `client/src/pages/LocalAgentWorkbenchPanel.tsx`, replace the import block with:

```tsx
import { AlertTriangle, Bot, Check, ClipboardList, RefreshCw, Sparkles, X } from 'lucide-react';
import type { LocalAgentNextAction, LocalAgentRule, LocalAgentStatus, LocalAgentSuggestion } from '../api/client';
import {
  actionSeverityLabel,
  formatJobCounts,
  formatPercent,
  maturityPercent,
  maturityRows,
  ruleActionSummary,
  suggestionActionLabel,
  suggestionEvidenceSummary,
} from './localAgentWorkbenchUtils';
```

- [ ] **Step 2: Add local UI helper functions**

Replace the current local `suggestionTitle` helper with:

```tsx
function suggestionTitle(suggestion: LocalAgentSuggestion) {
  const proposal = suggestion.proposal || {};
  return String(proposal.title || proposal.topic || suggestion.reason || suggestionActionLabel(suggestion.suggestion_type));
}

function metric(label: string, value: number | undefined, detail: string) {
  return (
    <div className="rounded-lg border px-3 py-2">
      <div className="text-xs text-gray-500">{label}</div>
      <div className="text-lg font-semibold">{number(value)}</div>
      <div className="text-xs text-gray-500 mt-0.5 truncate">{detail}</div>
    </div>
  );
}

function severityClass(action: LocalAgentNextAction) {
  if (action.severity === 'high') return 'border-red-200 bg-red-50 text-red-700 dark:border-red-900 dark:bg-red-950 dark:text-red-200';
  if (action.severity === 'medium') return 'border-amber-200 bg-amber-50 text-amber-700 dark:border-amber-900 dark:bg-amber-950 dark:text-amber-200';
  return 'border-gray-200 bg-gray-50 text-gray-600 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-300';
}

function runTimeLabel(value?: string) {
  return value ? new Date(value).toLocaleString() : '未完成';
}

function ruleSource(rule: LocalAgentRule) {
  return rule.sourceItemTitle || String(rule.sourceSuggestion?.proposal?.topic || '') || '本地建议';
}
```

- [ ] **Step 3: Replace panel body with operational dashboard layout**

Inside `LocalAgentWorkbenchPanel`, after `readyPercent`, add:

```tsx
  const jobs = status?.jobs;
  const failedJobs = jobs?.failed || [];
  const nextActions = status?.nextActions || [];
  const runs = status?.runs || [];
```

Then replace the returned JSX content between the root `<div className="rounded-xl border p-5 space-y-4">` and the final `{message && ...}` with this layout:

```tsx
      <div className="flex flex-col md:flex-row md:items-start md:justify-between gap-3">
        <div>
          <h2 className="font-semibold flex items-center gap-2">
            <Bot className="w-4 h-4 text-indigo-500" />
            本地 Agent 工作台
          </h2>
          <p className="text-sm text-gray-500 mt-0.5">
            查看资料加工阻塞、下一步行动和已学习规则。
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={onGenerateSuggestions}
            disabled={generatingSuggestions}
            className="btn-secondary"
          >
            {generatingSuggestions ? '生成中...' : '生成主题建议'}
          </button>
          <button
            type="button"
            onClick={onGenerateReport}
            disabled={generatingReport}
            className="btn-secondary flex items-center gap-2"
          >
            <Sparkles className="w-4 h-4" />
            {generatingReport ? '生成中...' : '生成报告'}
          </button>
          <button
            type="button"
            onClick={onRefresh}
            disabled={loading}
            className="btn-secondary flex items-center gap-2"
          >
            <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
            刷新
          </button>
        </div>
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        {metric('可调用资料', status?.coverage.ready, `${number(total)} 条总资料`)}
        {metric('待确认', status?.coverage.reviewNeeded, `${number(status?.suggestions?.length)} 条建议`)}
        {metric('失败任务', jobs?.counts.failed, formatJobCounts(jobs?.counts))}
        {metric('活跃规则', status?.rules?.length, '已沉淀的本地偏好')}
      </div>

      <div className="rounded-lg border px-3 py-3 space-y-3">
        <div className="flex items-center gap-2">
          <ClipboardList className="w-4 h-4 text-indigo-500" />
          <div className="text-sm font-medium">下一步行动</div>
        </div>
        {nextActions.length ? (
          <div className="space-y-2">
            {nextActions.map((action) => {
              const severity = actionSeverityLabel(action.severity);
              return (
                <div key={`${action.kind}-${action.action}`} className={`rounded-md border px-3 py-2 ${severityClass(action)}`}>
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="text-sm font-medium">{action.title}</div>
                      <div className="text-xs mt-0.5 opacity-80">{action.detail}</div>
                    </div>
                    <span className="text-xs shrink-0">{severity.label}</span>
                  </div>
                </div>
              );
            })}
          </div>
        ) : (
          <div className="text-sm text-gray-500">暂无需要处理的行动。</div>
        )}
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

      {!!failedJobs.length && (
        <div className="rounded-lg border px-3 py-3 space-y-2">
          <div className="flex items-center gap-2 text-sm font-medium">
            <AlertTriangle className="w-4 h-4 text-red-500" />
            最近失败任务
          </div>
          <div className="space-y-2">
            {failedJobs.map((job) => (
              <div key={job.id} className="rounded-md bg-gray-50 dark:bg-gray-800 px-3 py-2">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="text-sm font-medium truncate">{job.itemTitle || job.type}</div>
                    <div className="text-xs text-gray-500 mt-0.5">{job.type} · {runTimeLabel(job.updatedAt)}</div>
                    {job.lastError && <div className="text-xs text-gray-500 mt-1 line-clamp-2">{job.lastError}</div>}
                  </div>
                  <div className="text-xs text-gray-500 shrink-0">
                    {number(job.attempts)} / {number(job.maxAttempts)}
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="grid lg:grid-cols-2 gap-3">
        <div className="rounded-lg border px-3 py-3 space-y-2">
          <div>
            <div className="text-sm font-medium">最近报告</div>
            <div className="text-xs text-gray-500">
              {status?.latestReport?.createdAt ? new Date(status.latestReport.createdAt).toLocaleString() : '尚未生成报告'}
            </div>
          </div>
          <div className="text-sm text-gray-600 dark:text-gray-300">
            {status?.latestReport?.content?.headline || '本地 Agent 会基于队列、成熟度、建议和规则生成工作报告。'}
          </div>
        </div>
        <div className="rounded-lg border px-3 py-3 space-y-2">
          <div className="text-sm font-medium">最近运行</div>
          {runs.length ? (
            <div className="space-y-1">
              {runs.slice(0, 3).map((run) => (
                <div key={run.id} className="flex items-center justify-between gap-3 text-sm">
                  <span className="truncate">{run.runType}</span>
                  <span className="text-xs text-gray-500 shrink-0">{run.status} · {runTimeLabel(run.completedAt || run.createdAt)}</span>
                </div>
              ))}
            </div>
          ) : (
            <div className="text-sm text-gray-500">暂无运行记录。</div>
          )}
        </div>
      </div>
```

Keep the existing suggestions and rules sections but update their content as described in Step 4 and Step 5.

- [ ] **Step 4: Enrich suggestion rows**

Inside the suggestions map, replace the inner text area with:

```tsx
                  <div className="min-w-0">
                    <div className="text-sm font-medium truncate">{suggestionTitle(suggestion)}</div>
                    <div className="text-xs text-gray-500 mt-0.5">
                      {suggestionActionLabel(suggestion.suggestion_type)} · 置信度 {Math.round(Number(suggestion.confidence || 0) * 100)}%
                    </div>
                    <div className="text-xs text-gray-500 mt-1 truncate">
                      {suggestion.itemTitle || suggestionEvidenceSummary(suggestion.evidence)}
                    </div>
                    {suggestion.reason && <div className="text-xs text-gray-500 mt-1 line-clamp-2">{suggestion.reason}</div>}
                  </div>
```

- [ ] **Step 5: Enrich rule rows**

Replace the current rules list body with:

```tsx
        {!!status?.rules?.length && (
          <div className="mt-2 space-y-2">
            {status.rules.slice(0, 5).map((rule) => (
              <div key={rule.id} className="rounded-md bg-gray-50 dark:bg-gray-800 px-3 py-2">
                <div className="text-sm font-medium truncate">{rule.title}</div>
                <div className="text-xs text-gray-500 mt-0.5 truncate">
                  {ruleActionSummary(rule.action)} · 来源：{ruleSource(rule)}
                </div>
              </div>
            ))}
          </div>
        )}
```

- [ ] **Step 6: Build client**

Run:

```bash
cd client && npm run build
```

Expected: PASS with no TypeScript errors.

- [ ] **Step 7: Commit dashboard UI**

```bash
git add client/src/pages/LocalAgentWorkbenchPanel.tsx
git commit -m "Polish local agent workbench dashboard"
```

## Task 5: Full Verification

**Files:**
- No new files.

- [ ] **Step 1: Run backend tests**

Run:

```bash
cd server && npm test
```

Expected: PASS.

- [ ] **Step 2: Run client tests**

Run:

```bash
cd client && npm test
```

Expected: PASS.

- [ ] **Step 3: Run client build**

Run:

```bash
cd client && npm run build
```

Expected: PASS.

- [ ] **Step 4: Check whitespace**

Run:

```bash
git diff --check
```

Expected: no output and exit code 0.

- [ ] **Step 5: Inspect final diff**

Run:

```bash
git status --short
git log --oneline -5
```

Expected: working tree clean after commits, with commits for backend status, settings route contract, client helpers, and dashboard UI.
