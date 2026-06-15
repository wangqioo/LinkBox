import { accessSync, constants as fsConstants } from 'fs';
import { execFile as execFileCallback } from 'child_process';

const DEFAULT_TIMEOUT_MS = 1500;

function messageFromError(error, fallback = 'check failed') {
  return String(error?.message || error || fallback);
}

function normalizeVersion(stdout, stderr = '') {
  const text = String(stdout || stderr || '').trim();
  return text.split('\n').find(Boolean)?.slice(0, 200) || '';
}

function summarizeChecks(checks) {
  const values = Object.values(checks);
  return {
    ok: values.filter(check => check.status === 'ok').length,
    degraded: values.filter(check => check.status === 'warn').length,
    failed: values.filter(check => check.status === 'fail').length,
  };
}

function statusFromSummary(summary) {
  if (summary.failed > 0) return 'unhealthy';
  if (summary.degraded > 0) return 'degraded';
  return 'healthy';
}

export function checkSqliteHealth(db) {
  try {
    const row = db.prepare('SELECT 1 AS ok').get();
    if (row?.ok !== 1) {
      return { status: 'fail', message: 'unexpected SQLite probe result' };
    }
    return { status: 'ok' };
  } catch (error) {
    return { status: 'fail', message: messageFromError(error) };
  }
}

export function checkUploadsHealth(uploadsDir, fs = { accessSync, constants: fsConstants }) {
  if (!uploadsDir) {
    return { status: 'fail', path: '', message: 'uploads directory is not configured' };
  }

  try {
    fs.accessSync(uploadsDir, fs.constants.R_OK | fs.constants.W_OK);
    return { status: 'ok', path: uploadsDir };
  } catch (error) {
    return { status: 'fail', path: uploadsDir, message: messageFromError(error) };
  }
}

export function checkQueueHealth(queue) {
  try {
    const stats = queue.stats();
    const failed = Number(stats.failed || 0);
    return {
      status: failed > 0 ? 'warn' : 'ok',
      ...stats,
      failed,
      message: failed > 0 ? `${failed} failed background job${failed === 1 ? '' : 's'}` : undefined,
    };
  } catch (error) {
    return { status: 'fail', message: messageFromError(error) };
  }
}

export function checkCommandHealth(name, command, args, {
  execFile = execFileCallback,
  timeoutMs = DEFAULT_TIMEOUT_MS,
} = {}) {
  return new Promise((resolve) => {
    execFile(command, args, { timeout: timeoutMs }, (error, stdout, stderr) => {
      if (error) {
        resolve({
          status: 'warn',
          command,
          message: error.killed ? `timeout after ${timeoutMs}ms` : messageFromError(error, `${name} unavailable`),
        });
        return;
      }

      resolve({
        status: 'ok',
        command,
        version: normalizeVersion(stdout, stderr),
      });
    });
  });
}

async function fetchTextWithTimeout(url, {
  fetchImpl = globalThis.fetch,
  timeoutMs = DEFAULT_TIMEOUT_MS,
} = {}) {
  if (!fetchImpl) {
    throw new Error('fetch is not available');
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetchImpl(url, { signal: controller.signal });
    const text = await response.text();
    return { response, text };
  } finally {
    clearTimeout(timeout);
  }
}

export async function checkAiEndpointHealth(localLlmUrl, {
  fetch = globalThis.fetch,
  timeoutMs = DEFAULT_TIMEOUT_MS,
} = {}) {
  const baseUrl = String(localLlmUrl || '').trim().replace(/\/+$/, '');
  if (!baseUrl) {
    return { status: 'warn', message: 'AI endpoint is not configured' };
  }

  const url = `${baseUrl}/health`;
  try {
    const { response, text } = await fetchTextWithTimeout(url, { fetchImpl: fetch, timeoutMs });
    if (!response.ok) {
      return {
        status: 'warn',
        url,
        httpStatus: response.status,
        message: `AI endpoint returned HTTP ${response.status}`,
        body: text.slice(0, 500),
      };
    }
    return {
      status: 'ok',
      url,
      httpStatus: response.status,
    };
  } catch (error) {
    return {
      status: 'warn',
      url,
      message: error?.name === 'AbortError' ? `timeout after ${timeoutMs}ms` : messageFromError(error),
    };
  }
}

export async function getSystemHealth({
  db,
  queue,
  uploadsDir,
  localLlmUrl = process.env.LOCAL_LLM_URL || '',
  execFile = execFileCallback,
  fetch = globalThis.fetch,
  fs = { accessSync, constants: fsConstants },
  timeoutMs = DEFAULT_TIMEOUT_MS,
} = {}) {
  const [ai, pdftotext, libreoffice] = await Promise.all([
    checkAiEndpointHealth(localLlmUrl, { fetch, timeoutMs }),
    checkCommandHealth('pdftotext', process.env.PDFTOTEXT_BIN || 'pdftotext', ['-v'], { execFile, timeoutMs }),
    checkCommandHealth('LibreOffice', process.env.LIBREOFFICE_BIN || 'libreoffice', ['--version'], { execFile, timeoutMs }),
  ]);

  const checks = {
    sqlite: checkSqliteHealth(db),
    uploads: checkUploadsHealth(uploadsDir, fs),
    queue: checkQueueHealth(queue),
    ai,
    pdftotext,
    libreoffice,
  };
  const summary = summarizeChecks(checks);
  const status = statusFromSummary(summary);

  return {
    ok: status !== 'unhealthy',
    status,
    checkedAt: new Date().toISOString(),
    summary,
    checks,
  };
}
