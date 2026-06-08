import test from 'node:test';
import assert from 'node:assert/strict';
import Database from 'better-sqlite3';
import { mkdtempSync, rmSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import {
  exportAllData,
  exportSummariesMarkdown,
} from '../utils/linkExportService.js';

function withDb(fn) {
  const dir = mkdtempSync(join(tmpdir(), 'linkbox-export-test-'));
  const db = new Database(join(dir, 'test.db'));
  try {
    db.exec(`
      CREATE TABLE links (
        id INTEGER PRIMARY KEY,
        user_id INTEGER NOT NULL,
        title TEXT DEFAULT '',
        url TEXT DEFAULT '',
        summary TEXT DEFAULT '',
        imported_at TEXT DEFAULT ''
      );
      CREATE TABLE tags (id INTEGER PRIMARY KEY, user_id INTEGER NOT NULL, name TEXT NOT NULL);
      CREATE TABLE link_tags (link_id INTEGER NOT NULL, tag_id INTEGER NOT NULL);
    `);
    db.prepare("INSERT INTO links (id, user_id, title, url, summary, imported_at) VALUES (1, 5, 'A', 'https://a.example', 'Summary A', '2026-01-02T00:00:00.000Z')").run();
    db.prepare("INSERT INTO links (id, user_id, title, url, summary, imported_at) VALUES (2, 5, 'B', 'https://b.example', '', '2026-01-01T00:00:00.000Z')").run();
    db.prepare("INSERT INTO links (id, user_id, title, url, summary, imported_at) VALUES (3, 5, 'C', 'https://c.example', 'Summary C', '2026-01-03T00:00:00.000Z')").run();
    db.prepare("INSERT INTO links (id, user_id, title, url, summary, imported_at) VALUES (4, 6, 'Other', 'https://o.example', 'Other', '2026-01-04T00:00:00.000Z')").run();
    db.prepare("INSERT INTO tags (id, user_id, name) VALUES (10, 5, 'AI')").run();
    db.prepare("INSERT INTO link_tags (link_id, tag_id) VALUES (1, 10), (4, 10)").run();
    return fn(db);
  } finally {
    db.close();
    rmSync(dir, { recursive: true, force: true });
  }
}

test('exportSummariesMarkdown exports summarized links in imported order', () => withDb((db) => {
  const result = exportSummariesMarkdown(db, {
    userId: 5,
    today: '2026-06-09',
  });

  assert.equal(result.filename, 'linkbox-summaries-2026-06-09.md');
  assert.match(result.markdown, /^# LinkBox 摘要导出\n> 导出时间：2026-06-09/m);
  assert.match(result.markdown, /## 1\. C\n_2026-01-03_/);
  assert.match(result.markdown, /Summary C/);
  assert.match(result.markdown, /## 2\. A\n_2026-01-02_/);
  assert.doesNotMatch(result.markdown, /Summary B|Other/);
}));

test('exportSummariesMarkdown filters requested ids and ignores empty summaries', () => withDb((db) => {
  const result = exportSummariesMarkdown(db, {
    userId: 5,
    ids: [1, 2, 4],
    today: '2026-06-09',
  });

  assert.match(result.markdown, /Summary A/);
  assert.doesNotMatch(result.markdown, /Summary C|https:\/\/b\.example|Other/);
}));

test('exportAllData returns owned links tags and linkTags only', () => withDb((db) => {
  const result = exportAllData(db, {
    userId: 5,
    exportedAt: '2026-06-09T00:00:00.000Z',
  });

  assert.deepEqual(result.links.map(link => link.id), [3, 1, 2]);
  assert.deepEqual(result.tags.map(tag => tag.id), [10]);
  assert.deepEqual(result.linkTags, [{ link_id: 1, tag_id: 10 }]);
  assert.equal(result.exported_at, '2026-06-09T00:00:00.000Z');
}));
