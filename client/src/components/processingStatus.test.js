import assert from 'node:assert/strict';
import { test } from 'node:test';
import { deriveProcessingDisplay } from './processingStatus.ts';

test('deriveProcessingDisplay prefers failed processing details and retry state', () => {
  const display = deriveProcessingDisplay({
    status: 'error',
    processing: {
      state: 'failed',
      stage: 'file.extractMarkdown',
      label: 'Extracting file content',
      canRetry: true,
      failedJobId: 42,
      lastError: 'LibreOffice timed out',
      updatedAt: '2026-06-17T00:00:00.000Z',
    },
  });

  assert.deepEqual(display, {
    kind: 'failed',
    text: 'LibreOffice timed out',
    step: 0,
    canRetry: true,
  });
});

test('deriveProcessingDisplay maps active summarize jobs to step two', () => {
  const display = deriveProcessingDisplay({
    status: 'processing',
    processing: {
      state: 'running',
      stage: 'file.summarize',
      label: '生成文件摘要',
      canRetry: false,
      failedJobId: null,
      lastError: '',
      updatedAt: '2026-06-17T00:00:00.000Z',
    },
  });

  assert.deepEqual(display, {
    kind: 'active',
    text: '生成文件摘要',
    step: 2,
    canRetry: false,
  });
});

test('deriveProcessingDisplay falls back to legacy extraction and summary states', () => {
  assert.deepEqual(deriveProcessingDisplay({
    status: 'processing',
    hasMarkdown: false,
    hasSummary: false,
  }), {
    kind: 'active',
    text: '正在提取正文...',
    step: 1,
    canRetry: false,
  });

  assert.deepEqual(deriveProcessingDisplay({
    status: 'processing',
    hasMarkdown: true,
    hasSummary: false,
  }), {
    kind: 'active',
    text: '正在生成摘要...',
    step: 2,
    canRetry: false,
  });
});

test('deriveProcessingDisplay uses video wording for Bilibili fallback processing', () => {
  assert.deepEqual(deriveProcessingDisplay({
    status: 'processing',
    itemType: 'link',
    url: 'https://www.bilibili.com/video/BV1GDjB66EE9/',
    hasMarkdown: false,
    hasSummary: false,
  }), {
    kind: 'active',
    text: '正在处理视频...',
    step: 1,
    canRetry: false,
  });
});

test('deriveProcessingDisplay uses video wording for normalized video items', () => {
  assert.deepEqual(deriveProcessingDisplay({
    status: 'processing',
    itemType: 'video',
    url: 'https://b23.tv/abc123',
    hasMarkdown: false,
    hasSummary: false,
  }), {
    kind: 'active',
    text: '正在处理视频...',
    step: 1,
    canRetry: false,
  });
});

test('deriveProcessingDisplay returns null for completed items', () => {
  assert.equal(deriveProcessingDisplay({
    status: 'done',
    hasMarkdown: true,
    hasSummary: true,
  }), null);
});
