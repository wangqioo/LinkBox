export function normalizeAssistantMessages(messages) {
  if (!Array.isArray(messages)) return []

  return messages.map(message => ({
    id: message.id,
    role: message.role,
    content: message.error || message.content || '',
    sources: Array.isArray(message.sources) ? message.sources : [],
    done: true,
  }))
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
