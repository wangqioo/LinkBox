import test from 'node:test'
import assert from 'node:assert/strict'
import {
  assistantAgentStatusRows,
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
      agent: {
        plan: { intent: 'answer_question' },
        evidence: { status: 'grounded' },
        verification: { support: 'supported' },
        memory: { items: [{ id: 1, content: 'use short answers' }] },
      },
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
      agent: {
        plan: { intent: 'answer_question' },
        evidence: { status: 'grounded' },
        verification: { support: 'supported' },
        memory: { items: [{ id: 1, content: 'use short answers' }] },
      },
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

test('assistantAgentStatusRows formats compact mobile agent diagnostics', () => {
  assert.deepEqual(assistantAgentStatusRows({
    plan: { intent: 'answer_question', tools: [{ name: 'retrieve' }, { name: 'verify' }] },
    evidence: { status: 'grounded' },
    verification: { support: 'supported' },
    memory: { items: [{ id: 1 }] },
    run: { steps: [{ step_type: 'retrieval', metadata: { queryCount: 3 } }] },
  }), [
    { label: '意图', value: 'answer_question' },
    { label: '工具', value: '2' },
    { label: '检索', value: '3' },
    { label: '证据', value: 'grounded' },
    { label: '校验', value: 'supported' },
    { label: '记忆', value: '1' },
  ])
  assert.deepEqual(assistantAgentStatusRows(null), [])
})

test('sourceOpenId returns openable material ids and skips group message citations', () => {
  assert.equal(sourceOpenId({ link_id: 42, id: 'source:1' }), 42)
  assert.equal(sourceOpenId({ id: 7 }), 7)
  assert.equal(sourceOpenId({ id: 'group-message:99' }), '')
  assert.equal(sourceOpenId({ link_id: '' }), '')
  assert.equal(sourceOpenId(null), '')
})
