import test from 'node:test'
import assert from 'node:assert/strict'
import { isMineMessage, normalizeGroupMessagesResponse } from './groupChatDisplay.js'

test('isMineMessage compares the message user with the current logged-in user', () => {
  assert.equal(isMineMessage({ user_id: 2 }, { id: 2 }), true)
  assert.equal(isMineMessage({ user_id: 1 }, { id: 2 }), false)
})

test('normalizeGroupMessagesResponse supports the new payload with current user', () => {
  const payload = {
    current_user: { id: 2, username: 'bob' },
    messages: [{ id: 10, user_id: 1, body: 'hello' }],
  }

  assert.deepEqual(normalizeGroupMessagesResponse(payload), {
    currentUser: { id: 2, username: 'bob' },
    currentMember: null,
    messages: [{ id: 10, user_id: 1, body: 'hello' }],
  })
})

test('normalizeGroupMessagesResponse keeps compatibility with the legacy array payload', () => {
  const rows = [{ id: 10, user_id: 1, body: 'hello' }]

  assert.deepEqual(normalizeGroupMessagesResponse(rows), {
    currentUser: null,
    messages: rows,
  })
})
