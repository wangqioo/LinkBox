import test from 'node:test';
import assert from 'node:assert/strict';
import Database from 'better-sqlite3';
import { mkdtempSync, rmSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { initJobSchema } from '../utils/jobQueue.js';
import {
  deleteLinkItem,
  updateLinkItem,
} from '../utils/linkMutationService.js';

function withDb(fn) {
  const dir = mkdtempSync(join(tmpdir(), 'linkbox-mutation-test-'));
  const db = new Database(join(dir, 'test.db'));
  try {
    db.exec(`
      CREATE TABLE links (
        id INTEGER PRIMARY KEY,
        user_id INTEGER NOT NULL,
        type TEXT DEFAULT 'link',
        url TEXT DEFAULT '',
        title TEXT DEFAULT '',
        comment TEXT DEFAULT '',
        content TEXT DEFAULT '',
        imported_at TEXT DEFAULT '',
        status TEXT DEFAULT ''
      );
      CREATE TABLE tags (id INTEGER PRIMARY KEY, user_id INTEGER NOT NULL, name TEXT NOT NULL);
      CREATE TABLE link_tags (link_id INTEGER NOT NULL, tag_id INTEGER NOT NULL, PRIMARY KEY (link_id, tag_id));
    `);
    initJobSchema(db);
    db.prepare("INSERT INTO links (id, user_id, type, url, title, comment, content, imported_at, status) VALUES (1, 5, 'link', 'https://example.com', 'Old', 'c', 'body', '2026-01-01', 'processing'), (2, 6, 'link', 'https://other.example', 'Other', '', '', '', 'done')").run();
    db.prepare("INSERT INTO tags (id, user_id, name) VALUES (10, 5, 'AI'), (11, 5, 'Read')").run();
    db.prepare("INSERT INTO link_tags (link_id, tag_id) VALUES (1, 10)").run();
    db.prepare(`
      INSERT INTO jobs (type, link_id, status, attempts, max_attempts, last_error, updated_at)
      VALUES ('link.fetchMetadata', 1, 'queued', 0, 3, '', '2026-06-10T00:00:01.000Z')
    `).run();
    return fn(db);
  } finally {
    db.close();
    rmSync(dir, { recursive: true, force: true });
  }
}

test('updateLinkItem updates provided fields and replaces tags', () => withDb((db) => {
  const result = updateLinkItem(db, {
    linkId: 1,
    userId: 5,
    title: 'New',
    comment: undefined,
    content: 'updated',
    importedAt: '2026-02-02',
    tagIds: [11],
  });

  assert.equal(result.link.title, 'New');
  assert.equal(result.link.comment, 'c');
  assert.equal(result.link.content, 'updated');
  assert.equal(result.link.imported_at, '2026-02-02');
  assert.equal(result.link.processing.state, 'queued');
  assert.equal(result.link.processing.label, '抓取网页信息');
  assert.equal(result.link.display.status, 'queued');
  assert.deepEqual(result.link.tags.map(tag => tag.name), ['Read']);
}));

test('updateLinkItem leaves tags unchanged when tagIds is omitted', () => withDb((db) => {
  const result = updateLinkItem(db, {
    linkId: 1,
    userId: 5,
    title: 'New',
  });

  assert.deepEqual(result.link.tags.map(tag => tag.name), ['AI']);
}));

test('updateLinkItem and deleteLinkItem reject missing or foreign links', () => withDb((db) => {
  assert.throws(
    () => updateLinkItem(db, { linkId: 404, userId: 5 }),
    error => error.status === 404 && error.message === '不存在',
  );
  assert.throws(
    () => deleteLinkItem(db, { linkId: 2, userId: 5 }),
    error => error.status === 404 && error.message === '不存在',
  );
}));

test('deleteLinkItem deletes owned links', () => withDb((db) => {
  assert.deepEqual(deleteLinkItem(db, { linkId: 1, userId: 5 }), { ok: true });
  assert.equal(db.prepare('SELECT COUNT(*) AS count FROM links WHERE id = 1').get().count, 0);
}));
