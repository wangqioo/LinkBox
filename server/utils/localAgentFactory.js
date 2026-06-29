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

function tableExists(db, table) {
  return Boolean(db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?").get(table));
}

function columnExists(db, table, column) {
  if (!tableExists(db, table)) return false;
  return db.prepare(`PRAGMA table_info(${table})`).all().some(row => row.name === column);
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

function emptyJobCounts() {
  return { queued: 0, running: 0, done: 0, failed: 0 };
}

function jobSnapshot(db, { failedLimit = 5 } = {}) {
  if (!tableExists(db, 'jobs')) {
    return { counts: emptyJobCounts(), failed: [] };
  }
  const rows = db.prepare('SELECT status, COUNT(*) AS count FROM jobs GROUP BY status').all();
  const counts = {
    ...emptyJobCounts(),
    ...Object.fromEntries(rows.map(row => [row.status, Number(row.count || 0)])),
  };

  const hasAttempts = columnExists(db, 'jobs', 'attempts');
  const hasMaxAttempts = columnExists(db, 'jobs', 'max_attempts');
  const hasUpdatedAt = columnExists(db, 'jobs', 'updated_at');
  const hasLinkId = columnExists(db, 'jobs', 'link_id');
  const hasLastError = columnExists(db, 'jobs', 'last_error');
  const failed = db.prepare(`
    SELECT j.id, j.type, ${hasLinkId ? 'j.link_id' : 'NULL'} AS item_id,
           ${hasAttempts ? 'j.attempts' : '0'} AS attempts,
           ${hasMaxAttempts ? 'j.max_attempts' : '0'} AS max_attempts,
           ${hasLastError ? 'j.last_error' : "''"} AS last_error,
           ${hasUpdatedAt ? 'j.updated_at' : "''"} AS updated_at,
           ${hasLinkId ? 'l.title' : "''"} AS item_title,
           ${hasLinkId ? 'l.type' : "''"} AS item_type
    FROM jobs j
    ${hasLinkId ? 'LEFT JOIN links l ON l.id = j.link_id' : ''}
    WHERE j.status = 'failed'
    ORDER BY datetime(updated_at) DESC, j.id DESC
    LIMIT ?
  `).all(Math.max(1, Math.min(50, Number(failedLimit) || 5))).map(row => ({
    id: row.id,
    type: row.type,
    itemId: row.item_id || null,
    itemTitle: row.item_title || '',
    itemType: row.item_type || '',
    attempts: Number(row.attempts || 0),
    maxAttempts: Number(row.max_attempts || 0),
    lastError: row.last_error || '',
    updatedAt: row.updated_at || '',
  }));

  return { counts, failed };
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
    item_title: undefined,
    item_type: undefined,
  }));
}

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
    WHERE r.user_id = ? AND r.status = 'active'
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

export function getLocalAgentStatus(db, { userId = 1 } = {}) {
  initLocalAgentSchema(db);
  const coverage = getMaturityCoverage(db, { userId });
  const jobs = jobSnapshot(db);
  const latestReport = latestLocalAgentReport(db, { userId });
  const suggestions = pendingSuggestionCount(db, userId);
  const rules = listLocalAgentRules(db, { userId });
  return {
    coverage,
    jobs,
    nextActions: buildNextActions({
      coverage,
      jobs,
      suggestions,
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
