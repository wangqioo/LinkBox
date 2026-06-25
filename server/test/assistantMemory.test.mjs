import test from 'node:test';
import assert from 'node:assert/strict';
import Database from 'better-sqlite3';
import {
  captureAssistantMemories,
  deleteAssistantMemory,
  initAssistantMemorySchema,
  listAssistantMemories,
  searchAssistantMemories,
} from '../utils/assistantMemory.js';

function setupDb() {
  const db = new Database(':memory:');
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
  initAssistantMemorySchema(db);
  return db;
}

test('captureAssistantMemories stores explicit user preferences', () => {
  const db = setupDb();
  try {
    const result = captureAssistantMemories(db, {
      userId: 1,
      text: '记住：回答时先给结论，再列证据。',
    });

    assert.equal(result.created, 1);
    const memories = searchAssistantMemories({ db, userId: 1, query: '回答 证据' });
    assert.equal(memories.length, 1);
    assert.equal(memories[0].memory_type, 'preference');
    assert.match(memories[0].content, /先给结论/);
  } finally {
    db.close();
  }
});

test('searchAssistantMemories keeps group and personal memory separated', () => {
  const db = setupDb();
  try {
    captureAssistantMemories(db, {
      userId: 1,
      groupId: 10,
      text: '以后这个群默认关注 Launch 风险。',
    });

    assert.equal(searchAssistantMemories({ db, userId: 1, query: 'Launch 风险' }).length, 0);
    assert.equal(searchAssistantMemories({ db, userId: 1, groupId: 10, query: 'Launch 风险' }).length, 1);
  } finally {
    db.close();
  }
});

test('listAssistantMemories and deleteAssistantMemory respect scope ownership', () => {
  const db = setupDb();
  try {
    const personal = captureAssistantMemories(db, {
      userId: 1,
      text: '记住：回答时先给结论。',
    });
    const group = captureAssistantMemories(db, {
      userId: 1,
      groupId: 10,
      text: '以后这个群默认关注 Launch 风险。',
    });

    assert.deepEqual(listAssistantMemories({ db, userId: 1 }).map(memory => memory.id), personal.memories);
    assert.deepEqual(listAssistantMemories({ db, userId: 1, groupId: 10 }).map(memory => memory.id), group.memories);
    assert.equal(deleteAssistantMemory(db, { userId: 1, memoryId: group.memories[0] }), false);
    assert.equal(deleteAssistantMemory(db, { userId: 1, groupId: 10, memoryId: group.memories[0] }), true);
    assert.deepEqual(listAssistantMemories({ db, userId: 1, groupId: 10 }), []);
  } finally {
    db.close();
  }
});
