import test from 'node:test';
import assert from 'node:assert/strict';
import Database from 'better-sqlite3';
import { mkdtempSync, rmSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { initJobSchema } from '../utils/jobQueue.js';
import {
  getItemForUser,
  listItemsForUser,
} from '../utils/itemRepository.js';

function withDb(fn) {
  const dir = mkdtempSync(join(tmpdir(), 'linkbox-item-repo-test-'));
  const db = new Database(join(dir, 'test.db'));
  try {
    db.exec(`
      CREATE TABLE links (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER NOT NULL,
        type TEXT DEFAULT 'link',
        url TEXT DEFAULT '',
        title TEXT DEFAULT '',
        description TEXT DEFAULT '',
        thumbnail TEXT DEFAULT '',
        comment TEXT DEFAULT '',
        content TEXT DEFAULT '',
        image_path TEXT DEFAULT '',
        imported_at TEXT DEFAULT '',
        created_at TEXT DEFAULT '',
        summary TEXT DEFAULT '',
        status TEXT DEFAULT '',
        content_md TEXT DEFAULT '',
        html_note TEXT DEFAULT ''
      );
      CREATE TABLE tags (
        id INTEGER PRIMARY KEY,
        user_id INTEGER NOT NULL,
        name TEXT NOT NULL,
        color TEXT DEFAULT '#6366f1'
      );
      CREATE TABLE link_tags (
        link_id INTEGER NOT NULL,
        tag_id INTEGER NOT NULL,
        PRIMARY KEY (link_id, tag_id)
      );
    `);
    initJobSchema(db);
    return fn(db);
  } finally {
    db.close();
    rmSync(dir, { recursive: true, force: true });
  }
}

function seed(db) {
  db.prepare(`
    INSERT INTO links (id, user_id, type, url, title, imported_at, status, content_md)
    VALUES
      (1, 5, 'link', 'https://a.example', 'A', '2026-06-09T00:00:00.000Z', 'processing', ''),
      (2, 5, 'file', '', 'B.pdf', '2026-06-10T00:00:00.000Z', 'done', 'content'),
      (3, 8, 'link', 'https://foreign.example', 'Foreign', '2026-06-11T00:00:00.000Z', 'done', '')
  `).run();
  db.prepare(`
    INSERT INTO tags (id, user_id, name, color)
    VALUES (10, 5, 'AI', '#111111'), (11, 5, 'Read', '#222222'), (12, 8, 'Other', '#333333')
  `).run();
  db.prepare(`
    INSERT INTO link_tags (link_id, tag_id)
    VALUES (1, 10), (2, 11), (3, 12)
  `).run();
  db.prepare(`
    INSERT INTO jobs (type, link_id, status, attempts, max_attempts, last_error, updated_at)
    VALUES ('link.fetchMetadata', 1, 'queued', 0, 3, '', '2026-06-10T00:00:01.000Z')
  `).run();
}

test('listItemsForUser returns owned items with tags and processing status', () => withDb((db) => {
  seed(db);

  const result = listItemsForUser(db, { userId: 5, query: { limit: '10' } });

  assert.equal(result.total, 2);
  assert.deepEqual(result.links.map(item => item.id), [2, 1]);
  assert.deepEqual(result.links[0].tags.map(tag => tag.name), ['Read']);
  assert.equal(result.links[0].has_content_md, 1);
  assert.equal(result.links[0].display.type, 'document');
  assert.equal(result.links[0].display.status, 'done');
  assert.equal(result.links[1].processing.state, 'queued');
  assert.equal(result.links[1].display.status, 'queued');
  assert.equal(result.links[1].processing.label, '抓取网页信息');
}));

test('getItemForUser enforces ownership and attaches processing status', () => withDb((db) => {
  seed(db);

  const owned = getItemForUser(db, { linkId: 1, userId: 5 });
  const foreign = getItemForUser(db, { linkId: 3, userId: 5 });

  assert.equal(owned.id, 1);
  assert.deepEqual(owned.tags.map(tag => tag.name), ['AI']);
  assert.equal(owned.processing.state, 'queued');
  assert.equal(owned.display.canRetry, false);
  assert.equal(foreign, null);
}));
