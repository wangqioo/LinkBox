export function isMineMessage(message, currentUser) {
  if (!message || !currentUser) return false
  return Number(message.user_id) === Number(currentUser.id)
}

export function normalizeGroupMessagesResponse(payload) {
  if (Array.isArray(payload)) {
    return { messages: payload, currentUser: null }
  }
  return {
    messages: Array.isArray(payload?.messages) ? payload.messages : [],
    currentUser: payload?.current_user || null,
    currentMember: payload?.current_member || null,
  }
}
