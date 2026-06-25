export function normalizeAssistantMessages(messages) {
  if (!Array.isArray(messages)) return []

  return messages.map(message => ({
    id: message.id,
    role: message.role,
    content: message.error || message.content || '',
    sources: Array.isArray(message.sources) ? message.sources : [],
    ...(message.agent ? { agent: message.agent } : {}),
    done: true,
  }))
}

export function assistantAgentStatusRows(agent) {
  if (!agent || typeof agent !== 'object') return []

  const rows = []
  const tools = Array.isArray(agent.plan?.tools) ? agent.plan.tools.length : null
  const memoryCount = Array.isArray(agent.memory?.items) ? agent.memory.items.length : null
  const retrievalStep = Array.isArray(agent.run?.steps)
    ? agent.run.steps.find(step => step?.step_type === 'retrieval')
    : null
  const queryCount = retrievalStep?.metadata?.queryCount

  if (agent.plan?.intent) rows.push({ label: '意图', value: agent.plan.intent })
  if (typeof tools === 'number') rows.push({ label: '工具', value: String(tools) })
  if (typeof queryCount === 'number') rows.push({ label: '检索', value: String(queryCount) })
  if (agent.evidence?.status) rows.push({ label: '证据', value: agent.evidence.status })
  if (agent.verification?.support) rows.push({ label: '校验', value: agent.verification.support })
  if (memoryCount) rows.push({ label: '记忆', value: String(memoryCount) })

  return rows
}

export function nextAssistantMessageId(messages) {
  const ids = Array.isArray(messages)
    ? messages.map(message => Number(message.id) || 0)
    : []
  return Math.max(0, ...ids) + 1
}

export function sourceOpenId(source) {
  const id = source?.link_id ?? source?.id
  if (id === null || id === undefined || id === '') return ''
  if (String(id).startsWith('group-message:')) return ''
  return id
}
