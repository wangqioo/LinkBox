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
