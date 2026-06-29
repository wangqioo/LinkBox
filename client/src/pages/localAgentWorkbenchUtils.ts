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

export function timelineEventLabel(type: string) {
  const labels: Record<string, string> = {
    'autopilot.started': '开始',
    'autopilot.job_queued': '已排队',
    'autopilot.failed_jobs_retried': '已重试',
    'autopilot.suggestions_created': '新建议',
    'autopilot.completed': '完成',
  };
  return labels[type] || 'Agent 事件';
}

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

export function autopilotSummary(autopilot: any) {
  const lastRun = autopilot?.lastRun;
  if (!lastRun) return '尚未运行 Autopilot';
  if (lastRun.status && lastRun.status !== 'completed') return `上次运行：${lastRun.status}`;
  const actions = lastRun.summary?.actions || {};
  const enqueued = Array.isArray(actions.enqueued) ? actions.enqueued.length : Number(actions.enqueued || 0);
  const retried = Number(actions.retriedFailedJobs || 0);
  const suggestions = Number(actions.suggestionsCreated || 0);
  return `上次运行：排队 ${enqueued} 个任务，重试 ${retried} 个失败任务，生成 ${suggestions} 条建议`;
}
