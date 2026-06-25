import test from 'node:test'
import assert from 'node:assert/strict'
import {
  nextAssistantMessageId,
  normalizeAssistantMessages,
  sourceOpenId,
} from './assistantConversations.js'

test('normalizeAssistantMessages maps saved assistant history to chat messages', () => {
  assert.deepEqual(normalizeAssistantMessages([
    {
      id: 10,
      role: 'assistant',
      content: 'answer',
      error: '',
      sources: [{ id: 1, title: 'Source' }],
    },
    {
      id: 11,
      role: 'assistant',
      content: '',
      error: 'model unavailable',
      sources: [],
    },
  ]), [
    {
      id: 10,
      role: 'assistant',
      content: 'answer',
      sources: [{ id: 1, title: 'Source' }],
      done: true,
    },
    {
      id: 11,
      role: 'assistant',
      content: 'model unavailable',
      sources: [],
      done: true,
    },
  ])
})

test('normalizeAssistantMessages tolerates malformed payloads', () => {
  assert.deepEqual(normalizeAssistantMessages(null), [])
  assert.deepEqual(normalizeAssistantMessages([{ id: 1, role: 'user', content: 'hi' }]), [
    { id: 1, role: 'user', content: 'hi', sources: [], done: true },
  ])
})

test('nextAssistantMessageId advances past numeric message ids', () => {
  assert.equal(nextAssistantMessageId([]), 1)
  assert.equal(nextAssistantMessageId([{ id: 7 }, { id: '12' }, { id: 'draft' }]), 13)
})

test('sourceOpenId returns openable material ids and skips group message citations', () => {
  assert.equal(sourceOpenId({ link_id: 42, id: 'source:1' }), 42)
  assert.equal(sourceOpenId({ id: 7 }), 7)
  assert.equal(sourceOpenId({ id: 'group-message:99' }), '')
  assert.equal(sourceOpenId({ link_id: '' }), '')
  assert.equal(sourceOpenId(null), '')
})
