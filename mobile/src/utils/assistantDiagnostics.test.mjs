import test from 'node:test'
import assert from 'node:assert/strict'
import { assistantAgentStatusRows } from './assistantDiagnostics.js'

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
