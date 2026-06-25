import test from 'node:test';
import assert from 'node:assert/strict';
import {
  initialEnrichmentJob,
  labelForEnrichmentJob,
  followupEnrichmentJobs,
  recoveryHintForEnrichmentJob,
} from '../utils/itemEnrichmentPlan.js';

test('initialEnrichmentJob maps accepted item processing payloads to durable jobs', () => {
  assert.deepEqual(initialEnrichmentJob('link', { linkId: 7, url: 'https://example.com', title: 'Example' }), {
    type: 'link.fetchMetadata',
    linkId: 7,
    payload: { url: 'https://example.com', title: 'Example' },
    maxAttempts: 3,
  });
  assert.deepEqual(initialEnrichmentJob('image', { linkId: 8, diskPath: '/tmp/a.png' }), {
    type: 'image.describe',
    linkId: 8,
    payload: { diskPath: '/tmp/a.png' },
    maxAttempts: 3,
  });
  assert.deepEqual(initialEnrichmentJob('file', { linkId: 9, diskPath: '/tmp/a.pdf', originalName: 'a.pdf', isHtml: false }), {
    type: 'file.extractMarkdown',
    linkId: 9,
    payload: { diskPath: '/tmp/a.pdf', originalName: 'a.pdf', isHtml: false },
    maxAttempts: 3,
  });
});

test('labelForEnrichmentJob centralizes generic and video stage labels', () => {
  assert.equal(labelForEnrichmentJob('link.extractMarkdown', { type: 'link', url: 'https://example.com' }), '提取网页正文');
  assert.equal(labelForEnrichmentJob('link.extractMarkdown', { type: 'link', url: 'https://b23.tv/abc123' }), '转写视频文字');
  assert.equal(labelForEnrichmentJob('link.summarize', { type: 'link', url: 'https://b23.tv/abc123' }), '生成视频摘要');
});

test('recoveryHintForEnrichmentJob centralizes failed job recovery guidance', () => {
  assert.equal(
    recoveryHintForEnrichmentJob('file.extractMarkdown'),
    '确认文件格式受支持，检查 pdftotext/LibreOffice 等文档解析依赖后重试。',
  );
  assert.equal(
    recoveryHintForEnrichmentJob('link.summarize'),
    '检查 AI 服务地址、模型和 API Key 是否可用后重试。',
  );
  assert.equal(
    recoveryHintForEnrichmentJob('document.embed'),
    '检查 Embedding 配置和模型服务后重试，必要时重新建立文档索引。',
  );
  assert.equal(
    recoveryHintForEnrichmentJob('unknown.job'),
    '查看错误详情，确认相关服务或文件可用后重试。',
  );
});

test('followupEnrichmentJobs describes persistence follow-up jobs', () => {
  assert.deepEqual(followupEnrichmentJobs({ linkId: 10, summaryJobType: 'link.summarize', documentId: 22 }), [
    { type: 'document.embed', linkId: 10, payload: {}, maxAttempts: 2 },
    { type: 'link.summarize', linkId: 10, payload: {}, maxAttempts: 3 },
  ]);
  assert.deepEqual(followupEnrichmentJobs({ linkId: 10, summarize: false, documentId: 22 }), [
    { type: 'document.embed', linkId: 10, payload: {}, maxAttempts: 2 },
  ]);
  assert.deepEqual(followupEnrichmentJobs({ linkId: 10, summaryJobType: 'link.summarize', documentId: null }), [
    { type: 'link.summarize', linkId: 10, payload: {}, maxAttempts: 3 },
  ]);
});
