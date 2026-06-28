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
