import test from 'node:test';
import assert from 'node:assert/strict';
import Database from 'better-sqlite3';
import { mkdtempSync, rmSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { runMigrations } from '../utils/dbMigrations.js';

const EXPECTED_MIGRATIONS = [
  '000_base_schema',
  '001_links_item_columns',
  '002_links_batch_columns',
  '003_jobs_schema',
  '004_document_schema',
  '005_item_content_schema',
  '006_item_assets_schema',
  '007_direct_messages_schema',
  '008_link_scope',
  '009_assistant_conversations',
  '010_social_collaboration_schema',
  '011_settings_and_legacy_chunks_schema',
  '012_assistant_runs_schema',
  '013_assistant_message_agent_metadata',
  '014_item_understanding_schema',
  '015_assistant_memory_schema',
  '016_local_agent_factory_schema',
];

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

  assert.equal(result.applied, EXPECTED_MIGRATIONS.length);
  assert.deepEqual(result.names, EXPECTED_MIGRATIONS);
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
    'scope',
  ]);
  const row = db.prepare(`
    SELECT name FROM schema_migrations WHERE name = '001_links_item_columns'
  `).get();
  assert.equal(row.name, '001_links_item_columns');
}));

test('runMigrations creates the complete base schema for empty databases', () => withDb((db) => {
  const result = runMigrations(db);

  assert.equal(result.applied, EXPECTED_MIGRATIONS.length);
  assert.deepEqual(result.names, EXPECTED_MIGRATIONS);
  assert.deepEqual(columnNames(db, 'users'), [
    'id',
    'username',
    'password_hash',
    'created_at',
  ]);
  assert.deepEqual(columnNames(db, 'links'), [
    'id',
    'user_id',
    'type',
    'url',
    'title',
    'description',
    'thumbnail',
    'comment',
    'content',
    'image_path',
    'imported_at',
    'created_at',
    'summary',
    'html_note',
    'content_md',
    'status',
    'batch_id',
    'batch_index',
    'scope',
  ]);
  assert.deepEqual(columnNames(db, 'tags'), [
    'id',
    'user_id',
    'name',
    'color',
    'created_at',
  ]);
  assert.deepEqual(columnNames(db, 'link_tags'), [
    'link_id',
    'tag_id',
  ]);
  assert.deepEqual(columnNames(db, 'settings'), [
    'key',
    'value',
  ]);
  assert.deepEqual(columnNames(db, 'link_chunks'), [
    'id',
    'link_id',
    'user_id',
    'chunk_index',
    'text',
    'created_at',
  ]);
  assert.equal(indexNames(db, 'links').includes('idx_links_user'), true);
  assert.equal(indexNames(db, 'links').includes('idx_links_imported'), true);
  assert.equal(indexNames(db, 'tags').includes('idx_tags_user'), true);
  assert.equal(indexNames(db, 'link_chunks').includes('idx_link_chunks_link'), true);
  assert.equal(indexNames(db, 'link_chunks').includes('idx_link_chunks_user'), true);
}));

test('runMigrations is idempotent once migrations are recorded', () => withDb((db) => {
  createLegacyLinksTable(db);

  const first = runMigrations(db);
  const second = runMigrations(db);

  assert.equal(first.applied, EXPECTED_MIGRATIONS.length);
  assert.equal(second.applied, 0);
  assert.deepEqual(second.names, []);
  assert.equal(db.prepare('SELECT COUNT(*) AS count FROM schema_migrations').get().count, EXPECTED_MIGRATIONS.length);
}));

test('runMigrations creates jobs table and indexes for legacy databases', () => withDb((db) => {
  createLegacyLinksTable(db);

  const result = runMigrations(db);

  assert.deepEqual(result.names, EXPECTED_MIGRATIONS);
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

test('runMigrations creates direct message table and indexes for legacy databases', () => withDb((db) => {
  createLegacyLinksTable(db);

  const result = runMigrations(db);

  assert.equal(result.names.includes('007_direct_messages_schema'), true);
  assert.deepEqual(columnNames(db, 'direct_messages'), [
    'id',
    'sender_id',
    'recipient_id',
    'body',
    'message_type',
    'created_at',
  ]);
  assert.equal(indexNames(db, 'direct_messages').includes('idx_direct_messages_pair'), true);
}));

test('runMigrations creates assistant conversation history tables', () => withDb((db) => {
  createLegacyLinksTable(db);

  const result = runMigrations(db);

  assert.equal(result.names.includes('009_assistant_conversations'), true);
  assert.deepEqual(columnNames(db, 'assistant_conversations'), [
    'id',
    'user_id',
    'scope_type',
    'group_id',
    'title',
    'created_at',
    'updated_at',
  ]);
  assert.deepEqual(columnNames(db, 'assistant_messages'), [
    'id',
    'conversation_id',
    'role',
    'content',
    'task',
    'sources_json',
    'agent_json',
    'error',
    'created_at',
  ]);
  assert.equal(indexNames(db, 'assistant_conversations').includes('idx_assistant_conversations_user'), true);
  assert.equal(indexNames(db, 'assistant_conversations').includes('idx_assistant_conversations_group'), true);
  assert.equal(indexNames(db, 'assistant_messages').includes('idx_assistant_messages_conversation'), true);
}));

test('runMigrations creates assistant run observability tables', () => withDb((db) => {
  createLegacyLinksTable(db);

  const result = runMigrations(db);

  assert.equal(result.names.includes('012_assistant_runs_schema'), true);
  assert.deepEqual(columnNames(db, 'assistant_runs'), [
    'id',
    'user_id',
    'conversation_id',
    'scope_type',
    'group_id',
    'question',
    'task',
    'intent',
    'status',
    'plan_json',
    'evidence_json',
    'verification_json',
    'created_at',
    'completed_at',
  ]);
  assert.deepEqual(columnNames(db, 'assistant_run_steps'), [
    'id',
    'run_id',
    'step_index',
    'step_type',
    'label',
    'status',
    'metadata_json',
    'created_at',
  ]);
  assert.equal(indexNames(db, 'assistant_runs').includes('idx_assistant_runs_user'), true);
  assert.equal(indexNames(db, 'assistant_run_steps').includes('idx_assistant_run_steps_run'), true);
}));

test('runMigrations adds assistant message agent metadata to legacy conversation tables', () => withDb((db) => {
  createLegacyLinksTable(db);

  const result = runMigrations(db);

  assert.equal(result.names.includes('013_assistant_message_agent_metadata'), true);
  assert.equal(columnNames(db, 'assistant_messages').includes('agent_json'), true);
}));

test('runMigrations creates item understanding tables', () => withDb((db) => {
  createLegacyLinksTable(db);

  const result = runMigrations(db);

  assert.equal(result.names.includes('014_item_understanding_schema'), true);
  assert.deepEqual(columnNames(db, 'item_entities'), [
    'id',
    'item_id',
    'user_id',
    'name',
    'kind',
    'created_at',
  ]);
  assert.deepEqual(columnNames(db, 'item_topics'), [
    'id',
    'item_id',
    'user_id',
    'name',
    'weight',
    'created_at',
  ]);
  assert.deepEqual(columnNames(db, 'item_todos'), [
    'id',
    'item_id',
    'user_id',
    'text',
    'status',
    'created_at',
  ]);
  assert.deepEqual(columnNames(db, 'item_claims'), [
    'id',
    'item_id',
    'user_id',
    'text',
    'created_at',
  ]);
  assert.deepEqual(columnNames(db, 'item_understanding_runs'), [
    'item_id',
    'user_id',
    'entities_count',
    'topics_count',
    'todos_count',
    'claims_count',
    'updated_at',
  ]);
  assert.equal(indexNames(db, 'item_topics').includes('idx_item_topics_user_name'), true);
  assert.equal(indexNames(db, 'item_understanding_runs').includes('idx_item_understanding_runs_user'), true);
}));

test('runMigrations creates assistant memory table', () => withDb((db) => {
  createLegacyLinksTable(db);

  const result = runMigrations(db);

  assert.equal(result.names.includes('015_assistant_memory_schema'), true);
  assert.deepEqual(columnNames(db, 'assistant_memories'), [
    'id',
    'user_id',
    'scope_type',
    'group_id',
    'memory_type',
    'content',
    'source',
    'created_at',
    'updated_at',
  ]);
  assert.equal(indexNames(db, 'assistant_memories').includes('idx_assistant_memories_user'), true);
}));

test('runMigrations creates local Agent factory tables', () => withDb((db) => {
  createLegacyLinksTable(db);

  const result = runMigrations(db);

  assert.equal(result.names.includes('016_local_agent_factory_schema'), true);
  assert.deepEqual(columnNames(db, 'agent_runs'), [
    'id',
    'user_id',
    'run_type',
    'status',
    'plan_json',
    'summary_json',
    'started_at',
    'completed_at',
    'created_at',
  ]);
  assert.deepEqual(columnNames(db, 'agent_reports'), [
    'id',
    'user_id',
    'scope_type',
    'scope_id',
    'report_type',
    'content_json',
    'created_at',
  ]);
  assert.deepEqual(columnNames(db, 'agent_suggestions'), [
    'id',
    'user_id',
    'item_id',
    'suggestion_type',
    'status',
    'proposal_json',
    'reason',
    'confidence',
    'evidence_json',
    'created_at',
    'updated_at',
    'resolved_at',
  ]);
  assert.deepEqual(columnNames(db, 'agent_rules'), [
    'id',
    'user_id',
    'rule_type',
    'status',
    'title',
    'condition_json',
    'action_json',
    'source_suggestion_id',
    'created_at',
    'updated_at',
  ]);
  assert.deepEqual(columnNames(db, 'item_maturity_events'), [
    'id',
    'item_id',
    'user_id',
    'from_state',
    'to_state',
    'reason',
    'metadata_json',
    'created_at',
  ]);
  assert.deepEqual(columnNames(db, 'agent_timeline_events'), [
    'id',
    'user_id',
    'event_type',
    'title',
    'detail',
    'item_id',
    'metadata_json',
    'created_at',
  ]);
  assert.equal(indexNames(db, 'agent_suggestions').includes('idx_agent_suggestions_user_status'), true);
  assert.equal(indexNames(db, 'agent_rules').includes('idx_agent_rules_user_status'), true);
  assert.equal(indexNames(db, 'item_maturity_events').includes('idx_item_maturity_events_item'), true);
  assert.equal(indexNames(db, 'agent_timeline_events').includes('idx_agent_timeline_user'), true);
}));

test('runMigrations creates social collaboration tables and indexes', () => withDb((db) => {
  createLegacyLinksTable(db);

  const result = runMigrations(db);

  assert.equal(result.names.includes('010_social_collaboration_schema'), true);
  assert.deepEqual(columnNames(db, 'friendships'), [
    'id',
    'requester_id',
    'addressee_id',
    'status',
    'created_at',
    'updated_at',
  ]);
  assert.deepEqual(columnNames(db, 'groups'), [
    'id',
    'name',
    'description',
    'owner_id',
    'agent_name',
    'created_at',
    'updated_at',
  ]);
  assert.deepEqual(columnNames(db, 'group_members'), [
    'group_id',
    'user_id',
    'role',
    'joined_at',
  ]);
  assert.deepEqual(columnNames(db, 'group_messages'), [
    'id',
    'group_id',
    'user_id',
    'body',
    'message_type',
    'created_at',
  ]);
  assert.deepEqual(columnNames(db, 'group_links'), [
    'group_id',
    'link_id',
    'shared_by',
    'note',
    'created_at',
  ]);
  assert.equal(indexNames(db, 'friendships').includes('idx_friendships_requester'), true);
  assert.equal(indexNames(db, 'friendships').includes('idx_friendships_addressee'), true);
  assert.equal(indexNames(db, 'groups').includes('idx_groups_owner'), true);
  assert.equal(indexNames(db, 'group_members').includes('idx_group_members_user'), true);
  assert.equal(indexNames(db, 'group_messages').includes('idx_group_messages_group'), true);
  assert.equal(indexNames(db, 'group_links').includes('idx_group_links_group'), true);
  assert.equal(indexNames(db, 'group_links').includes('idx_group_links_link'), true);
}));

test('runMigrations creates document tables and indexes for legacy databases', () => withDb((db) => {
  createLegacyLinksTable(db);

  const result = runMigrations(db);

  assert.deepEqual(result.names, EXPECTED_MIGRATIONS);
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

  assert.deepEqual(result.names, EXPECTED_MIGRATIONS);
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

test('runMigrations creates item_assets and backfills owned upload paths', () => withDb((db) => {
  createLegacyLinksTable(db);
  db.exec(`
    ALTER TABLE links ADD COLUMN type TEXT DEFAULT 'link';
    ALTER TABLE links ADD COLUMN image_path TEXT DEFAULT '';
    ALTER TABLE links ADD COLUMN summary TEXT DEFAULT '';
    ALTER TABLE links ADD COLUMN html_note TEXT DEFAULT '';
    ALTER TABLE links ADD COLUMN content_md TEXT DEFAULT '';
  `);
  db.prepare(`
    INSERT INTO links (id, user_id, type, title, description, thumbnail, image_path)
    VALUES
      (1, 7, 'image', 'Photo', '', '/uploads/photo.png', '/uploads/photo.png'),
      (2, 7, 'file', 'Report', 'report.pdf (2 KB)', '', '/uploads/report.pdf'),
      (3, 7, 'link', 'Remote Link', '', 'https://example.test/og.png', ''),
      (4, 7, 'file', 'Slides', 'slides.pdf (1.5 MB)', '/uploads/slide-thumb.png', '/uploads/slides.pdf'),
      (5, 7, 'image', 'Remote Path', '', '', 'https://cdn.example/image.png')
  `).run();

  const result = runMigrations(db);

  assert.deepEqual(result.names, EXPECTED_MIGRATIONS);
  assert.deepEqual(columnNames(db, 'item_assets'), [
    'id',
    'item_id',
    'user_id',
    'kind',
    'public_path',
    'disk_path',
    'original_name',
    'mime_type',
    'size_bytes',
    'metadata_json',
    'created_at',
  ]);
  assert.deepEqual(indexNames(db, 'item_assets'), [
    'idx_item_assets_item',
    'idx_item_assets_user',
    'sqlite_autoindex_item_assets_1',
  ]);

  const rows = db.prepare(`
    SELECT item_id, user_id, kind, public_path, disk_path, original_name, mime_type, size_bytes, metadata_json
    FROM item_assets
    ORDER BY item_id, kind, public_path
  `).all();
  assert.deepEqual(rows, [
    {
      item_id: 1,
      user_id: 7,
      kind: 'image',
      public_path: '/uploads/photo.png',
      disk_path: '',
      original_name: 'photo.png',
      mime_type: '',
      size_bytes: 0,
      metadata_json: '{"source":"links.image_path"}',
    },
    {
      item_id: 2,
      user_id: 7,
      kind: 'file',
      public_path: '/uploads/report.pdf',
      disk_path: '',
      original_name: 'report.pdf',
      mime_type: '',
      size_bytes: 2048,
      metadata_json: '{"source":"links.image_path"}',
    },
    {
      item_id: 4,
      user_id: 7,
      kind: 'file',
      public_path: '/uploads/slides.pdf',
      disk_path: '',
      original_name: 'slides.pdf',
      mime_type: '',
      size_bytes: 1572864,
      metadata_json: '{"source":"links.image_path"}',
    },
    {
      item_id: 4,
      user_id: 7,
      kind: 'thumbnail',
      public_path: '/uploads/slide-thumb.png',
      disk_path: '',
      original_name: 'slide-thumb.png',
      mime_type: '',
      size_bytes: 0,
      metadata_json: '{"source":"links.thumbnail"}',
    },
  ]);
  assert.equal(
    db.prepare("SELECT COUNT(*) AS count FROM schema_migrations WHERE name = '006_item_assets_schema'").get().count,
    1,
  );

  const second = runMigrations(db);
  assert.equal(second.applied, 0);
  assert.equal(db.prepare('SELECT COUNT(*) AS count FROM item_assets').get().count, 4);
}));
