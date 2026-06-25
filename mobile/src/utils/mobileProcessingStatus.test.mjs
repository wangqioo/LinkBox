import assert from 'node:assert/strict'
import test from 'node:test'
import { mobileProcessingHint, mobileProcessingText } from './mobileProcessingStatus.js'

test('mobileProcessingText prefers processing failure details', () => {
  assert.equal(mobileProcessingText({
    status: 'failed',
    error: '',
    processing: {
      state: 'failed',
      lastError: '文件解析超时',
    },
  }), '文件解析超时')
})

test('mobileProcessingHint returns failure recovery hints separately', () => {
  assert.equal(mobileProcessingHint({
    status: 'failed',
    processing: {
      state: 'failed',
      recoveryHint: '检查文档解析依赖后重试',
    },
  }), '检查文档解析依赖后重试')
  assert.equal(mobileProcessingHint({ status: 'pending' }), '')
})

test('mobileProcessingText uses active processing label', () => {
  assert.equal(mobileProcessingText({
    status: 'ready',
    processing: {
      state: 'running',
      label: '生成文件摘要',
    },
  }), '生成文件摘要')
})

test('mobileProcessingText keeps pending fallback and ignores completed files', () => {
  assert.equal(mobileProcessingText({ status: 'pending' }), '后台处理中')
  assert.equal(mobileProcessingText({ status: 'ready' }), '')
})
