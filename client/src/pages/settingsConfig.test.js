import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  applyEmbeddingProviderPreset,
  DEFAULT_EMBEDDING_CONFIG,
} from './settingsConfig.ts';

test('applyEmbeddingProviderPreset applies local embedding defaults', () => {
  const config = {
    ...DEFAULT_EMBEDDING_CONFIG,
    provider: 'openai-compatible',
    baseUrl: 'https://embeddings.example.com/v1',
    model: 'remote-model',
  };

  assert.deepEqual(applyEmbeddingProviderPreset(config, 'local'), {
    ...config,
    provider: 'local',
    baseUrl: '',
    model: 'linkbox-local-hash-v1',
  });
});

test('applyEmbeddingProviderPreset keeps remote fields when selecting openai-compatible', () => {
  const config = {
    ...DEFAULT_EMBEDDING_CONFIG,
    baseUrl: 'https://embeddings.example.com/v1',
    model: 'remote-model',
  };

  assert.deepEqual(applyEmbeddingProviderPreset(config, 'openai-compatible'), {
    ...config,
    provider: 'openai-compatible',
  });
});
