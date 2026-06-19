import test from 'node:test';
import assert from 'node:assert/strict';
import Database from 'better-sqlite3';
import { mkdtempSync, rmSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import {
  attachItemContent,
  getItemContent,
  initItemContentSchema,
} from '../utils/itemContentStore.js';

function withDb(fn) {
  const dir = mkdtempSync(join(tmpdir(), 'linkbox-item-content-store-test-'));
  const db = new Database(join(dir, 'test.db'));
  try {
    db.exec(`
      CREATE TABLE links (
        id INTEGER PRIMARY KEY,
        user_id INTEGER NOT NULL,
        content TEXT DEFAULT '',
        content_md TEXT DEFAULT '',
        summary TEXT DEFAULT '',
        html_note TEXT DEFAULT ''
      );
    `);
    initItemContentSchema(db);
    return fn(db);
  } finally {
    db.close();
    rmSync(dir, { recursive: true, force: true });
  }
}

test('getItemContent prefers item_content rows over legacy links columns', () => withDb((db) => {
  db.prepare(`
    INSERT INTO links (id, user_id, content, content_md, summary, html_note)
    VALUES (1, 5, 'legacy text', '# legacy', 'legacy summary', '<p>legacy</p>')
  `).run();
  db.prepare(`
    INSERT INTO item_content (item_id, user_id, text_content, extracted_markdown, summary, html_note, content_hash)
    VALUES (1, 5, 'stored text', '# stored', 'stored summary', '<p>stored</p>', 'hash')
  `).run();

  const content = getItemContent(db, 1);

  assert.deepEqual(content, {
    item_id: 1,
    user_id: 5,
    text_content: 'stored text',
    extracted_markdown: '# stored',
    summary: 'stored summary',
    html_note: '<p>stored</p>',
    content_hash: 'hash',
    source: 'item_content',
  });
}));

test('getItemContent falls back to legacy links columns when item_content is missing', () => withDb((db) => {
  db.prepare(`
    INSERT INTO links (id, user_id, content, content_md, summary, html_note)
    VALUES (2, 5, 'legacy text', '# legacy', 'legacy summary', '<p>legacy</p>')
  `).run();

  const content = getItemContent(db, 2);

  assert.equal(content.item_id, 2);
  assert.equal(content.user_id, 5);
  assert.equal(content.text_content, 'legacy text');
  assert.equal(content.extracted_markdown, '# legacy');
  assert.equal(content.summary, 'legacy summary');
  assert.equal(content.html_note, '<p>legacy</p>');
  assert.match(content.content_hash, /^[a-f0-9]{64}$/);
  assert.equal(content.source, 'links');
}));

test('attachItemContent maps canonical content fields back onto an item shape', () => withDb((db) => {
  db.prepare(`
    INSERT INTO links (id, user_id, content, content_md, summary, html_note)
    VALUES (3, 5, 'legacy text', '# legacy', 'legacy summary', '<p>legacy</p>')
  `).run();
  const item = {
    id: 3,
    user_id: 5,
    content: '',
    content_md: '',
    summary: '',
    html_note: '',
  };

  const attached = attachItemContent(db, item);

  assert.deepEqual(attached, {
    id: 3,
    user_id: 5,
    content: 'legacy text',
    content_md: '# legacy',
    summary: 'legacy summary',
    html_note: '<p>legacy</p>',
    item_content: {
      item_id: 3,
      user_id: 5,
      text_content: 'legacy text',
      extracted_markdown: '# legacy',
      summary: 'legacy summary',
      html_note: '<p>legacy</p>',
      content_hash: attached.item_content.content_hash,
      source: 'links',
    },
  });
}));
