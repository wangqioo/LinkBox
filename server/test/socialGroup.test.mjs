import assert from 'node:assert/strict';
import test from 'node:test';
import Database from 'better-sqlite3';
import { retrieveSources } from '../utils/assistantRetrieval.js';

function setupDb() {
  const db = new Database(':memory:');
  db.pragma('foreign_keys = ON');
  db.exec(`
    CREATE TABLE users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      username TEXT UNIQUE NOT NULL,
      password_hash TEXT NOT NULL,
      created_at TEXT DEFAULT (datetime('now'))
    );
    CREATE TABLE links (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      type TEXT DEFAULT 'link',
      url TEXT DEFAULT '',
      title TEXT DEFAULT '',
      description TEXT DEFAULT '',
      comment TEXT DEFAULT '',
      content TEXT DEFAULT '',
      content_md TEXT DEFAULT '',
      summary TEXT DEFAULT '',
      imported_at TEXT DEFAULT (datetime('now')),
      scope TEXT DEFAULT 'personal',
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    );
    CREATE TABLE link_chunks (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      link_id INTEGER NOT NULL,
      user_id INTEGER NOT NULL,
      chunk_index INTEGER NOT NULL,
      text TEXT NOT NULL,
      created_at TEXT DEFAULT (datetime('now')),
      UNIQUE(link_id, chunk_index)
    );
    CREATE TABLE documents (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      item_id INTEGER NOT NULL,
      user_id INTEGER NOT NULL,
      title TEXT DEFAULT '',
      markdown TEXT DEFAULT '',
      markdown_hash TEXT DEFAULT '',
      parser_version TEXT DEFAULT '',
      language TEXT DEFAULT '',
      status TEXT DEFAULT 'ready',
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now')),
      UNIQUE(item_id, parser_version)
    );
    CREATE TABLE document_chunks (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      document_id INTEGER NOT NULL,
      chunk_index INTEGER NOT NULL,
      heading_path TEXT DEFAULT '',
      chunk_type TEXT DEFAULT 'text',
      content TEXT NOT NULL,
      content_hash TEXT DEFAULT '',
      token_count INTEGER DEFAULT 0,
      char_start INTEGER DEFAULT 0,
      char_end INTEGER DEFAULT 0,
      metadata_json TEXT DEFAULT '{}',
      created_at TEXT DEFAULT (datetime('now')),
      UNIQUE(document_id, chunk_index)
    );
    CREATE TABLE friendships (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      requester_id INTEGER NOT NULL,
      addressee_id INTEGER NOT NULL,
      status TEXT NOT NULL DEFAULT 'pending',
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now')),
      UNIQUE(requester_id, addressee_id),
      CHECK(requester_id != addressee_id)
    );
    CREATE TABLE groups (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      description TEXT DEFAULT '',
      owner_id INTEGER NOT NULL,
      agent_name TEXT DEFAULT 'Group Agent',
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now'))
    );
    CREATE TABLE group_members (
      group_id INTEGER NOT NULL,
      user_id INTEGER NOT NULL,
      role TEXT NOT NULL DEFAULT 'member',
      joined_at TEXT DEFAULT (datetime('now')),
      PRIMARY KEY (group_id, user_id)
    );
    CREATE TABLE group_messages (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      group_id INTEGER NOT NULL,
      user_id INTEGER NOT NULL,
      body TEXT NOT NULL,
      message_type TEXT NOT NULL DEFAULT 'text',
      created_at TEXT DEFAULT (datetime('now'))
    );
    CREATE TABLE group_links (
      group_id INTEGER NOT NULL,
      link_id INTEGER NOT NULL,
      shared_by INTEGER NOT NULL,
      note TEXT DEFAULT '',
      created_at TEXT DEFAULT (datetime('now')),
      PRIMARY KEY (group_id, link_id)
    );
  `);
  return db;
}

test('accepted friends can be grouped, message, and share scoped materials', () => {
  const db = setupDb();
  db.prepare("INSERT INTO users (id, username, password_hash) VALUES (1, 'alice', 'x'), (2, 'bob', 'x'), (3, 'cara', 'x')").run();
  db.prepare("INSERT INTO friendships (requester_id, addressee_id, status) VALUES (1, 2, 'accepted')").run();
  db.prepare("INSERT INTO groups (id, name, owner_id, agent_name) VALUES (10, 'Launch', 1, 'Group Agent')").run();
  db.prepare("INSERT INTO group_members (group_id, user_id, role) VALUES (10, 1, 'owner'), (10, 2, 'member')").run();
  db.prepare("INSERT INTO group_messages (group_id, user_id, body) VALUES (10, 2, 'Please review the launch note')").run();
  db.prepare(`
    INSERT INTO links (id, user_id, type, title, content, content_md, summary, imported_at)
    VALUES
      (100, 1, 'text', 'Launch Plan', 'roadmap beta launch', 'roadmap beta launch', 'Shared launch summary', '2026-06-01'),
      (101, 1, 'text', 'Private Payroll', 'salary private payroll', 'salary private payroll', 'Private summary', '2026-06-02'),
      (102, 3, 'text', 'Cara Private', 'competitor secret', 'competitor secret', 'Secret summary', '2026-06-03'),
      (103, 2, 'text', 'Chat Upload', 'standup blocker detail', 'standup blocker detail', 'Chat scoped summary', '2026-06-04')
  `).run();
  db.prepare("INSERT INTO group_links (group_id, link_id, shared_by, note) VALUES (10, 100, 1, 'for team')").run();
  db.prepare("UPDATE links SET scope = 'chat' WHERE id = 103").run();
  db.prepare("INSERT INTO group_links (group_id, link_id, shared_by, note) VALUES (10, 103, 2, 'from chat')").run();

  const messages = db.prepare('SELECT body FROM group_messages WHERE group_id = ?').all(10);
  assert.deepEqual(messages.map(row => row.body), ['Please review the launch note']);

  const sources = retrieveSources({
    db,
    userId: 2,
    groupId: 10,
    question: 'launch roadmap',
    task: 'ask',
    enableEmbeddings: false,
    enableRerank: false,
  });

  assert.ok(sources.some(source => source.id === 100 && source.title === 'Launch Plan'));
  assert.ok(!sources.some(source => source.id === 101 || source.id === 102));

  const chatSources = retrieveSources({
    db,
    userId: 1,
    groupId: 10,
    question: 'standup blocker',
    task: 'ask',
    enableEmbeddings: false,
    enableRerank: false,
  });
  assert.ok(chatSources.some(source => source.id === 103));
  assert.ok(!chatSources.some(source => source.id === 101 || source.id === 102));

  const groupMessageSources = retrieveSources({
    db,
    userId: 1,
    groupId: 10,
    question: 'Please review launch note',
    task: 'ask',
    enableEmbeddings: false,
    enableRerank: false,
  });
  assert.ok(groupMessageSources.some(source => source.id === 'group-message:1' && source.type === 'group_message'));

  db.prepare("UPDATE links SET comment = 'risk owner is alice' WHERE id = 100").run();
  const commentSources = retrieveSources({
    db,
    userId: 2,
    groupId: 10,
    question: 'risk owner alice',
    task: 'ask',
    enableEmbeddings: false,
    enableRerank: false,
  });
  assert.ok(commentSources.some(source => source.id === 100));

  const noteSources = retrieveSources({
    db,
    userId: 2,
    groupId: 10,
    question: 'for team',
    task: 'ask',
    enableEmbeddings: false,
    enableRerank: false,
  });
  assert.ok(noteSources.some(source => source.id === 100));
});
