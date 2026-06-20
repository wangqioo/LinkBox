import test from 'node:test';
import assert from 'node:assert/strict';
import Database from 'better-sqlite3';
import { mkdtempSync, rmSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { indexLinkContent, rankChunkRows, scoreChunkForQuery, scoreTextFields, splitIntoChunks, tokenizeQuery } from '../utils/chunkIndex.js';

test('splitIntoChunks preserves short paragraphs as one chunk', () => {
  const chunks = splitIntoChunks('第一段\n\n第二段');
  assert.deepEqual(chunks, ['第一段\n\n第二段']);
});

test('splitIntoChunks caps very long content', () => {
  const chunks = splitIntoChunks('x'.repeat(120000));
  assert.equal(chunks.length, 80);
  assert.ok(chunks.every(chunk => chunk.length <= 1200));
});

test('tokenizeQuery extracts latin and Chinese tokens', () => {
  const tokens = tokenizeQuery('LinkBox AI 知识库测试');
  assert.ok(tokens.includes('linkbox'));
  assert.ok(tokens.includes('ai'));
  assert.ok(tokens.includes('知识'));
});

test('tokenizeQuery keeps useful Chinese bigrams from longer phrases', () => {
  const tokens = tokenizeQuery('本地知识库检索质量优化');
  assert.ok(tokens.includes('本地'));
  assert.ok(tokens.includes('知识库'));
  assert.ok(tokens.includes('检索'));
  assert.ok(tokens.includes('质量'));
  assert.ok(tokens.includes('优化'));
});

test('scoreChunkForQuery prefers title matches over chunk-only matches', () => {
  const titleMatch = scoreChunkForQuery({
    title: '知识库检索优化方案',
    summary: '',
    chunk_text: '这是一段普通说明',
  }, '知识库检索');
  const bodyMatch = scoreChunkForQuery({
    title: '普通资料',
    summary: '',
    chunk_text: '这篇文章反复讨论知识库检索和知识库检索',
  }, '知识库检索');

  assert.ok(titleMatch > bodyMatch);
});

test('rankChunkRows ranks title-relevant chunks first', () => {
  const rows = [
    {
      id: 1,
      title: '普通资料',
      summary: '',
      chunk_text: '这篇正文多次提到知识库检索和知识库检索。',
      imported_at: '2026-01-01T00:00:00.000Z',
    },
    {
      id: 2,
      title: '知识库检索优化方案',
      summary: '',
      chunk_text: '这是一段普通介绍。',
      imported_at: '2026-01-02T00:00:00.000Z',
    },
  ];

  const results = rankChunkRows(rows, { query: '知识库检索', limit: 2 });

  assert.equal(results[0].id, 2);
});

test('scoreTextFields applies field weights consistently', () => {
  const titleScore = scoreTextFields(
    { title: '本地知识库检索', content: '' },
    '知识库检索',
    { title: 8, content: 1 },
  );
  const contentScore = scoreTextFields(
    { title: '', content: '正文提到知识库检索知识库检索' },
    '知识库检索',
    { title: 8, content: 1 },
  );

  assert.ok(titleScore > contentScore);
});

test('indexLinkContent includes user comments in legacy chunks', () => {
  const dir = mkdtempSync(join(tmpdir(), 'linkbox-chunk-index-test-'));
  const db = new Database(join(dir, 'test.db'));
  try {
    db.exec(`
      CREATE TABLE links (
        id INTEGER PRIMARY KEY,
        user_id INTEGER NOT NULL,
        title TEXT DEFAULT '',
        summary TEXT DEFAULT '',
        comment TEXT DEFAULT '',
        content TEXT DEFAULT '',
        content_md TEXT DEFAULT ''
      );
      CREATE TABLE link_chunks (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        link_id INTEGER NOT NULL,
        user_id INTEGER NOT NULL,
        chunk_index INTEGER NOT NULL,
        text TEXT NOT NULL
      );
    `);
    db.prepare(`
      INSERT INTO links (id, user_id, title, summary, comment, content_md)
      VALUES (1, 5, '图片资料', '图片摘要', '我的留言很重要', '图片正文')
    `).run();

    indexLinkContent(1, db);

    const chunk = db.prepare('SELECT text FROM link_chunks WHERE link_id = 1').get();
    assert.match(chunk.text, /我的留言：我的留言很重要/);
  } finally {
    db.close();
    rmSync(dir, { recursive: true, force: true });
  }
});
