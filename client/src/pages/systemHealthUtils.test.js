import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  describeHealthCheck,
  describeOverallHealth,
  healthChecksForDisplay,
} from './systemHealthUtils.ts';

test('describeOverallHealth maps backend status to concise UI copy', () => {
  assert.deepEqual(describeOverallHealth('healthy'), {
    label: '健康',
    tone: 'ok',
    description: '核心服务和可选能力都可用。',
  });
  assert.deepEqual(describeOverallHealth('degraded'), {
    label: '降级',
    tone: 'warn',
    description: '核心服务可用，但部分 AI 或文档处理能力不可用。',
  });
  assert.deepEqual(describeOverallHealth('unhealthy'), {
    label: '异常',
    tone: 'fail',
    description: '核心依赖不可用，需要处理后再继续使用。',
  });
});

test('describeHealthCheck keeps failure messages and normalizes status labels', () => {
  assert.deepEqual(describeHealthCheck('sqlite', { status: 'fail', message: 'database locked' }), {
    key: 'sqlite',
    title: 'SQLite',
    status: 'fail',
    label: '失败',
    detail: 'database locked',
  });

  assert.deepEqual(describeHealthCheck('ai', { status: 'warn' }), {
    key: 'ai',
    title: 'AI Endpoint',
    status: 'warn',
    label: '降级',
    detail: 'AI Endpoint 当前不可用',
  });
});

test('healthChecksForDisplay returns stable operational check order', () => {
  const checks = healthChecksForDisplay({
    ai: { status: 'warn' },
    queue: { status: 'ok' },
    sqlite: { status: 'ok' },
    libreoffice: { status: 'warn' },
    uploads: { status: 'ok' },
    pdftotext: { status: 'ok' },
  });

  assert.deepEqual(checks.map((check) => check.key), [
    'sqlite',
    'uploads',
    'queue',
    'ai',
    'pdftotext',
    'libreoffice',
  ]);
});
