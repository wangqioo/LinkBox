import { join } from 'path';
import { initLocalAgentSchema } from './localAgentSchema.js';
import { createTopicSuggestions, generateLocalAgentReport } from './localAgentFactory.js';
import { UPLOADS_DIR } from './uploadMiddleware.js';

function parseJson(raw, fallback) {
  try {
    return JSON.parse(raw || '');
  } catch {
    return fallback;
  }
}

function boundedLimit(value, fallback, max) {
  return Math.max(1, Math.min(max, Number(value) || fallback));
}

function hasColumn(db, table, column) {
  return Boolean(db.prepare(`PRAGMA table_info(${table})`).all().some(row => row.name === column));
}

function hasActiveJob(db, itemId, type) {
  const exists = db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'jobs'").get();
  if (!exists) return false;
  return Boolean(db.prepare(`
    SELECT id
    FROM jobs
    WHERE link_id = ?
      AND type = ?
      AND status IN ('queued', 'running')
    LIMIT 1
  `).get(itemId, type));
}

function timelineEventFromRow(row) {
  return {
    id: row.id,
    userId: row.user_id,
    eventType: row.event_type,
    title: row.title,
    detail: row.detail || '',
    itemId: row.item_id,
    metadata: parseJson(row.metadata_json, {}),
    createdAt: row.created_at,
  };
}

export function recordLocalAgentTimelineEvent(db, {
  userId = 1,
  eventType,
  title,
  detail = '',
  itemId = null,
  metadata = {},
} = {}) {
  initLocalAgentSchema(db);
  const result = db.prepare(`
    INSERT INTO agent_timeline_events (user_id, event_type, title, detail, item_id, metadata_json)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(
    userId,
    String(eventType || 'autopilot.event'),
    String(title || 'Agent 事件'),
    String(detail || ''),
    itemId || null,
    JSON.stringify(metadata || {}),
  );
  return db.prepare('SELECT * FROM agent_timeline_events WHERE id = ?').get(result.lastInsertRowid);
}

export function listLocalAgentTimeline(db, { userId = 1, limit = 20 } = {}) {
  initLocalAgentSchema(db);
  return db.prepare(`
    SELECT id, user_id, event_type, title, detail, item_id, metadata_json, created_at
    FROM agent_timeline_events
    WHERE user_id = ?
    ORDER BY datetime(created_at) DESC, id DESC
    LIMIT ?
  `).all(userId, boundedLimit(limit, 20, 100)).map(timelineEventFromRow);
}

function candidateRows(db, { userId, limit }) {
  const imagePathSelect = hasColumn(db, 'links', 'image_path') ? 'image_path' : "'' AS image_path";
  return db.prepare(`
    SELECT id, user_id, type, title, summary, content, content_md, description, status, ${imagePathSelect}
    FROM links
    WHERE user_id = ?
    ORDER BY datetime(imported_at) DESC, id DESC
    LIMIT ?
  `).all(userId, limit);
}

function uploadedDiskPath(imagePath, uploadsDir) {
  if (!String(imagePath || '').startsWith('/uploads/')) return '';
  return join(uploadsDir, String(imagePath).split('/').pop());
}

function chooseJobForItem(item, { uploadsDir = UPLOADS_DIR } = {}) {
  const type = String(item.type || 'link');
  const hasSummary = Boolean(String(item.summary || '').trim());
  const hasContent = Boolean(String(item.content_md || item.content || item.description || '').trim());
  const imagePath = String(item.image_path || '');

  if (type === 'image' && imagePath.startsWith('/uploads/') && !hasContent && !hasSummary) {
    return {
      type: 'image.describe',
      payload: {
        diskPath: uploadedDiskPath(imagePath, uploadsDir),
      },
      title: '补充图片描述',
      detail: item.title || imagePath,
    };
  }

  if (!hasSummary && hasContent) {
    return {
      type: ['file', 'document'].includes(type) ? 'file.summarize' : 'link.summarize',
      payload: {},
      title: '补充资料摘要',
      detail: item.title || `#${item.id}`,
    };
  }

  return null;
}

function enqueueSafeJobs(db, queue, { userId, maxItems, maxEnqueue, uploadsDir }) {
  const enqueued = [];
  if (!queue?.enqueue) return enqueued;

  const rows = candidateRows(db, { userId, limit: maxItems });
  for (const item of rows) {
    if (enqueued.length >= maxEnqueue) break;
    const job = chooseJobForItem(item, { uploadsDir });
    if (!job || hasActiveJob(db, item.id, job.type)) continue;
    queue.enqueue(job.type, {
      linkId: item.id,
      payload: job.payload,
      maxAttempts: job.type === 'image.describe' ? 2 : 3,
    });
    enqueued.push({
      itemId: item.id,
      jobType: job.type,
      title: item.title || '',
    });
    recordLocalAgentTimelineEvent(db, {
      userId,
      eventType: 'autopilot.job_queued',
      title: job.title,
      detail: job.detail,
      itemId: item.id,
      metadata: {
        jobType: job.type,
      },
    });
  }
  return enqueued;
}

function latestAutopilotRun(db, userId) {
  const row = db.prepare(`
    SELECT id, status, plan_json, summary_json, started_at, completed_at, created_at
    FROM agent_runs
    WHERE user_id = ? AND run_type = 'local_agent.autopilot'
    ORDER BY datetime(created_at) DESC, id DESC
    LIMIT 1
  `).get(userId);
  if (!row) return null;
  return {
    id: row.id,
    status: row.status,
    plan: parseJson(row.plan_json, {}),
    summary: parseJson(row.summary_json, {}),
    startedAt: row.started_at,
    completedAt: row.completed_at,
    createdAt: row.created_at,
  };
}

export function getLocalAgentAutopilotStatus(db, { userId = 1, timelineLimit = 10 } = {}) {
  initLocalAgentSchema(db);
  return {
    enabled: false,
    mode: 'manual',
    lastRun: latestAutopilotRun(db, userId),
    timeline: listLocalAgentTimeline(db, { userId, limit: timelineLimit }),
  };
}

export function runLocalAgentAutopilot(db, {
  userId = 1,
  queue = null,
  retryFailed = false,
  limits = {},
  uploadsDir = UPLOADS_DIR,
} = {}) {
  initLocalAgentSchema(db);
  const maxItems = boundedLimit(limits.maxItems, 100, 1000);
  const maxEnqueue = boundedLimit(limits.maxEnqueue, 10, 100);
  const maxSuggestions = boundedLimit(limits.maxSuggestions, 20, 100);
  const plan = {
    mode: 'manual',
    retryFailed: Boolean(retryFailed),
    limits: {
      maxItems,
      maxEnqueue,
      maxSuggestions,
    },
  };
  const startedAt = new Date().toISOString();
  const runId = db.prepare(`
    INSERT INTO agent_runs (user_id, run_type, status, plan_json, started_at)
    VALUES (?, 'local_agent.autopilot', 'running', ?, ?)
  `).run(userId, JSON.stringify(plan), startedAt).lastInsertRowid;

  recordLocalAgentTimelineEvent(db, {
    userId,
    eventType: 'autopilot.started',
    title: 'Autopilot 开始扫描',
    detail: `扫描最近 ${maxItems} 条资料`,
    metadata: plan,
  });

  let retriedFailedJobs = 0;
  if (retryFailed && queue?.retryFailedJobs) {
    retriedFailedJobs = Number(queue.retryFailedJobs() || 0);
    if (retriedFailedJobs > 0) {
      recordLocalAgentTimelineEvent(db, {
        userId,
        eventType: 'autopilot.failed_jobs_retried',
        title: '重试失败任务',
        detail: `已重新排队 ${retriedFailedJobs} 个失败任务`,
        metadata: { retried: retriedFailedJobs },
      });
    }
  }

  const enqueued = enqueueSafeJobs(db, queue, { userId, maxItems, maxEnqueue, uploadsDir });
  const suggestions = createTopicSuggestions(db, { userId, limit: maxSuggestions });
  if (suggestions.created > 0) {
    recordLocalAgentTimelineEvent(db, {
      userId,
      eventType: 'autopilot.suggestions_created',
      title: '生成待确认建议',
      detail: `新增 ${suggestions.created} 条建议`,
      metadata: { created: suggestions.created },
    });
  }

  const report = generateLocalAgentReport(db, { userId, reportType: 'autopilot' });
  queue?.drain?.();

  const summary = {
    ok: true,
    actions: {
      enqueued,
      retriedFailedJobs,
      suggestionsCreated: suggestions.created || 0,
      reportGenerated: true,
    },
    report,
    completedAt: new Date().toISOString(),
  };

  db.prepare(`
    UPDATE agent_runs
    SET status = 'completed',
        summary_json = ?,
        completed_at = ?
    WHERE id = ?
  `).run(JSON.stringify(summary), summary.completedAt, runId);

  recordLocalAgentTimelineEvent(db, {
    userId,
    eventType: 'autopilot.completed',
    title: 'Autopilot 扫描完成',
    detail: `排队 ${enqueued.length} 个任务，生成 ${suggestions.created || 0} 条建议`,
    metadata: summary.actions,
  });

  return {
    ...summary,
    runId,
  };
}
