import test from 'node:test'
import assert from 'node:assert/strict'
import { groupImageBatches } from './imageBatchGallery.js'

test('groupImageBatches groups same-batch images into one gallery item ordered by batch_index', () => {
  const rows = [
    { id: '3', type: 'image', batch_id: 'b1', batch_index: 2, original_filename: 'c.jpg' },
    { id: '1', type: 'image', batch_id: 'b1', batch_index: 0, original_filename: 'a.jpg' },
    { id: '2', type: 'image', batch_id: 'b1', batch_index: 1, original_filename: 'b.jpg' },
  ]

  const result = groupImageBatches(rows)

  assert.equal(result.length, 1)
  assert.equal(result[0].kind, 'image-batch')
  assert.equal(result[0].id, 'batch:b1')
  assert.deepEqual(result[0].images.map(image => image.id), ['1', '2', '3'])
  assert.equal(result[0].activeIndex, 0)
})

test('groupImageBatches leaves single images and non-images as normal items', () => {
  const rows = [
    { id: '10', type: 'image', batch_id: 'solo', batch_index: 0 },
    { id: '11', type: 'file', batch_id: 'solo', batch_index: 1 },
    { id: '12', type: 'image', batch_id: '', batch_index: 0 },
  ]

  const result = groupImageBatches(rows)

  assert.deepEqual(result.map(item => item.kind), ['item', 'item', 'item'])
  assert.deepEqual(result.map(item => item.file.id), ['10', '11', '12'])
})

test('groupImageBatches places a gallery at the newest row position for that batch', () => {
  const rows = [
    { id: '20', type: 'text', original_filename: 'note' },
    { id: '22', type: 'image', batch_id: 'b2', batch_index: 1 },
    { id: '21', type: 'image', batch_id: 'b2', batch_index: 0 },
    { id: '19', type: 'link', original_filename: 'link' },
  ]

  const result = groupImageBatches(rows)

  assert.deepEqual(result.map(item => item.kind), ['item', 'image-batch', 'item'])
  assert.equal(result[1].id, 'batch:b2')
})

test('groupImageBatches keeps intervening non-images before the completed gallery', () => {
  const rows = [
    { id: '30', type: 'image', batch_id: 'b3', batch_index: 0 },
    { id: '31', type: 'document', original_filename: 'doc.pdf' },
    { id: '32', type: 'image', batch_id: 'b3', batch_index: 1 },
  ]

  const result = groupImageBatches(rows)

  assert.deepEqual(result.map(item => item.kind), ['item', 'image-batch'])
  assert.equal(result[0].file.id, '31')
  assert.deepEqual(result[1].images.map(image => image.id), ['30', '32'])
})
