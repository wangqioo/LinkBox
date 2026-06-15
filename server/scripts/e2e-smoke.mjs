import { strict as assert } from 'node:assert';
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const root = process.cwd();
const tmp = mkdtempSync(join(tmpdir(), 'linkbox-e2e-smoke-'));
const port = 42000 + Math.floor(Math.random() * 1000);
let app;

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

async function main() {
  const uploadsDir = join(tmp, 'uploads');
  app = spawn(process.execPath, ['index.js'], {
    cwd: root,
    env: {
      ...process.env,
      PORT: String(port),
      DATA_DIR: tmp,
      DB_PATH: join(tmp, 'linkbox.db'),
      UPLOADS_DIR: uploadsDir,
      JWT_SECRET: 'linkbox-e2e-secret',
      LOCAL_LLM_URL: 'http://127.0.0.1:1/v1',
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
  rmSync(tmp, { recursive: true, force: true });
}
