import { labelForEnrichmentJob } from './itemEnrichmentPlan.js';
import { itemKindForRow } from './itemKind.js';

function labelForJob(type, link = null) {
  return labelForEnrichmentJob(type, link);
}

function normalizeJob(row, link = null) {
  if (!row) return null;
  return {
    id: row.id,
    type: row.type,
    label: labelForJob(row.type, link),
    status: row.status,
    attempts: row.attempts,
    maxAttempts: row.max_attempts,
    lastError: row.last_error || '',
    updatedAt: row.updated_at || '',
  };
}

export function buildProcessingStatus(link, jobs = []) {
  const failedJob = jobs.find(job => job.status === 'failed');
  if (failedJob) {
    return {
      state: 'failed',
      stage: failedJob.type,
      label: labelForJob(failedJob.type, link),
      canRetry: true,
      failedJobId: failedJob.id,
      lastError: failedJob.last_error || '',
      updatedAt: failedJob.updated_at || '',
      activeJob: normalizeJob(failedJob, link),
    };
  }

  const activeJob = jobs.find(job => job.status === 'running') || jobs.find(job => job.status === 'queued');
  if (activeJob || link?.status === 'processing') {
    return {
      state: activeJob?.status || 'processing',
      stage: activeJob?.type || '',
      label: activeJob ? labelForJob(activeJob.type, link) : (itemKindForRow(link) === 'video' ? '等待视频处理' : '等待后台处理'),
      canRetry: false,
      failedJobId: null,
      lastError: activeJob?.last_error || '',
      updatedAt: activeJob?.updated_at || '',
      activeJob: normalizeJob(activeJob, link),
    };
  }

  if (link?.status === 'error') {
    return {
      state: 'failed',
      stage: '',
      label: '内容处理失败',
      canRetry: false,
      failedJobId: null,
      lastError: '',
      updatedAt: '',
      activeJob: null,
    };
  }

  return {
    state: link?.status || 'done',
    stage: '',
    label: '',
    canRetry: false,
    failedJobId: null,
    lastError: '',
    updatedAt: '',
    activeJob: null,
  };
}

export function getJobsForLinks(db, linkIds) {
  const ids = [...new Set(linkIds.map(Number).filter(Boolean))];
  if (!ids.length) return new Map();

  const placeholders = ids.map(() => '?').join(',');
  const rows = db.prepare(`
    SELECT id, type, link_id, status, attempts, max_attempts, last_error, updated_at
    FROM jobs
    WHERE link_id IN (${placeholders})
      AND status IN ('queued', 'running', 'failed')
    ORDER BY
      CASE status WHEN 'failed' THEN 0 WHEN 'running' THEN 1 ELSE 2 END,
      updated_at DESC,
      id DESC
  `).all(...ids);

  const byLinkId = new Map();
  for (const row of rows) {
    if (!byLinkId.has(row.link_id)) byLinkId.set(row.link_id, []);
    byLinkId.get(row.link_id).push(row);
  }
  return byLinkId;
}

export function attachProcessingStatus(db, links) {
  const items = Array.isArray(links) ? links : [links];
  const jobsByLinkId = getJobsForLinks(db, items.map(item => item?.id));
  const mapped = items.map(item => ({
    ...item,
    processing: buildProcessingStatus(item, jobsByLinkId.get(item.id) || []),
  }));
  return Array.isArray(links) ? mapped : mapped[0];
}
