import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import { mkdtempSync, rmSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { generateToken } from '../middleware/auth.js';

const testDir = mkdtempSync(join(tmpdir(), 'linkbox-assistant-purpose-test-'));
process.env.DB_PATH = join(testDir, 'test.db');
process.env.DATA_DIR = testDir;
process.env.UPLOADS_DIR = join(testDir, 'uploads');

after(() => {
  rmSync(testDir, { recursive: true, force: true });
});

async function withMockAnswerLlmStream(fn) {
  const originalFetch = globalThis.fetch;
  const requests = [];
  try {
    globalThis.fetch = async (url, options = {}) => {
      if (String(url).includes('/chat/completions')) {
        requests.push(JSON.parse(String(options.body || '{}')));
        return new Response('data: {"choices":[{"delta":{"content":"根据资料回答。[1]"}}]}\n\ndata: [DONE]\n\n', {
          status: 200,
          headers: { 'Content-Type': 'text/event-stream; charset=utf-8' },
        });
      }
      return originalFetch(url, options);
    };
    return await fn({ requests });
  } finally {
    globalThis.fetch = originalFetch;
  }
}

async function readSse(response) {
  const text = await response.text();
  return text
    .split('\n\n')
    .filter(Boolean)
    .map(raw => {
      const lines = raw.split('\n');
      return {
        event: lines.find(line => line.startsWith('event:'))?.slice(6).trim() || 'message',
        data: lines.find(line => line.startsWith('data:'))?.slice(5).trim() || '',
      };
    });
}

test('assistant stream sends final answer through agent purpose config', async () => withMockAnswerLlmStream(async (mockLlm) => {
  const dbModule = await import('../db.js');
  const assistantModule = await import('../routes/assistant.js');
  const db = dbModule.default;
  db.prepare(`
    INSERT INTO users (id, username, password_hash)
    VALUES (1, 'admin', 'hash')
    ON CONFLICT(id) DO NOTHING
  `).run();
  const insertSetting = db.prepare('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)');
  [
    ['ai:organize:provider', 'custom'],
    ['ai:organize:base_url', 'http://organize.invalid/v1'],
    ['ai:organize:model', 'organize-model'],
    ['ai:agent:provider', 'custom'],
    ['ai:agent:base_url', 'http://agent.invalid/v1'],
    ['ai:agent:model', 'agent-model'],
  ].forEach(([key, value]) => insertSetting.run(key, value));
  db.prepare(`
    INSERT INTO links (id, user_id, type, title, imported_at, content_md)
    VALUES (1, 1, 'file', 'Agent Routing Note', '2026-06-11T00:00:00.000Z', 'Agent routing evidence.')
  `).run();

  const app = express();
  app.use(express.json());
  app.use('/api/assistant', assistantModule.createAssistantRouter(db));
  const server = await new Promise((resolve, reject) => {
    const listening = app.listen(0, '127.0.0.1', () => resolve(listening));
    listening.on('error', reject);
  });
  try {
    const response = await fetch(`http://127.0.0.1:${server.address().port}/api/assistant/chat/stream`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${generateToken(1)}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        question: 'Agent routing evidence',
        task: 'ask',
      }),
    });
    const events = await readSse(response);

    assert.equal(response.status, 200);
    assert.equal(events.some(event => event.event === 'done'), true);
    assert.equal(mockLlm.requests.length, 1);
    assert.equal(mockLlm.requests[0].model, 'agent-model');
  } finally {
    await new Promise(resolve => server.close(resolve));
    db.close();
  }
}));

