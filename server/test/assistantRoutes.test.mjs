import test from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import { mkdtempSync, rmSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { generateToken } from '../middleware/auth.js';

async function withAssistantApp(fn) {
  const dir = mkdtempSync(join(tmpdir(), 'linkbox-assistant-routes-test-'));
  const dbPath = join(dir, 'test.db');
  const oldDbPath = process.env.DB_PATH;
  const oldDataDir = process.env.DATA_DIR;
  const oldUploadsDir = process.env.UPLOADS_DIR;
  process.env.DB_PATH = dbPath;
  process.env.DATA_DIR = dir;
  process.env.UPLOADS_DIR = join(dir, 'uploads');

  let db;
  let server;
  try {
    const token = `${Date.now()}-${Math.random()}`;
    const dbModule = await import(`../db.js?assistant-routes-test=${token}`);
    db = dbModule.default;
    db.prepare(`
      INSERT INTO users (id, username, password_hash)
      VALUES (1, 'admin', 'hash')
      ON CONFLICT(id) DO NOTHING
    `).run();
    const assistantModule = await import(`../routes/assistant.js?assistant-routes-test=${token}`);

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
      headers: {
        Authorization: `Bearer ${generateToken(1)}`,
        'Content-Type': 'application/json',
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

test('POST /api/assistant/retrieval-diagnostics returns retrieval metadata without calling LLM', async () => withAssistantApp(async ({ db, baseUrl, headers }) => {
  db.prepare(`
    INSERT INTO links (id, user_id, type, title, imported_at, content_md)
    VALUES (1, 1, 'file', 'Queue Notes', '2026-06-11T00:00:00.000Z', ?)
  `).run(`# Queue Notes

## Durable Jobs

Durable queue retry metadata.`);

  const response = await fetch(`${baseUrl}/api/assistant/retrieval-diagnostics`, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      question: 'durable queue retry',
      task: 'ask',
      scope: { type: 'document' },
    }),
  });
  const body = await response.json();

  assert.equal(response.status, 200);
  assert.equal(body.query, 'durable queue retry');
  assert.equal(body.task, 'ask');
  assert.deepEqual(body.scope, { type: 'document' });
  assert.equal(body.settings.enabled, true);
  assert.equal(body.sources[0].sourceKind, 'document');
  assert.equal(body.sources[0].id, 1);
  assert.equal(body.sources[0].heading_path, 'Queue Notes > Durable Jobs');
  assert.equal(body.sources[0].retrieval_modes.includes('keyword'), true);
  assert.match(body.sources[0].snippet, /Durable queue retry metadata/);
}));
