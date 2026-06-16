import test from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import { mkdtempSync, rmSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { generateToken } from '../middleware/auth.js';
import { indexDocumentForItem } from '../utils/documentIndex.js';

async function withAssistantApp(fn) {
  const dir = mkdtempSync(join(tmpdir(), 'linkbox-assistant-diagnostics-route-test-'));
  const oldDbPath = process.env.DB_PATH;
  const oldDataDir = process.env.DATA_DIR;
  const oldUploadsDir = process.env.UPLOADS_DIR;
  process.env.DB_PATH = join(dir, 'test.db');
  process.env.DATA_DIR = dir;
  process.env.UPLOADS_DIR = join(dir, 'uploads');

  let db;
  let server;
  try {
    const token = `${Date.now()}-${Math.random()}`;
    const dbModule = await import(`../db.js?assistant-diagnostics-db=${token}`);
    db = dbModule.default;
    const assistantModule = await import(`../routes/assistant.js?assistant-diagnostics-test=${token}`);

    const app = express();
    app.use(express.json());
    app.use('/api/assistant', assistantModule.default);

    server = await new Promise((resolve, reject) => {
      const listening = app.listen(0, '127.0.0.1', () => resolve(listening));
      listening.on('error', reject);
    });

    return await fn({
      db,
      baseUrl: `http://127.0.0.1:${server.address().port}`,
      authHeaders: {
        Authorization: `Bearer ${generateToken(7)}`,
      },
    });
  } finally {
    if (server) await new Promise(resolve => server.close(resolve));
    db?.close();
    process.env.DB_PATH = oldDbPath;
    process.env.DATA_DIR = oldDataDir;
    process.env.UPLOADS_DIR = oldUploadsDir;
    rmSync(dir, { recursive: true, force: true });
  }
}

function seedDocument(db) {
  db.prepare('DELETE FROM document_embeddings').run();
  db.prepare('DELETE FROM document_chunks').run();
  db.prepare('DELETE FROM documents').run();
  db.prepare('DELETE FROM links WHERE id = 90').run();
  db.prepare(`
    INSERT INTO users (id, username, password_hash)
    VALUES (7, 'diagnostics-user', 'hash')
    ON CONFLICT(id) DO NOTHING
  `).run();
  db.prepare(`
    INSERT INTO links (id, user_id, type, url, title, summary, imported_at, content_md)
    VALUES (90, 7, 'file', '', 'Diagnostics Notes', '', '2026-06-17T00:00:00.000Z', ?)
  `).run('# Diagnostics Notes\n\n## Durable Jobs\n\nDurable retrieval diagnostics explain chunk scores.');
  db.prepare("INSERT OR REPLACE INTO settings (key, value) VALUES ('embedding:enabled', '0')").run();
  db.prepare("INSERT OR REPLACE INTO settings (key, value) VALUES ('embedding:api_key', 'route-secret')").run();
  indexDocumentForItem(db, 90);
}

test('POST /api/assistant/retrieval-diagnostics returns retrieval metadata without an LLM answer', async () => withAssistantApp(async ({ db, baseUrl, authHeaders }) => {
  seedDocument(db);

  const response = await fetch(`${baseUrl}/api/assistant/retrieval-diagnostics`, {
    method: 'POST',
    headers: {
      ...authHeaders,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      question: 'durable retrieval diagnostics',
      task: 'report',
      scope: { type: 'document' },
    }),
  });
  const body = await response.json();

  assert.equal(response.status, 200);
  assert.equal(Object.hasOwn(body, 'answer'), false);
  assert.equal(body.query, 'durable retrieval diagnostics');
  assert.equal(body.task, 'report');
  assert.deepEqual(body.scope, { type: 'document' });
  assert.equal(body.settings.enabled, false);
  assert.equal(body.settings.apiKeyConfigured, true);
  assert.equal(Object.hasOwn(body.settings, 'apiKey'), false);
  assert.equal(body.sources.length, 1);
  assert.equal(body.sources[0].link_id, 90);
  assert.equal(body.sources[0].sourceKind, 'document');
  assert.equal(typeof body.sources[0].document_id, 'number');
  assert.equal(body.sources[0].heading_path, 'Diagnostics Notes > Durable Jobs');
  assert.match(body.sources[0].snippet, /Durable retrieval diagnostics/);
  assert.equal(typeof body.sources[0].score, 'number');
}));

test('POST /api/assistant/retrieval-diagnostics requires auth', async () => withAssistantApp(async ({ baseUrl }) => {
  const response = await fetch(`${baseUrl}/api/assistant/retrieval-diagnostics`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ question: 'durable retrieval diagnostics' }),
  });

  assert.equal(response.status, 401);
}));
