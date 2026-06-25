import test from 'node:test'
import assert from 'node:assert/strict'
import { assistantAgentStatusRows } from './assistantDiagnostics.js'

test('assistantAgentStatusRows formats compact mobile agent diagnostics', () => {
  assert.deepEqual(assistantAgentStatusRows({
    plan: {
      intent: 'answer_question',
      tools: [{ name: 'retrieve' }, { name: 'verify' }],
      subQuestions: ['已完成什么？', '还缺什么？'],
    },
    evidence: { status: 'grounded' },
    verification: {
      support: 'supported',
      retrievalConfidence: { level: 'high', score: 82 },
    },
    memory: { items: [{ id: 1 }] },
    run: { steps: [{ step_type: 'retrieval', metadata: { queryCount: 3, confidence: { level: 'high', score: 82 } } }] },
  }), [
    { label: '意图', value: 'answer_question' },
    { label: '工具', value: '2' },
    { label: '子问', value: '2' },
    { label: '检索', value: '3' },
    { label: '置信', value: 'high 82' },
    { label: '证据', value: 'grounded' },
    { label: '校验', value: 'supported' },
    { label: '记忆', value: '1' },
  ])
  assert.deepEqual(assistantAgentStatusRows(null), [])
})
