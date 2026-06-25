import test from 'node:test';
import assert from 'node:assert/strict';
import { verifyAssistantAnswer, verifyEvidence } from '../utils/assistantVerifier.js';

const evidence = {
  status: 'ready',
  items: [
    { citation: '[资料1]', snippet: 'Alpha evidence' },
    { citation: '[资料2]', snippet: 'Beta evidence' },
  ],
};

test('verifyEvidence reports insufficient support for empty evidence', () => {
  const result = verifyEvidence({ status: 'empty', items: [] });

  assert.equal(result.support, 'insufficient');
  assert.equal(result.evidenceCount, 0);
  assert.equal(result.issues.includes('no_evidence'), true);
});

test('verifyAssistantAnswer accepts answers with in-range citations', () => {
  const result = verifyAssistantAnswer({
    answer: '结论来自 Alpha。[资料1]',
    evidence,
    sourceCount: 2,
  });

  assert.equal(result.support, 'supported');
  assert.deepEqual(result.citations.used, [1]);
  assert.deepEqual(result.citations.invalid, []);
});

test('verifyAssistantAnswer marks out-of-range citations as partial', () => {
  const result = verifyAssistantAnswer({
    answer: '结论来自 Alpha。[资料3]',
    evidence,
    sourceCount: 2,
  });

  assert.equal(result.support, 'partial');
  assert.deepEqual(result.citations.invalid, [3]);
  assert.equal(result.issues.includes('citation_out_of_range'), true);
});

test('verifyAssistantAnswer marks uncited answers with evidence as partial', () => {
  const result = verifyAssistantAnswer({
    answer: '结论来自 Alpha。',
    evidence,
    sourceCount: 2,
  });

  assert.equal(result.support, 'partial');
  assert.equal(result.issues.includes('missing_citation'), true);
});
