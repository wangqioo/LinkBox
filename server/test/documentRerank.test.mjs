import test from 'node:test';
import assert from 'node:assert/strict';
import { rerankDocumentCandidates } from '../utils/documentRerank.js';

test('rerankDocumentCandidates promotes heading and exact phrase matches', () => {
  const candidates = [
    {
      id: 1,
      title: 'General Notes',
      heading_path: 'General Notes > Misc',
      chunk_text: 'retrieval appears once in a long unrelated paragraph',
      combined_score: 100,
      retrieval_modes: ['embedding'],
      imported_at: '2026-06-11T00:00:00.000Z',
    },
    {
      id: 2,
      title: 'Knowledge Base',
      heading_path: 'Knowledge Base > Retrieval Strategy',
      chunk_text: 'Hybrid retrieval strategy uses document chunks and citations.',
      combined_score: 20,
      retrieval_modes: ['keyword', 'embedding'],
      imported_at: '2026-06-10T00:00:00.000Z',
    },
  ];

  const results = rerankDocumentCandidates(candidates, {
    query: 'retrieval strategy',
    limit: 2,
  });

  assert.equal(results[0].id, 2);
  assert.equal(results[0].rerank_mode, 'local');
  assert.ok(results[0].rerank_score > results[1].rerank_score);
  assert.deepEqual(results[0].retrieval_modes, ['keyword', 'embedding']);
});

test('rerankDocumentCandidates preserves stable source order when scores tie', () => {
  const candidates = [
    { id: 1, title: 'A', chunk_text: 'same query', combined_score: 10, imported_at: '2026-06-10T00:00:00.000Z' },
    { id: 2, title: 'B', chunk_text: 'same query', combined_score: 10, imported_at: '2026-06-11T00:00:00.000Z' },
  ];

  const results = rerankDocumentCandidates(candidates, { query: 'same query', limit: 2 });

  assert.deepEqual(results.map(item => item.id), [2, 1]);
});
