const TYPE_LABELS = {
  image: '图片',
  video: '视频',
  document: '文档',
  audio: '音频',
  link: '链接',
  text: '文字',
  other: '资料',
}

const TOPIC_RULES = [
  { label: 'LinkBox', weight: 2, terms: ['linkbox', '知识库', '收集', '整理', '文件传输助手', '资料助理'] },
  { label: 'AI 与模型', terms: ['ai', '模型', 'llm', 'openai', 'deepseek', 'qwen', '提示词', '智能体'] },
  { label: '产品设计', terms: ['产品', '设计', '体验', '交互', '页面', '用户', '需求', '痛点'] },
  { label: '开发技术', terms: ['代码', '接口', 'api', 'node', 'vue', 'react', 'sqlite', '部署', '构建'] },
  { label: '阅读资料', terms: ['文章', '报告', 'pdf', '文档', '链接', '网页', '资料'] },
]

const KIND_RULES = [
  { label: '待办', terms: ['todo', '待办', '记得', '需要', '帮我', '安排', '处理', '跟进'] },
  { label: '想法', terms: ['想法', '思考', '觉得', '可以', '方案', '设计', '创新'] },
  { label: '阅读', terms: ['文章', '阅读', '报告', '网页', '链接', 'pdf'] },
  { label: '资料', terms: ['资料', '文档', '文件', '图片', '截图'] },
]

function textOf(file) {
  return [
    file?.original_filename,
    file?.summary,
    file?.description,
    file?.content,
    file?.content_md,
    file?.url,
  ].filter(Boolean).join('\n').toLowerCase()
}

function matchRule(text, rules, fallback, { boostLabel = true } = {}) {
  const scored = rules
    .map((rule, index) => ({
      label: rule.label,
      index,
      score: rule.terms.reduce((sum, term) => sum + (text.includes(term.toLowerCase()) ? 1 : 0), 0)
        + (boostLabel && text.includes(rule.label.toLowerCase()) ? 3 : 0)
        + (rule.weight || 0),
    }))
    .filter(rule => rule.score > 0)
    .sort((a, b) => b.score - a.score || a.index - b.index)

  return scored[0]?.label || fallback
}

export function organizeFile(file) {
  const text = textOf(file)
  const topic = matchRule(text, TOPIC_RULES, TYPE_LABELS[file?.type] || '临时资料')
  const kind = matchRule(text, KIND_RULES, TYPE_LABELS[file?.type] || '资料', { boostLabel: false })
  const action = KIND_RULES[0].terms.some(term => text.includes(term.toLowerCase()))

  return {
    topic,
    kind,
    tags: [topic, kind].filter((value, index, arr) => value && arr.indexOf(value) === index).slice(0, 2),
    action,
    confidence: topic === (TYPE_LABELS[file?.type] || '临时资料') ? 'low' : 'medium',
  }
}

export function buildTodayDigest(files, now = new Date()) {
  const today = now.toISOString().slice(0, 10)
  const todayFiles = files.filter(file => file.created_at?.slice(0, 10) === today)
  const pending = todayFiles.filter(file => file.status === 'pending')
  const failed = todayFiles.filter(file => file.status === 'failed')
  const enriched = todayFiles.map(file => ({ file, org: organizeFile(file) }))

  const topics = [...enriched.reduce((map, item) => {
    map.set(item.org.topic, (map.get(item.org.topic) || 0) + 1)
    return map
  }, new Map())]
    .map(([label, count]) => ({ label, count }))
    .sort((a, b) => b.count - a.count)

  const kinds = [...enriched.reduce((map, item) => {
    map.set(item.org.kind, (map.get(item.org.kind) || 0) + 1)
    return map
  }, new Map())]
    .map(([label, count]) => ({ label, count }))
    .sort((a, b) => b.count - a.count)

  const actions = enriched.filter(item => item.org.action).slice(0, 4)
  const reading = enriched
    .filter(item => ['link', 'document'].includes(item.file.type) || item.org.kind === '阅读')
    .slice(0, 4)

  return {
    total: todayFiles.length,
    pending: pending.length,
    failed: failed.length,
    topics: topics.slice(0, 5),
    kinds: kinds.slice(0, 4),
    actions,
    reading,
  }
}
