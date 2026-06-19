import test from 'node:test';
import assert from 'node:assert/strict';
import Database from 'better-sqlite3';
import { mkdtempSync, rmSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { runMigrations } from '../utils/dbMigrations.js';

function withDb(fn) {
  const dir = mkdtempSync(join(tmpdir(), 'linkbox-db-migrations-test-'));
  const db = new Database(join(dir, 'test.db'));
  try {
    return fn(db);
  } finally {
    db.close();
    rmSync(dir, { recursive: true, force: true });
  }
}

function columnNames(db, table) {
  return db.prepare(`PRAGMA table_info(${table})`).all().map(column => column.name);
}

function indexNames(db, table) {
  return db.prepare(`PRAGMA index_list(${table})`).all().map(index => index.name).sort();
}

function createLegacyLinksTable(db) {
  db.exec(`
    CREATE TABLE links (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      url TEXT DEFAULT '',
      title TEXT DEFAULT '',
      description TEXT DEFAULT '',
      thumbnail TEXT DEFAULT '',
      comment TEXT DEFAULT '',
      imported_at TEXT DEFAULT (datetime('now')),
      created_at TEXT DEFAULT (datetime('now'))
    );
  `);
}

test('runMigrations adds missing item columns to legacy links tables', () => withDb((db) => {
  createLegacyLinksTable(db);

  const result = runMigrations(db);

  assert.equal(result.applied, 5);
  assert.deepEqual(result.names, [
    '001_links_item_columns',
    '002_links_batch_columns',
    '003_jobs_schema',
    '004_document_schema',
    '005_item_content_schema',
  ]);
  assert.deepEqual(columnNames(db, 'links'), [
    'id',
    'user_id',
    'url',
    'title',
    'description',
    'thumbnail',
    'comment',
    'imported_at',
    'created_at',
    'type',
    'content',
    'image_path',
    'summary',
    'html_note',
    'content_md',
    'status',
    'batch_id',
    'batch_index',
  ]);
  const row = db.prepare(`
    SELECT name FROM schema_migrations WHERE name = '001_links_item_columns'
  `).get();
  assert.equal(row.name, '001_links_item_columns');
}));

test('runMigrations is idempotent once migrations are recorded', () => withDb((db) => {
  createLegacyLinksTable(db);

  const first = runMigrations(db);
  const second = runMigrations(db);

  assert.equal(first.applied, 5);
  assert.equal(second.applied, 0);
  assert.deepEqual(second.names, []);
  assert.equal(db.prepare('SELECT COUNT(*) AS count FROM schema_migrations').get().count, 5);
}));

test('runMigrations creates jobs table and indexes for legacy databases', () => withDb((db) => {
  createLegacyLinksTable(db);

  const result = runMigrations(db);

  assert.deepEqual(result.names, [
    '001_links_item_columns',
    '002_links_batch_columns',
    '003_jobs_schema',
    '004_document_schema',
    '005_item_content_schema',
  ]);
  assert.deepEqual(columnNames(db, 'jobs'), [
    'id',
    'type',
    'link_id',
    'payload',
    'status',
    'attempts',
    'max_attempts',
    'next_run_at',
    'locked_at',
    'last_error',
    'created_at',
    'updated_at',
    'completed_at',
  ]);
  assert.deepEqual(indexNames(db, 'jobs'), [
    'idx_jobs_link',
    'idx_jobs_status_next_run',
  ]);
  assert.equal(
    db.prepare("SELECT COUNT(*) AS count FROM schema_migrations WHERE name = '003_jobs_schema'").get().count,
    1,
  );
}));

test('runMigrations creates document tables and indexes for legacy databases', () => withDb((db) => {
  createLegacyLinksTable(db);

  const result = runMigrations(db);

  assert.deepEqual(result.names, [
    '001_links_item_columns',
    '002_links_batch_columns',
    '003_jobs_schema',
    '004_document_schema',
    '005_item_content_schema',
  ]);
  assert.deepEqual(columnNames(db, 'documents'), [
    'id',
    'item_id',
    'user_id',
    'title',
    'markdown',
    'markdown_hash',
    'parser_version',
    'language',
    'status',
    'created_at',
    'updated_at',
  ]);
  assert.deepEqual(columnNames(db, 'document_chunks'), [
    'id',
    'document_id',
    'chunk_index',
    'heading_path',
    'chunk_type',
    'content',
    'content_hash',
    'token_count',
    'char_start',
    'char_end',
    'metadata_json',
  ]);
  assert.deepEqual(columnNames(db, 'document_embeddings'), [
    'id',
    'chunk_id',
    'provider',
    'model',
    'dimension',
    'vector',
    'content_hash',
    'created_at',
  ]);
  assert.deepEqual(columnNames(db, 'document_annotations'), [
    'id',
    'document_id',
    'type',
    'content_json',
    'model',
    'created_at',
  ]);
  assert.deepEqual(indexNames(db, 'documents'), [
    'idx_documents_item',
    'idx_documents_user',
    'sqlite_autoindex_documents_1',
  ]);
  assert.deepEqual(indexNames(db, 'document_chunks'), [
    'idx_document_chunks_document',
    'sqlite_autoindex_document_chunks_1',
  ]);
  assert.deepEqual(indexNames(db, 'document_embeddings'), [
    'idx_document_embeddings_chunk',
    'idx_document_embeddings_model',
    'sqlite_autoindex_document_embeddings_1',
  ]);
  assert.deepEqual(indexNames(db, 'document_annotations'), [
    'idx_document_annotations_document',
  ]);
  assert.equal(
    db.prepare("SELECT COUNT(*) AS count FROM schema_migrations WHERE name = '004_document_schema'").get().count,
    1,
  );
}));

test('runMigrations creates item_content and backfills content-bearing legacy rows', () => withDb((db) => {
  createLegacyLinksTable(db);
  db.exec(`
    ALTER TABLE links ADD COLUMN content TEXT DEFAULT '';
    ALTER TABLE links ADD COLUMN content_md TEXT DEFAULT '';
    ALTER TABLE links ADD COLUMN summary TEXT DEFAULT '';
    ALTER TABLE links ADD COLUMN html_note TEXT DEFAULT '';
  `);
  db.prepare(`
    INSERT INTO links (id, user_id, title, content, content_md, summary, html_note)
    VALUES
      (1, 7, 'Text note', 'Plain text', '', 'Short summary', ''),
      (2, 7, 'Markdown note', '', '# Extracted\n\nBody', '', '<article>Raw</article>'),
      (3, 7, 'Empty note', '', '', '', '')
  `).run();

  const result = runMigrations(db);

  assert.deepEqual(result.names, [
    '001_links_item_columns',
    '002_links_batch_columns',
    '003_jobs_schema',
    '004_document_schema',
    '005_item_content_schema',
  ]);
  assert.deepEqual(columnNames(db, 'item_content'), [
    'item_id',
    'user_id',
    'text_content',
    'extracted_markdown',
    'summary',
    'html_note',
    'content_hash',
    'updated_at',
  ]);
  assert.deepEqual(indexNames(db, 'item_content'), [
    'idx_item_content_user',
  ]);

  const rows = db.prepare('SELECT * FROM item_content ORDER BY item_id').all();
  assert.equal(rows.length, 2);
  assert.deepEqual(
    rows.map(row => ({
      item_id: row.item_id,
      user_id: row.user_id,
      text_content: row.text_content,
      extracted_markdown: row.extracted_markdown,
      summary: row.summary,
      html_note: row.html_note,
    })),
    [
      {
        item_id: 1,
        user_id: 7,
        text_content: 'Plain text',
        extracted_markdown: '',
        summary: 'Short summary',
        html_note: '',
      },
      {
        item_id: 2,
        user_id: 7,
        text_content: '',
        extracted_markdown: '# Extracted\n\nBody',
        summary: '',
        html_note: '<article>Raw</article>',
      },
    ],
  );
  assert.match(rows[0].content_hash, /^[a-f0-9]{64}$/);
  assert.notEqual(rows[0].content_hash, rows[1].content_hash);
  assert.equal(
    db.prepare("SELECT COUNT(*) AS count FROM schema_migrations WHERE name = '005_item_content_schema'").get().count,
    1,
  );

  const second = runMigrations(db);
  assert.equal(second.applied, 0);
  assert.equal(db.prepare('SELECT COUNT(*) AS count FROM item_content').get().count, 2);
}));
