import test from 'node:test';
import assert from 'node:assert/strict';
import Database from 'better-sqlite3';
import {
  areFriends,
  currentIsoTime,
  directMessagePayload,
  ensureGroupMember,
  groupMessagePayload,
  materialPayload,
  requireAcceptedFriend,
  toUtcIsoTime,
} from '../utils/socialService.js';

function setupDb() {
  const db = new Database(':memory:');
  db.exec(`
    CREATE TABLE users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      username TEXT UNIQUE NOT NULL,
      password_hash TEXT NOT NULL
    );
    CREATE TABLE friendships (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      requester_id INTEGER NOT NULL,
      addressee_id INTEGER NOT NULL,
      status TEXT NOT NULL DEFAULT 'pending'
    );
    CREATE TABLE groups (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      owner_id INTEGER NOT NULL,
      agent_name TEXT DEFAULT 'Group Agent'
    );
    CREATE TABLE group_members (
      group_id INTEGER NOT NULL,
      user_id INTEGER NOT NULL,
      role TEXT NOT NULL DEFAULT 'member',
      PRIMARY KEY (group_id, user_id)
    );
  `);
  db.prepare("INSERT INTO users (id, username, password_hash) VALUES (1, 'alice', 'x'), (2, 'bob', 'x'), (3, 'cara', 'x')").run();
  db.prepare("INSERT INTO friendships (requester_id, addressee_id, status) VALUES (1, 2, 'accepted'), (1, 3, 'pending')").run();
  db.prepare("INSERT INTO groups (id, name, owner_id, agent_name) VALUES (10, 'Launch', 1, 'Launch Agent')").run();
  db.prepare("INSERT INTO group_members (group_id, user_id, role) VALUES (10, 1, 'owner'), (10, 2, 'member')").run();
  return db;
}

test('socialService reads group membership and accepted friendships', () => {
  const db = setupDb();

  assert.deepEqual(ensureGroupMember(db, 10, 1), {
    role: 'owner',
    name: 'Launch',
    owner_id: 1,
    agent_name: 'Launch Agent',
  });
  assert.equal(ensureGroupMember(db, 10, 3), null);
  assert.equal(areFriends(db, 1, 2), true);
  assert.equal(areFriends(db, 2, 1), true);
  assert.equal(areFriends(db, 1, 3), false);
  assert.deepEqual(requireAcceptedFriend(db, 1, 2), { id: 2, username: 'bob' });
  assert.equal(requireAcceptedFriend(db, 1, 1), null);
  assert.equal(requireAcceptedFriend(db, 1, 3), null);

  db.close();
});

test('socialService normalizes timestamps and message payloads', () => {
  assert.match(currentIsoTime(), /^\d{4}-\d{2}-\d{2}T/);
  assert.equal(toUtcIsoTime('2026-06-25 10:11:12'), '2026-06-25T10:11:12.000Z');
  assert.equal(toUtcIsoTime('2026-06-25'), '2026-06-25T00:00:00.000Z');
  assert.equal(toUtcIsoTime('not-a-date'), 'not-a-date');
  assert.equal(toUtcIsoTime(''), '');

  assert.deepEqual(directMessagePayload({
    id: 1,
    user_id: 2,
    username: 'bob',
    body: 'hello',
    created_at: '2026-06-25 10:11:12',
  }), {
    id: 1,
    user_id: 2,
    username: 'bob',
    body: 'hello',
    created_at: '2026-06-25T10:11:12.000Z',
    user: { id: 2, username: 'bob' },
  });

  assert.deepEqual(groupMessagePayload({
    id: 2,
    group_id: 10,
    user_id: 1,
    username: 'alice',
    body: 'group',
    created_at: '2026-06-25',
  }).user, { id: 1, username: 'alice' });
});

test('materialPayload exposes stable material metadata and optional mobile file', () => {
  assert.deepEqual(materialPayload({
    id: 44,
    title: '',
    url: 'https://example.com',
    summary: '',
    description: 'desc',
    type: 'link',
  }, { file: { id: 44, type: 'link' } }), {
    link_id: 44,
    title: 'https://example.com',
    summary: 'desc',
    type: 'link',
    url: 'https://example.com',
    file: { id: 44, type: 'link' },
  });
});
