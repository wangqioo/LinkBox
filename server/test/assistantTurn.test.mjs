import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildMessages,
  groupSources,
  normalizeCitationText,
  publicSources,
} from '../utils/assistantTurn.js';

test('groupSources dedupes URL and title variants while preserving chunks', () => {
  const sources = [
    {
      id: 101,
      type: 'link',
      url: 'https://example.com/post?utm_source=newsletter#intro',
      title: 'Hybrid Retrieval Notes',
      summary: 'first summary',
      imported_at: '2026-06-10T00:00:00.000Z',
      chunk_id: 'chunk-a',
      chunk_index: 0,
      chunk_text: 'first relevant chunk',
    },
    {
      id: 101,
      type: 'link',
      url: 'https://example.com/post',
      title: 'Hybrid Retrieval Notes',
      summary: 'first summary',
      imported_at: '2026-06-10T00:00:00.000Z',
      chunk_id: 'chunk-b',
      chunk_index: 1,
      chunk_text: 'second relevant chunk',
    },
    {
      id: 202,
      type: 'link',
      url: 'https://mirror.example/item',
      title: 'Hybrid Retrieval Notes',
      summary: 'duplicate title summary',
      imported_at: '2026-06-11T00:00:00.000Z',
      chunk_id: 'chunk-c',
      chunk_index: 0,
      chunk_text: 'title deduped chunk',
    },
    {
      id: 303,
      type: 'file',
      url: '',
      title: 'Short',
      content_md: '# Short\n\nbody',
      imported_at: '2026-06-12T00:00:00.000Z',
    },
  ];

  const grouped = groupSources(sources);

  assert.equal(grouped.length, 2);
  assert.deepEqual(grouped.map(source => source.source_index), [1, 2]);
  assert.deepEqual(grouped[0].chunks.map(chunk => chunk.chunk_id), ['chunk-a', 'chunk-b', 'chunk-c']);

  const shaped = publicSources(sources);
  assert.equal(shaped.length, 2);
  assert.equal(shaped[0].id, 101);
  assert.deepEqual(shaped[0].chunks.map(chunk => chunk.id), ['chunk-a', 'chunk-b', 'chunk-c']);
});

test('publicSources exposes compact retrieval metadata for source inspection', () => {
  const shaped = publicSources([
    {
      id: 101,
      type: 'file',
      title: 'Retrieval Debug Notes',
      imported_at: '2026-06-17T00:00:00.000Z',
      sourceKind: 'document',
      score: 9.5,
      combined_score: 12.25,
      embedding_score: 0.91,
      retrieval_modes: ['keyword', 'embedding'],
      rerank_mode: 'local',
      rerank_score: 0.83,
      document_id: 55,
      chunk_id: 77,
      chunk_index: 2,
      heading_path: 'Retrieval Debug Notes > Hybrid Search',
      chunk_type: 'section',
      chunk_text: 'hybrid search debug snippet',
    },
  ]);

  assert.deepEqual(shaped[0].retrieval, {
    sourceKind: 'document',
    score: 9.5,
    combined_score: 12.25,
    embedding_score: 0.91,
    retrieval_modes: ['keyword', 'embedding'],
    rerank_mode: 'local',
    rerank_score: 0.83,
  });
  assert.deepEqual(shaped[0].chunks[0].retrieval, {
    sourceKind: 'document',
    document_id: 55,
    chunk_id: 77,
    heading_path: 'Retrieval Debug Notes > Hybrid Search',
    chunk_type: 'section',
    score: 9.5,
    combined_score: 12.25,
    embedding_score: 0.91,
    retrieval_modes: ['keyword', 'embedding'],
    rerank_mode: 'local',
    rerank_score: 0.83,
  });
});

test('buildMessages trims context and lists only valid citation source ids', () => {
  const messages = buildMessages('怎么做检索？', [
    {
      id: 10,
      type: 'file',
      title: 'First Source',
      summary: 'summary',
      chunk_id: 'first-chunk',
      chunk_index: 0,
      chunk_text: 'alpha retrieval details '.repeat(20),
    },
    {
      id: 20,
      type: 'file',
      title: 'Second Source',
      chunk_id: 'second-chunk',
      chunk_index: 0,
      chunk_text: 'beta retrieval details '.repeat(20),
    },
  ], 'ask', {
    maxContextChars: 180,
    maxFieldChars: 120,
  });

  assert.equal(messages.length, 2);
  assert.match(messages[0].content, /引用只能使用这些编号：\[资料1\]、\[资料2\]/);
  assert.doesNotMatch(messages[0].content, /\[资料10\]|\[资料20\]/);
  assert.match(messages[1].content, /资料 1（ID: 10）/);
  assert.doesNotMatch(messages[1].content, /资料 2（ID: 20）/);
  assert.ok(messages[1].content.length < 260);
});

test('normalizeCitationText expands valid citation ranges and caps them to available sources', () => {
  const normalized = normalizeCitationText(
    '参考 [资料1-3]、[资料2-9]、[资料4-2]，还有半截 [资料2 和越界 [资料9。',
    4,
  );

  assert.equal(
    normalized,
    '参考 [资料1][资料2][资料3]、[资料2][资料3][资料4]、，还有半截 [资料2] 和越界 [资料9。',
  );
});

test('buildMessages includes assistant memories as low-priority context', () => {
  const messages = buildMessages('部署怎么做？', [
    {
      id: 10,
      type: 'file',
      title: 'Deploy Notes',
      chunk_text: 'deployment evidence',
    },
  ], 'ask', {
    memoryItems: [
      { memory_type: 'preference', content: '回答部署问题时先列风险' },
    ],
  });

  assert.match(messages[0].content, /低优先级用户偏好/);
  assert.match(messages[0].content, /先列风险/);
  assert.match(messages[0].content, /引用只能使用这些编号：\[资料1\]/);
});
