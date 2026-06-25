import test from 'node:test';
import assert from 'node:assert/strict';
import Database from 'better-sqlite3';
import { initDocumentSchema } from '../utils/documentIndex.js';
import {
  buildUnderstandingAnnotationPrompt,
  LLM_UNDERSTANDING_ANNOTATION_TYPE,
  LLM_UNDERSTANDING_PROMPT_VERSION,
  parseUnderstandingAnnotationJson,
  storeUnderstandingAnnotation,
} from '../utils/llmUnderstandingAnnotations.js';

function withDb(fn) {
  const db = new Database(':memory:');
  try {
    db.exec(`
      CREATE TABLE links (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER NOT NULL,
        title TEXT DEFAULT ''
      );
    `);
    initDocumentSchema(db);
    db.prepare(`
      INSERT INTO links (id, user_id, title) VALUES (1, 1, 'Agent Plan')
    `).run();
    db.prepare(`
      INSERT INTO documents (id, item_id, user_id, title, markdown, markdown_hash, parser_version)
      VALUES (7, 1, 1, 'Agent Plan', '# Agent Plan', 'hash', 'test')
    `).run();
    return fn(db);
  } finally {
    db.close();
  }
}

test('buildUnderstandingAnnotationPrompt requests strict JSON with source text', () => {
  const prompt = buildUnderstandingAnnotationPrompt({
    title: 'Agent Plan',
    markdown: '# Agent Plan\n\nTODO: add evals',
  });

  assert.match(prompt, new RegExp(LLM_UNDERSTANDING_PROMPT_VERSION));
  assert.match(prompt, /Return only valid JSON/);
  assert.match(prompt, /questions, contradictions, timeline, project_summary/);
  assert.match(prompt, /TODO: add evals/);
});

test('parseUnderstandingAnnotationJson normalizes optional rich understanding fields', () => {
  const parsed = parseUnderstandingAnnotationJson(JSON.stringify({
    questions: ['What is blocked?', '', 42],
    contradictions: ['Maybe stale'],
    timeline: [
      { date: '2026-06-25', event: 'Added agent', evidence: 'commit note' },
      { event: '' },
    ],
    project_summary: 'Agent work is underway.',
  }));

  assert.deepEqual(parsed, {
    questions: ['What is blocked?', '42'],
    contradictions: ['Maybe stale'],
    timeline: [
      { date: '2026-06-25', event: 'Added agent', evidence: 'commit note' },
    ],
    project_summary: 'Agent work is underway.',
  });
});

test('storeUnderstandingAnnotation stores LLM output separately from deterministic understanding', () => withDb((db) => {
  const stored = storeUnderstandingAnnotation(db, {
    documentId: 7,
    markdown: '# Agent Plan\n\nTODO: add evals',
    model: 'test-model',
    annotation: {
      questions: ['What should be evaluated?'],
      contradictions: [],
      timeline: [{ date: '2026-06-25', event: 'Created eval plan', evidence: 'TODO' }],
      project_summary: 'Evaluation planning note.',
    },
  });

  assert.equal(stored.type, LLM_UNDERSTANDING_ANNOTATION_TYPE);
  const row = db.prepare('SELECT document_id, type, content_json, model FROM document_annotations').get();
  const payload = JSON.parse(row.content_json);
  assert.equal(row.document_id, 7);
  assert.equal(row.type, LLM_UNDERSTANDING_ANNOTATION_TYPE);
  assert.equal(row.model, 'test-model');
  assert.equal(payload.prompt_version, LLM_UNDERSTANDING_PROMPT_VERSION);
  assert.match(payload.source_hash, /^[a-f0-9]{64}$/);
  assert.deepEqual(payload.annotation.questions, ['What should be evaluated?']);
}));
