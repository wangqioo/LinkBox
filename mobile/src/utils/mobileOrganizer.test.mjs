import test from 'node:test'
import assert from 'node:assert/strict'
import { buildTodayDigest, organizeFile } from './mobileOrganizer.js'

test('organizeFile infers a topic and kind from mixed notes', () => {
  const result = organizeFile({
    type: 'text',
    original_filename: 'LinkBox 产品设计',
    content: '需要思考 AI 自动整理资料的交互方案',
  })

  assert.equal(result.topic, 'LinkBox')
  assert.equal(result.kind, '想法')
  assert.equal(result.action, true)
})

test('buildTodayDigest summarizes topics and reading items', () => {
  const digest = buildTodayDigest([
    {
      id: '1',
      type: 'link',
      status: 'ready',
      original_filename: 'AI 模型文章',
      summary: '一篇关于 LLM 的网页文章',
      created_at: '2026-06-10T08:00:00.000Z',
    },
    {
      id: '2',
      type: 'text',
      status: 'pending',
      original_filename: '临时想法',
      content: '需要整理 LinkBox 今日资料',
      created_at: '2026-06-10T09:00:00.000Z',
    },
  ], new Date('2026-06-10T12:00:00.000Z'))

  assert.equal(digest.total, 2)
  assert.equal(digest.pending, 1)
  assert.equal(digest.topics.some(topic => topic.label === 'LinkBox'), true)
  assert.equal(digest.reading.length, 1)
})
