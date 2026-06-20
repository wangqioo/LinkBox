import test from 'node:test'
import assert from 'node:assert/strict'
import { categoryItems, filesForCategory } from './mobileCategoryDisplay.js'

test('categoryItems exposes normalized mobile categories with labels and counts', () => {
  const items = categoryItems({
    by_type: {
      video: 2,
      article: 1,
      document: 3,
      link: 0,
    },
  })

  assert.deepEqual(items.map(item => [item.type, item.label, item.count]), [
    ['document', '文档', 3],
    ['video', '视频', 2],
    ['article', '文章', 1],
  ])
})

test('filesForCategory matches normalized file types', () => {
  const files = [
    { id: '1', type: 'video' },
    { id: '2', type: 'article' },
    { id: '3', type: 'document' },
    { id: '4', type: 'link' },
  ]

  assert.deepEqual(filesForCategory(files, 'video').map(file => file.id), ['1'])
  assert.deepEqual(filesForCategory(files, 'article').map(file => file.id), ['2'])
  assert.deepEqual(filesForCategory(files, 'document').map(file => file.id), ['3'])
})
