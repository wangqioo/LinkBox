import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { checkAiEndpointHealth, getSystemHealth } from '../utils/systemHealth.js';

async function withTempDir(fn) {
  const dir = mkdtempSync(join(tmpdir(), 'linkbox-system-health-test-'));
  try {
    return await fn(dir);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

function createDb({ fail = false } = {}) {
  return {
    prepare(sql) {
      assert.equal(sql, 'SELECT 1 AS ok');
      return {
        get() {
          if (fail) throw new Error('database locked');
          return { ok: 1 };
        },
      };
    },
  };
}

function createExecFile({ missingCommands = new Set(), versions = {} } = {}) {
  return (command, args, options, callback) => {
    assert.ok(Array.isArray(args));
    assert.equal(options.timeout, 1500);
    if (missingCommands.has(command)) {
      const error = new Error(`${command} not found`);
      error.code = 'ENOENT';
      callback(error, '', '');
      return;
    }
    callback(null, versions[command] || `${command} version 1.0\n`, '');
  };
}

function createFetch({ ok = true, status = 200, error = null } = {}) {
  return async (url, options) => {
    assert.equal(url, 'http://127.0.0.1:8000/v1/health');
    assert.ok(options.signal);
    if (error) throw error;
    return {
      ok,
      status,
      async text() {
        return ok ? '{"ok":true}' : '{"error":"offline"}';
      },
    };
  };
}

function createQueue(stats = {}) {
  return {
    stats() {
      return {
        concurrency: 2,
        running: 0,
        queued: 0,
        leased: 0,
        done: 3,
        failed: 0,
        lastFailed: null,
        ...stats,
      };
    },
  };
}

test('getSystemHealth reports healthy when core and optional dependencies pass', async () => withTempDir(async (uploadsDir) => {
  const health = await getSystemHealth({
    db: createDb(),
    queue: createQueue(),
    uploadsDir,
    localLlmUrl: 'http://127.0.0.1:8000/v1',
    execFile: createExecFile(),
    fetch: createFetch(),
  });

  assert.equal(health.status, 'healthy');
  assert.equal(health.ok, true);
  assert.equal(health.checks.sqlite.status, 'ok');
  assert.equal(health.checks.uploads.status, 'ok');
  assert.equal(health.checks.queue.status, 'ok');
  assert.equal(health.checks.ai.status, 'ok');
  assert.equal(health.checks.pdftotext.status, 'ok');
  assert.equal(health.checks.libreoffice.status, 'ok');
  assert.equal(health.checks.uploads.path, uploadsDir);
  assert.match(health.checks.pdftotext.version, /pdftotext/);
  assert.equal(health.summary.ok, 6);
  assert.equal(health.summary.degraded, 0);
  assert.equal(health.summary.failed, 0);
}));

test('getSystemHealth degrades when optional AI and document tooling are unavailable', async () => withTempDir(async (uploadsDir) => {
  const health = await getSystemHealth({
    db: createDb(),
    queue: createQueue({ failed: 2, lastFailed: { id: 8, type: 'file.extractMarkdown' } }),
    uploadsDir,
    localLlmUrl: 'http://127.0.0.1:8000/v1',
    execFile: createExecFile({ missingCommands: new Set(['pdftotext', 'libreoffice']) }),
    fetch: createFetch({ ok: false, status: 503 }),
  });

  assert.equal(health.status, 'degraded');
  assert.equal(health.ok, true);
  assert.equal(health.checks.sqlite.status, 'ok');
  assert.equal(health.checks.uploads.status, 'ok');
  assert.equal(health.checks.queue.status, 'warn');
  assert.equal(health.checks.queue.failed, 2);
  assert.equal(health.checks.ai.status, 'warn');
  assert.match(health.checks.ai.message, /HTTP 503/);
  assert.equal(health.checks.pdftotext.status, 'warn');
  assert.match(health.checks.pdftotext.message, /not found/);
  assert.equal(health.checks.libreoffice.status, 'warn');
  assert.equal(health.summary.ok, 2);
  assert.equal(health.summary.degraded, 4);
  assert.equal(health.summary.failed, 0);
}));

test('getSystemHealth is unhealthy when core SQLite or upload storage checks fail', async () => {
  const health = await getSystemHealth({
    db: createDb({ fail: true }),
    queue: createQueue(),
    uploadsDir: join(tmpdir(), 'linkbox-missing-upload-parent', 'uploads'),
    localLlmUrl: '',
    execFile: createExecFile(),
    fetch: createFetch(),
    fs: {
      accessSync() {
        throw new Error('permission denied');
      },
      constants: { R_OK: 4, W_OK: 2 },
    },
  });

  assert.equal(health.status, 'unhealthy');
  assert.equal(health.ok, false);
  assert.equal(health.checks.sqlite.status, 'fail');
  assert.match(health.checks.sqlite.message, /database locked/);
  assert.equal(health.checks.uploads.status, 'fail');
  assert.match(health.checks.uploads.message, /permission denied/);
  assert.equal(health.checks.ai.status, 'warn');
  assert.match(health.checks.ai.message, /not configured/);
  assert.equal(health.summary.failed, 2);
});

test('checkAiEndpointHealth accepts OpenAI-compatible models endpoint when health endpoint is absent', async () => {
  const requestedUrls = [];
  const health = await checkAiEndpointHealth('http://127.0.0.1:8000/v1', {
    fetch: async (url, options) => {
      requestedUrls.push(url);
      assert.ok(options.signal);
      if (url.endsWith('/health')) {
        return {
          ok: false,
          status: 404,
          async text() {
            return '{"detail":"Not Found"}';
          },
        };
      }
      return {
        ok: true,
        status: 200,
        async text() {
          return '{"object":"list","data":[{"id":"Qwen3.5-4B"}]}';
        },
      };
    },
  });

  assert.equal(health.status, 'ok');
  assert.equal(health.url, 'http://127.0.0.1:8000/v1/models');
  assert.deepEqual(requestedUrls, [
    'http://127.0.0.1:8000/v1/health',
    'http://127.0.0.1:8000/v1/models',
  ]);
});
