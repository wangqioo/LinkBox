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
