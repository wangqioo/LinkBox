import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import { mkdtempSync, rmSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { generateToken } from '../middleware/auth.js';

const testDir = mkdtempSync(join(tmpdir(), 'linkbox-embedding-config-test-'));
process.env.DB_PATH = join(testDir, 'test.db');
process.env.DATA_DIR = testDir;
process.env.UPLOADS_DIR = join(testDir, 'uploads');

after(() => {
  rmSync(testDir, { recursive: true, force: true });
});

async function withEmbeddingApp(fn) {
  const token = `${Date.now()}-${Math.random()}`;

  let db;
  let server;
  try {
    const dbModule = await import('../db.js');
    db = dbModule.default;
    db.prepare("DELETE FROM settings WHERE key LIKE 'embedding:%'").run();
    db.prepare(`
      INSERT INTO users (id, username, password_hash)
      VALUES (1, 'admin', 'hash')
      ON CONFLICT(id) DO NOTHING
    `).run();

    const settingsModule = await import(`../routes/settings.js?embedding-config-test=${token}`);
    const embeddingConfigModule = await import(`../utils/embeddingConfig.js?embedding-config-test=${token}`);

    const app = express();
    app.use(express.json());
    app.use('/api/settings', settingsModule.default);

    server = await new Promise((resolve, reject) => {
      const listening = app.listen(0, '127.0.0.1', () => resolve(listening));
      listening.on('error', reject);
    });

    return await fn({
      db,
      embeddingConfig: embeddingConfigModule,
      baseUrl: `http://127.0.0.1:${server.address().port}`,
      adminHeaders: {
        Authorization: `Bearer ${generateToken(1)}`,
      },
    });
  } finally {
    if (server) await new Promise(resolve => server.close(resolve));
  }
}

async function withEmbeddingEndpoint(fn) {
  const calls = [];
  const app = express();
  app.use(express.json());
  app.post('/v1/embeddings', (req, res) => {
    calls.push({
      authorization: req.get('authorization') || '',
      body: req.body,
    });
    res.json({
      object: 'list',
      data: [{ object: 'embedding', index: 0, embedding: [0.1, 0.2, 0.3] }],
      model: req.body.model,
    });
  });

  let server;
  try {
    server = await new Promise((resolve, reject) => {
      const listening = app.listen(0, '127.0.0.1', () => resolve(listening));
      listening.on('error', reject);
    });
    return await fn({
      calls,
      baseUrl: `http://127.0.0.1:${server.address().port}/v1`,
    });
  } finally {
    if (server) await new Promise(resolve => server.close(resolve));
  }
}

test('embedding config defaults to enabled local hash embeddings without exposing apiKey', async () => withEmbeddingApp(async ({ embeddingConfig }) => {
  const config = embeddingConfig.getEmbeddingConfig();

  assert.deepEqual(config, {
    enabled: true,
    provider: 'local',
    baseUrl: '',
    model: 'linkbox-local-hash-v1',
    apiKeyConfigured: false,
  });
  assert.equal(Object.hasOwn(config, 'apiKey'), false);
}));

test('embedding config stores separate embedding keys and sanitizes secrets', async () => withEmbeddingApp(async ({ db, embeddingConfig }) => {
  const config = embeddingConfig.updateEmbeddingConfig({
    enabled: false,
    provider: 'openai-compatible',
    baseUrl: 'https://embeddings.example.com/v1/',
    model: 'text-embedding-3-small',
    apiKey: 'secret-key',
  });

  assert.deepEqual(config, {
    enabled: false,
    provider: 'openai-compatible',
    baseUrl: 'https://embeddings.example.com/v1',
    model: 'text-embedding-3-small',
    apiKeyConfigured: true,
  });
  assert.equal(Object.hasOwn(config, 'apiKey'), false);
  assert.deepEqual(
    db.prepare("SELECT key, value FROM settings WHERE key LIKE 'embedding:%' ORDER BY key").all(),
    [
      { key: 'embedding:api_key', value: 'secret-key' },
      { key: 'embedding:base_url', value: 'https://embeddings.example.com/v1' },
      { key: 'embedding:enabled', value: '0' },
      { key: 'embedding:model', value: 'text-embedding-3-small' },
      { key: 'embedding:provider', value: 'openai-compatible' },
    ],
  );

  const secretConfig = embeddingConfig.getEmbeddingConfig({ includeSecret: true });
  assert.equal(secretConfig.apiKey, 'secret-key');
}));

test('embedding config rejects invalid openai-compatible settings', async () => withEmbeddingApp(async ({ embeddingConfig }) => {
  assert.throws(
    () => embeddingConfig.updateEmbeddingConfig({
      provider: 'openai-compatible',
      baseUrl: 'file:///tmp/embedding',
      model: 'text-embedding-3-small',
    }),
    /Embedding endpoint address must start with http:\/\/ or https:\/\//,
  );
  assert.throws(
    () => embeddingConfig.updateEmbeddingConfig({
      provider: 'openai-compatible',
      baseUrl: 'https://embeddings.example.com/v1',
      model: '   ',
    }),
    /Embedding model name is required/,
  );
}));

test('GET and PUT /api/settings/embeddings return sanitized embedding config', async () => withEmbeddingApp(async ({ baseUrl, adminHeaders }) => {
  const putResponse = await fetch(`${baseUrl}/api/settings/embeddings`, {
    method: 'PUT',
    headers: {
      ...adminHeaders,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      provider: 'openai-compatible',
      baseUrl: 'https://embeddings.example.com/v1/',
      model: 'embed-small',
      apiKey: 'route-secret',
    }),
  });
  const putBody = await putResponse.json();

  assert.equal(putResponse.status, 200);
  assert.deepEqual(putBody, {
    ok: true,
    config: {
      enabled: true,
      provider: 'openai-compatible',
      baseUrl: 'https://embeddings.example.com/v1',
      model: 'embed-small',
      apiKeyConfigured: true,
    },
  });
  assert.equal(Object.hasOwn(putBody.config, 'apiKey'), false);

  const getResponse = await fetch(`${baseUrl}/api/settings/embeddings`, { headers: adminHeaders });
  const getBody = await getResponse.json();

  assert.equal(getResponse.status, 200);
  assert.deepEqual(getBody, putBody.config);
}));

test('POST /api/settings/embeddings/test returns local result without network', async () => withEmbeddingApp(async ({ baseUrl, adminHeaders }) => {
  const response = await fetch(`${baseUrl}/api/settings/embeddings/test`, {
    method: 'POST',
    headers: {
      ...adminHeaders,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ provider: 'local' }),
  });
  const body = await response.json();

  assert.equal(response.status, 200);
  assert.deepEqual(body, {
    ok: true,
    provider: 'local',
    model: 'linkbox-local-hash-v1',
    dimension: 64,
  });
}));

test('POST /api/settings/embeddings/test calls openai-compatible /embeddings', async () => withEmbeddingEndpoint(async (endpoint) => withEmbeddingApp(async ({ baseUrl, adminHeaders }) => {
  const response = await fetch(`${baseUrl}/api/settings/embeddings/test`, {
    method: 'POST',
    headers: {
      ...adminHeaders,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      provider: 'openai-compatible',
      baseUrl: endpoint.baseUrl,
      model: 'remote-embed',
      apiKey: 'remote-secret',
    }),
  });
  const body = await response.json();

  assert.equal(response.status, 200);
  assert.deepEqual(body, {
    ok: true,
    provider: 'openai-compatible',
    model: 'remote-embed',
    dimension: 3,
  });
  assert.deepEqual(endpoint.calls, [
    {
      authorization: 'Bearer remote-secret',
      body: { model: 'remote-embed', input: ['LinkBox embedding configuration test'] },
    },
  ]);
})));

test('generic settings endpoint reserves embedding keys and does not leak them', async () => withEmbeddingApp(async ({ db, baseUrl, adminHeaders }) => {
  db.prepare("INSERT OR REPLACE INTO settings (key, value) VALUES ('embedding:api_key', 'secret')").run();

  const getResponse = await fetch(`${baseUrl}/api/settings`, { headers: adminHeaders });
  const getBody = await getResponse.json();
  assert.equal(getResponse.status, 200);
  assert.equal(Object.hasOwn(getBody, 'embedding:api_key'), false);

  const putResponse = await fetch(`${baseUrl}/api/settings`, {
    method: 'PUT',
    headers: {
      ...adminHeaders,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ 'embedding:model': 'bypass' }),
  });
  const putBody = await putResponse.json();

  assert.equal(putResponse.status, 400);
  assert.match(putBody.error, /Embedding 配置请使用专用接口/);
}));
