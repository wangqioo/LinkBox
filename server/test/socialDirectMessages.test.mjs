import test from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import { mkdtempSync, rmSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { generateToken } from '../middleware/auth.js';

async function withSocialApp(fn) {
  const dir = mkdtempSync(join(tmpdir(), 'linkbox-social-dm-test-'));
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
    const dbModule = await import(`../db.js?social-dm-test=${token}`);
    db = dbModule.default;
    const socialModule = await import(`../routes/social.js?social-dm-test=${token}`);

    db.exec(`
      DELETE FROM direct_messages;
      DELETE FROM group_links;
      DELETE FROM group_messages;
      DELETE FROM group_members;
      DELETE FROM groups;
      DELETE FROM friendships;
      DELETE FROM links;
      DELETE FROM users;
    `);
    db.prepare(`
      INSERT INTO users (id, username, password_hash)
      VALUES (1, 'alice', 'hash'), (2, 'bob', 'hash'), (3, 'cara', 'hash')
    `).run();
    db.prepare(`
      INSERT INTO friendships (requester_id, addressee_id, status)
      VALUES (1, 2, 'accepted'), (1, 3, 'pending')
    `).run();
    db.prepare(`
      INSERT INTO groups (id, name, owner_id, agent_name)
      VALUES (10, 'Launch', 1, 'Launch Agent')
    `).run();
    db.prepare(`
      INSERT INTO group_members (group_id, user_id, role)
      VALUES (10, 1, 'owner'), (10, 2, 'member')
    `).run();

    const app = express();
    app.use(express.json());
    app.use('/api/social', socialModule.createSocialRouter(db));
    server = await new Promise((resolve, reject) => {
      const listening = app.listen(0, '127.0.0.1', () => resolve(listening));
      listening.on('error', reject);
    });

    return await fn({
      db,
      baseUrl: `http://127.0.0.1:${server.address().port}`,
      aliceHeaders: {
        Authorization: `Bearer ${generateToken(1)}`,
        'Content-Type': 'application/json',
      },
      bobHeaders: {
        Authorization: `Bearer ${generateToken(2)}`,
        'Content-Type': 'application/json',
      },
      caraHeaders: {
        Authorization: `Bearer ${generateToken(3)}`,
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

test('accepted friends can exchange direct messages with current user metadata', async () => withSocialApp(async ({ baseUrl, aliceHeaders, bobHeaders }) => {
  const send = await fetch(`${baseUrl}/api/social/friends/2/messages`, {
    method: 'POST',
    headers: aliceHeaders,
    body: JSON.stringify({ body: '今晚看资料' }),
  });
  const sent = await send.json();

  assert.equal(send.status, 201);
  assert.equal(sent.user_id, 1);
  assert.equal(sent.recipient_id, 2);
  assert.equal(sent.body, '今晚看资料');
  assert.equal(sent.user.username, 'alice');
  assert.match(sent.created_at, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);

  const list = await fetch(`${baseUrl}/api/social/friends/1/messages`, { headers: bobHeaders });
  const payload = await list.json();

  assert.equal(list.status, 200);
  assert.deepEqual(payload.current_user, { id: 2, username: 'bob' });
  assert.equal(payload.friend.id, 1);
  assert.equal(payload.messages.length, 1);
  assert.equal(payload.messages[0].body, '今晚看资料');
  assert.equal(payload.messages[0].created_at, sent.created_at);
}));

test('direct messages require an accepted friendship', async () => withSocialApp(async ({ baseUrl, aliceHeaders, caraHeaders }) => {
  const pending = await fetch(`${baseUrl}/api/social/friends/3/messages`, {
    method: 'POST',
    headers: aliceHeaders,
    body: JSON.stringify({ body: 'hello' }),
  });
  assert.equal(pending.status, 403);

  const notFriend = await fetch(`${baseUrl}/api/social/friends/1/messages`, {
    method: 'POST',
    headers: caraHeaders,
    body: JSON.stringify({ body: 'hello' }),
  });
  assert.equal(notFriend.status, 403);
}));

test('group messages return timezone-stable timestamps', async () => withSocialApp(async ({ baseUrl, aliceHeaders, bobHeaders }) => {
  const send = await fetch(`${baseUrl}/api/social/groups/10/messages`, {
    method: 'POST',
    headers: aliceHeaders,
    body: JSON.stringify({ body: '群里确认一下时间' }),
  });
  const sent = await send.json();

  assert.equal(send.status, 201, JSON.stringify(sent));
  assert.equal(sent.user_id, 1);
  assert.equal(sent.group_id, 10);
  assert.equal(sent.body, '群里确认一下时间');
  assert.match(sent.created_at, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);

  const list = await fetch(`${baseUrl}/api/social/groups/10/messages`, { headers: bobHeaders });
  const payload = await list.json();

  assert.equal(list.status, 200, JSON.stringify(payload));
  assert.equal(payload.messages.length, 1);
  assert.equal(payload.messages[0].body, '群里确认一下时间');
  assert.equal(payload.messages[0].created_at, sent.created_at);
}));

test('accepted friends can share owned materials in direct messages', async () => withSocialApp(async ({ db, baseUrl, aliceHeaders, bobHeaders }) => {
  db.prepare(`
    INSERT INTO links (id, user_id, type, title, summary, imported_at)
    VALUES (44, 1, 'document', '设计稿', '首页结构说明', '2026-06-24T00:00:00.000Z')
  `).run();
  assert.deepEqual(db.prepare('SELECT id, user_id FROM links WHERE id = 44').get(), { id: 44, user_id: 1 });

  const share = await fetch(`${baseUrl}/api/social/friends/2/materials`, {
    method: 'POST',
    headers: aliceHeaders,
    body: JSON.stringify({ link_id: 44 }),
  });
  const shared = await share.json();

  assert.equal(share.status, 201, JSON.stringify(shared));
  assert.equal(shared.message_type, 'material');
  assert.equal(shared.body, '44');
  assert.equal(shared.material.title, '设计稿');
  assert.equal(shared.material.type, 'document');

  const list = await fetch(`${baseUrl}/api/social/friends/1/messages`, { headers: bobHeaders });
  const payload = await list.json();

  assert.equal(list.status, 200);
  assert.equal(payload.messages.length, 1);
  assert.equal(payload.messages[0].message_type, 'material');
  assert.equal(payload.messages[0].material.link_id, 44);
  assert.equal(payload.messages[0].material.summary, '首页结构说明');
}));
