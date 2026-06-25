import test from 'node:test';
import assert from 'node:assert/strict';
import Database from 'better-sqlite3';
import {
  extractItemUnderstanding,
  initItemUnderstandingSchema,
  searchItemUnderstanding,
  upsertItemUnderstanding,
} from '../utils/itemUnderstanding.js';

function setupDb() {
  const db = new Database(':memory:');
  db.exec(`
    CREATE TABLE users (
      id INTEGER PRIMARY KEY,
      username TEXT NOT NULL,
      password_hash TEXT NOT NULL
    );
    CREATE TABLE links (
      id INTEGER PRIMARY KEY,
      user_id INTEGER NOT NULL,
      type TEXT DEFAULT 'link',
      url TEXT DEFAULT '',
      title TEXT DEFAULT '',
      summary TEXT DEFAULT '',
      comment TEXT DEFAULT '',
      content TEXT DEFAULT '',
      content_md TEXT DEFAULT '',
      imported_at TEXT DEFAULT (datetime('now'))
    );
    INSERT INTO users (id, username, password_hash) VALUES (1, 'alice', 'hash');
  `);
  initItemUnderstandingSchema(db);
  return db;
}

test('extractItemUnderstanding finds entities topics todos and claims deterministically', () => {
  const result = extractItemUnderstanding({
    title: 'LinkBox Agent Roadmap',
    summary: 'Agent retrieval needs verification and memory.',
    comment: 'TODO: add citation verifier',
    content_md: '## Risk\n\nClaim: SQLite is enough for local knowledge.\n- [ ] add structured knowledge search',
  });

  assert.equal(result.entities.some(entity => entity.name === 'LinkBox'), true);
  assert.equal(result.topics.some(topic => topic.name === 'retrieval'), true);
  assert.equal(result.todos.some(todo => todo.text.includes('add citation verifier')), true);
  assert.equal(result.claims.some(claim => claim.text.includes('SQLite is enough')), true);
});

test('upsertItemUnderstanding replaces stale structures and search returns evidence rows', () => {
  const db = setupDb();
  try {
    db.prepare(`
      INSERT INTO links (id, user_id, title, summary, comment, content_md)
      VALUES (1, 1, 'LinkBox Agent Roadmap', 'Agent retrieval needs verification.', 'TODO: add citation verifier', 'Claim: SQLite is enough for local knowledge.')
    `).run();

    const first = upsertItemUnderstanding(db, 1);
    assert.equal(first.entities.length > 0, true);
    assert.equal(db.prepare('SELECT COUNT(*) AS count FROM item_todos').get().count, 1);

    db.prepare("UPDATE links SET comment = 'TODO: add memory diagnostics' WHERE id = 1").run();
    upsertItemUnderstanding(db, 1);
    assert.equal(db.prepare('SELECT COUNT(*) AS count FROM item_todos').get().count, 1);
    assert.match(db.prepare('SELECT text FROM item_todos').get().text, /memory diagnostics/);

    const rows = searchItemUnderstanding({
      db,
      userId: 1,
      query: 'memory diagnostics',
      limit: 5,
    });
    const todo = rows.find(row => row.knowledge_type === 'todo');
    assert.equal(todo.sourceKind, 'structured_knowledge');
    assert.equal(todo.retrieval_modes.includes('structured'), true);
    assert.match(todo.chunk_text, /memory diagnostics/);
  } finally {
    db.close();
  }
});
