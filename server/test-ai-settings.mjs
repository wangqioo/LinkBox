import { strict as assert } from 'node:assert';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawn } from 'node:child_process';
import http from 'node:http';

const root = process.cwd();
const tmp = mkdtempSync(join(tmpdir(), 'linkbox-ai-settings-'));
const port = 41000 + Math.floor(Math.random() * 1000);
const llmPort = port + 1000;
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

function startMockLLM() {
  const seen = [];
  const server = http.createServer(async (req, res) => {
    if (req.url === '/v1/models') {
      seen.push({ method: req.method, url: req.url, auth: req.headers.authorization || '' });
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify({ data: [{ id: 'mock-model' }] }));
      return;
    }
    if (req.url === '/v1/chat/completions') {
      let body = '';
      req.on('data', chunk => { body += chunk; });
      req.on('end', () => {
        seen.push({ method: req.method, url: req.url, auth: req.headers.authorization || '', body: JSON.parse(body || '{}') });
        res.setHeader('Content-Type', 'application/json');
        res.end(JSON.stringify({ choices: [{ message: { content: '测试通过' } }] }));
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

async function request(path, options = {}, token = '') {
  const res = await fetch(`http://127.0.0.1:${port}${path}`, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(options.headers || {}),
    },
  });
  const text = await res.text();
  const data = text ? JSON.parse(text) : null;
  return { res, data };
}

try {
  const mock = await startMockLLM();
  llm = mock.server;

  app = spawn(process.execPath, ['index.js'], {
    cwd: root,
    env: {
      ...process.env,
      PORT: String(port),
      DATA_DIR: tmp,
      DB_PATH: join(tmp, 'linkbox.db'),
      UPLOADS_DIR: join(tmp, 'uploads'),
      JWT_SECRET: 'test-secret',
      LOCAL_LLM_URL: 'http://127.0.0.1:1/v1',
      LOCAL_LLM_MODEL: 'env-model',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  app.stdout.on('data', d => process.stdout.write(`[app] ${d}`));
  app.stderr.on('data', d => process.stderr.write(`[app] ${d}`));
  await waitFor(`http://127.0.0.1:${port}/api/settings/ai`);
  console.log('app ready');

  const adminReg = await request('/api/auth/register', { method: 'POST', body: JSON.stringify({ username: 'admin', password: 'pass1234' }) });
  assert.equal(adminReg.res.status, 200);
  const adminToken = adminReg.data.token;

  const userReg = await request('/api/auth/register', { method: 'POST', body: JSON.stringify({ username: 'user', password: 'pass1234' }) });
  assert.equal(userReg.res.status, 200);
  const userToken = userReg.data.token;

  const unauth = await request('/api/settings/ai');
  assert.equal(unauth.res.status, 401);

  const forbidden = await request('/api/settings/ai', {}, userToken);
  assert.equal(forbidden.res.status, 403);

  const defaults = await request('/api/settings/ai', {}, adminToken);
  assert.equal(defaults.res.status, 200);
  assert.equal(defaults.data.baseUrl, 'http://127.0.0.1:1/v1');
  assert.equal(defaults.data.model, 'env-model');
  assert.equal(defaults.data.apiKeyConfigured, false);
  assert.equal(defaults.data.apiKey, undefined);

  const save = await request('/api/settings/ai', {
    method: 'PUT',
    body: JSON.stringify({
      baseUrl: `http://127.0.0.1:${llmPort}/v1`,
      model: 'mock-model',
      visionModel: 'mock-vision',
      apiKey: 'sk-test-secret',
      temperature: 0.2,
      enableThinking: false,
    }),
  }, adminToken);
  assert.equal(save.res.status, 200);
  assert.equal(save.data.ok, true);
  assert.equal(save.data.config.apiKeyConfigured, true);
  assert.equal(save.data.config.apiKey, undefined);

  const saved = await request('/api/settings/ai', {}, adminToken);
  assert.equal(saved.data.baseUrl, `http://127.0.0.1:${llmPort}/v1`);
  assert.equal(saved.data.model, 'mock-model');
  assert.equal(saved.data.visionModel, 'mock-vision');
  assert.equal(saved.data.apiKeyConfigured, true);
  assert.equal(saved.data.apiKey, undefined);

  const test = await request('/api/settings/ai/test', { method: 'POST', body: JSON.stringify({}) }, adminToken);
  assert.equal(test.res.status, 200);
  assert.equal(test.data.ok, true);
  assert.equal(test.data.model, 'mock-model');
  assert.ok(mock.seen.some(item => item.url === '/v1/models' && item.auth === 'Bearer sk-test-secret'));

  const genericSettings = await request('/api/settings', {}, adminToken);
  assert.equal(genericSettings.res.status, 200);
  assert.equal(Object.keys(genericSettings.data).some(key => key.startsWith('ai:')), false);

  const genericAIWrite = await request('/api/settings', {
    method: 'PUT',
    body: JSON.stringify({ 'ai:api_key': 'leaked' }),
  }, adminToken);
  assert.equal(genericAIWrite.res.status, 400);

  mock.seen.length = 0;
  const changedEndpointTest = await request('/api/settings/ai/test', {
    method: 'POST',
    body: JSON.stringify({ baseUrl: `http://localhost:${llmPort}/v1` }),
  }, adminToken);
  assert.equal(changedEndpointTest.res.status, 200);
  assert.ok(mock.seen.some(item => item.url === '/v1/models' && item.auth === ''));

  const bad = await request('/api/settings/ai', {
    method: 'PUT',
    body: JSON.stringify({ baseUrl: 'ftp://bad', model: '' }),
  }, adminToken);
  assert.equal(bad.res.status, 400);

  console.log('AI settings API tests passed');
} finally {
  if (app) app.kill('SIGTERM');
  if (llm) llm.close();
  rmSync(tmp, { recursive: true, force: true });
}
