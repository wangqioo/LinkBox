import test from 'node:test';
import assert from 'node:assert/strict';
import Database from 'better-sqlite3';
import {
  appendAssistantMessage,
  createAssistantConversation,
  deleteAssistantConversation,
  initAssistantConversationSchema,
  listAssistantConversations,
  listAssistantMessages,
} from '../utils/assistantConversations.js';

function setupDb() {
  const db = new Database(':memory:');
  db.pragma('foreign_keys = ON');
  db.exec(`
    CREATE TABLE users (
      id INTEGER PRIMARY KEY,
      username TEXT NOT NULL,
      password_hash TEXT NOT NULL
    );
    CREATE TABLE groups (
      id INTEGER PRIMARY KEY,
      name TEXT NOT NULL,
      owner_id INTEGER NOT NULL
    );
    INSERT INTO users (id, username, password_hash) VALUES (1, 'alice', 'hash');
    INSERT INTO groups (id, name, owner_id) VALUES (10, 'Launch', 1);
  `);
  initAssistantConversationSchema(db);
  return db;
}

test('assistant conversations persist messages and sources', () => {
  const db = setupDb();
  try {
    const conversation = createAssistantConversation(db, {
      userId: 1,
      title: 'How should we launch this feature with a long title?',
    });
    appendAssistantMessage(db, {
      conversationId: conversation.id,
      role: 'user',
      content: 'What changed?',
      task: 'ask',
    });
    appendAssistantMessage(db, {
      conversationId: conversation.id,
      role: 'assistant',
      content: 'The assistant now has history.',
      task: 'ask',
      sources: [{ id: 7, title: 'Release notes' }],
    });

    const list = listAssistantConversations(db, { userId: 1, groupId: null });
    assert.equal(list.length, 1);
    assert.equal(list[0].message_count, 2);
    assert.equal(list[0].title, 'How should we launch this feature with a');

    const history = listAssistantMessages(db, { userId: 1, conversationId: conversation.id, groupId: null });
    assert.equal(history.messages.length, 2);
    assert.deepEqual(history.messages[1].sources, [{ id: 7, title: 'Release notes' }]);
  } finally {
    db.close();
  }
});

test('assistant conversations keep personal and group history separated', () => {
  const db = setupDb();
  try {
    const personal = createAssistantConversation(db, { userId: 1, title: 'Personal' });
    const group = createAssistantConversation(db, { userId: 1, groupId: 10, title: 'Group' });

    assert.deepEqual(listAssistantConversations(db, { userId: 1, groupId: null }).map(item => item.id), [personal.id]);
    assert.deepEqual(listAssistantConversations(db, { userId: 1, groupId: 10 }).map(item => item.id), [group.id]);
    assert.equal(listAssistantMessages(db, { userId: 1, conversationId: group.id, groupId: null }), null);

    assert.equal(deleteAssistantConversation(db, { userId: 1, conversationId: group.id, groupId: null }), false);
    assert.equal(deleteAssistantConversation(db, { userId: 1, conversationId: group.id, groupId: 10 }), true);
  } finally {
    db.close();
  }
});
