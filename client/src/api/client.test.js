import assert from 'node:assert/strict';
import { test } from 'node:test';
import { api } from './client.ts';

test('getRetrievalDiagnostics posts the query, task, and scope to the diagnostics endpoint', async () => {
  const originalFetch = globalThis.fetch;
  const originalLocalStorage = globalThis.localStorage;
  const calls = [];
  const responseBody = {
    query: 'vector db',
    task: 'ask',
    scope: 'all',
    settings: { maxSources: 8 },
    sources: [
      {
        sourceKind: 'document_chunk',
        title: 'Vector notes',
        score: 0.91,
        retrieval_modes: ['embedding'],
        heading_path: 'Notes > Retrieval',
        snippet: 'Vector search finds semantically similar chunks.',
      },
    ],
  };

  globalThis.localStorage = {
    getItem(key) {
      assert.equal(key, 'linkbox_token');
      return 'test-token';
    },
  };
  globalThis.fetch = async (url, options) => {
    calls.push({ url, options });
    return {
      ok: true,
      json: async () => responseBody,
    };
  };

  try {
    const result = await api.getRetrievalDiagnostics({
      question: 'vector db',
      task: 'ask',
      scope: 'all',
    });

    assert.deepEqual(result, responseBody);
    assert.equal(calls.length, 1);
    assert.equal(calls[0].url, '/api/assistant/retrieval-diagnostics');
    assert.equal(calls[0].options.method, 'POST');
    assert.equal(calls[0].options.headers.Authorization, 'Bearer test-token');
    assert.equal(
      calls[0].options.body,
      JSON.stringify({ question: 'vector db', task: 'ask', scope: 'all' }),
    );
  } finally {
    globalThis.fetch = originalFetch;
    globalThis.localStorage = originalLocalStorage;
  }
});
