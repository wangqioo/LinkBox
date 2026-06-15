import { strict as assert } from 'node:assert';
import { spawn } from 'node:child_process';
import http from 'node:http';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import Database from 'better-sqlite3';

const root = process.cwd();
const tmp = mkdtempSync(join(tmpdir(), 'linkbox-e2e-smoke-'));
const port = 42000 + Math.floor(Math.random() * 1000);
const llmPort = port + 2000;
let app;
let llm;

function wait(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function waitFor(url, timeoutMs = 15000) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    try {
      const res = await fetch(url);
      if (res.status < 500) return;
    } catch {}
    await wait(250);
  }
  throw new Error(`Timed out waiting for ${url}`);
}

async function request(path, { token = '', headers = {}, ...options } = {}) {
  const res = await fetch(`http://127.0.0.1:${port}${path}`, {
    ...options,
    headers: {
      ...(options.body && !(options.body instanceof FormData) ? { 'Content-Type': 'application/json' } : {}),
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...headers,
    },
  });
  const contentType = res.headers.get('content-type') || '';
  const text = await res.text();
  const data = contentType.includes('application/json') && text ? JSON.parse(text) : text;
  return { res, data };
}

function startMockLLM() {
  const seen = [];
  const server = http.createServer((req, res) => {
    if (req.url === '/v1/health') {
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify({ ok: true }));
      return;
    }
    if (req.url === '/v1/models') {
      seen.push({ method: req.method, url: req.url });
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify({ data: [{ id: 'mock-linkbox-model' }] }));
      return;
    }
    if (req.url === '/v1/chat/completions') {
      let body = '';
      req.on('data', chunk => { body += chunk; });
      req.on('end', () => {
        const parsed = JSON.parse(body || '{}');
        seen.push({ method: req.method, url: req.url, body: parsed });
        res.setHeader('Content-Type', 'application/json');
        res.end(JSON.stringify({
          choices: [{
            message: {
              content: 'Smoke assistant answer cites the saved note [资料1].',
            },
          }],
        }));
      });
      return;
    }
    res.statusCode = 404;
    res.end('not found');
  });
  return new Promise(resolve => {
    server.listen(llmPort, '127.0.0.1', () => resolve({ server, seen }));
  });
}

function seedFailedJob({ dbPath, linkId }) {
  const db = new Database(dbPath);
  try {
    db.prepare(`
      INSERT INTO jobs (type, link_id, payload, status, attempts, max_attempts, locked_at, last_error)
      VALUES ('link.summarize', ?, '{}', 'failed', 3, 3, 'stale-lock', 'mock failure')
    `).run(linkId);
    db.prepare('UPDATE links SET status = ? WHERE id = ?').run('error', linkId);
  } finally {
    db.close();
  }
}

async function main() {
  const uploadsDir = join(tmp, 'uploads');
  const dbPath = join(tmp, 'linkbox.db');
  const mock = await startMockLLM();
  llm = mock.server;

  app = spawn(process.execPath, ['index.js'], {
    cwd: root,
    env: {
      ...process.env,
      PORT: String(port),
      DATA_DIR: tmp,
      DB_PATH: dbPath,
      UPLOADS_DIR: uploadsDir,
      JWT_SECRET: 'linkbox-e2e-secret',
      LOCAL_LLM_URL: `http://127.0.0.1:${llmPort}/v1`,
      LOCAL_LLM_MODEL: 'mock-linkbox-model',
      BACKGROUND_QUEUE_CONCURRENCY: '1',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  app.stdout.on('data', d => process.stdout.write(`[app] ${d}`));
  app.stderr.on('data', d => process.stderr.write(`[app] ${d}`));

  await waitFor(`http://127.0.0.1:${port}/api/settings/ai`);

  const username = `e2e-${Date.now()}`;
  const password = 'pass1234';
  const registered = await request('/api/auth/register', {
    method: 'POST',
    body: JSON.stringify({ username, password }),
  });
  assert.equal(registered.res.status, 200);
  const token = registered.data.token;

  const loggedIn = await request('/api/auth/login', {
    method: 'POST',
    body: JSON.stringify({ username, password }),
  });
  assert.equal(loggedIn.res.status, 200);
  assert.equal(loggedIn.data.user.username, username);

  const system = await request('/api/settings/system', { token });
  assert.equal(system.res.status, 200);
  assert.ok(['healthy', 'degraded'].includes(system.data.health.status));
  assert.equal(system.data.health.checks.sqlite.status, 'ok');
  assert.equal(system.data.health.checks.uploads.status, 'ok');
  assert.equal(system.data.health.checks.queue.status, 'ok');
  assert.equal(system.data.health.checks.ai.status, 'ok');
  assert.equal(typeof system.data.health.summary.ok, 'number');

  const aiSaved = await request('/api/settings/ai', {
    method: 'PUT',
    token,
    body: JSON.stringify({
      provider: 'custom',
      baseUrl: `http://127.0.0.1:${llmPort}/v1`,
      model: 'mock-linkbox-model',
      apiKey: '',
    }),
  });
  assert.equal(aiSaved.res.status, 200);
  assert.equal(aiSaved.data.config.model, 'mock-linkbox-model');

  const textItem = await request('/api/links/text', {
    method: 'POST',
    token,
    body: JSON.stringify({
      title: 'E2E note',
      content: 'Smoke test body',
      comment: 'created by e2e',
    }),
  });
  assert.equal(textItem.res.status, 200);
  assert.equal(textItem.data.type, 'text');

  seedFailedJob({ dbPath, linkId: textItem.data.id });
  const retried = await request(`/api/links/${textItem.data.id}/retry-processing`, {
    method: 'POST',
    token,
  });
  assert.equal(retried.res.status, 200);
  assert.equal(retried.data.retried, 1);
  assert.ok(['queued', 'running', 'processing'].includes(retried.data.processing.state));

  const linkItem = await request('/api/links', {
    method: 'POST',
    token,
    body: JSON.stringify({
      url: 'https://example.com/e2e',
      title: 'E2E link',
    }),
  });
  assert.equal(linkItem.res.status, 200);
  assert.equal(linkItem.data.status, 'processing');

  const fixturePath = join(tmp, 'fixture.txt');
  writeFileSync(fixturePath, 'E2E uploaded file body\n', 'utf-8');
  const form = new FormData();
  form.set('title', 'E2E file');
  form.set('file', new Blob(['E2E uploaded file body\n'], { type: 'text/plain' }), 'fixture.txt');
  const fileItem = await request('/api/links/file', {
    method: 'POST',
    token,
    body: form,
  });
  assert.equal(fileItem.res.status, 200);
  assert.equal(fileItem.data.type, 'file');
  assert.equal(fileItem.data.display.type, 'document');

  const listed = await request('/api/links?limit=20', { token });
  assert.equal(listed.res.status, 200);
  assert.ok(listed.data.total >= 3);
  assert.ok(listed.data.links.some(item => item.title === 'E2E note'));
  assert.ok(listed.data.links.every(item => item.processing));
  assert.ok(listed.data.links.every(item => item.display));

  const chat = await request('/api/assistant/chat', {
    method: 'POST',
    token,
    body: JSON.stringify({
      question: 'What does the E2E note say?',
      task: 'ask',
    }),
  });
  assert.equal(chat.res.status, 200);
  assert.match(chat.data.answer, /Smoke assistant answer/);
  assert.equal(chat.data.sources.length >= 1, true);
  assert.ok(mock.seen.some(item => item.url === '/v1/chat/completions'));

  const updated = await request(`/api/links/${textItem.data.id}`, {
    method: 'PUT',
    token,
    body: JSON.stringify({ title: 'E2E note updated' }),
  });
  assert.equal(updated.res.status, 200);
  assert.equal(updated.data.title, 'E2E note updated');

  const exported = await request('/api/links/export/all', { token });
  assert.equal(exported.res.status, 200);
  assert.ok(exported.data.links.some(item => item.title === 'E2E note updated'));

  const summaries = await request('/api/links/export/summaries', { token });
  assert.equal(summaries.res.status, 200);
  assert.match(summaries.data, /LinkBox Summaries|导出|摘要/i);

  const deleted = await request(`/api/links/${textItem.data.id}`, {
    method: 'DELETE',
    token,
  });
  assert.equal(deleted.res.status, 200);
  assert.equal(deleted.data.ok, true);

  const afterDelete = await request(`/api/links/${textItem.data.id}`, { token });
  assert.equal(afterDelete.res.status, 404);

  console.log('LinkBox E2E smoke passed');
}

try {
  await main();
} finally {
  if (app) app.kill('SIGTERM');
  if (llm) llm.close();
  rmSync(tmp, { recursive: true, force: true });
}
