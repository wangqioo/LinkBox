import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  applyEmbeddingProviderPreset,
  DEFAULT_EMBEDDING_CONFIG,
  normalizeAIPurposeConfigs,
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

test('normalizeAIPurposeConfigs uses purpose configs from settings payload', () => {
  const configs = normalizeAIPurposeConfigs({
    provider: 'custom',
    baseUrl: 'http://legacy.example/v1',
    model: 'legacy-model',
    visionModel: '',
    temperature: 0.3,
    enableThinking: false,
    apiKeyConfigured: false,
    purposes: {
      organize: {
        provider: 'custom',
        baseUrl: 'http://organize.example/v1',
        model: 'organize-model',
        visionModel: '',
        temperature: 0.1,
        enableThinking: false,
        apiKeyConfigured: false,
      },
      agent: {
        provider: 'zhipu',
        baseUrl: 'https://open.bigmodel.cn/api/paas/v4',
        model: 'glm-4-flash',
        visionModel: '',
        temperature: 0.2,
        enableThinking: false,
        apiKeyConfigured: true,
      },
      vision: {
        provider: 'custom',
        baseUrl: 'http://vision.example/v1',
        model: 'vision-model',
        visionModel: 'vision-model',
        temperature: 0,
        enableThinking: false,
        apiKeyConfigured: false,
      },
    },
  });

  assert.equal(configs.organize.model, 'organize-model');
  assert.equal(configs.agent.model, 'glm-4-flash');
  assert.equal(configs.vision.baseUrl, 'http://vision.example/v1');
  assert.equal(configs.agent.apiKey, '');
});

test('normalizeAIPurposeConfigs falls back to legacy single AI config', () => {
  const configs = normalizeAIPurposeConfigs({
    provider: 'custom',
    baseUrl: 'http://legacy.example/v1',
    model: 'legacy-model',
    visionModel: 'legacy-vision',
    temperature: 0.3,
    enableThinking: true,
    apiKeyConfigured: true,
  });

  assert.equal(configs.organize.model, 'legacy-model');
  assert.equal(configs.agent.model, 'legacy-model');
  assert.equal(configs.vision.visionModel, 'legacy-vision');
  assert.equal(configs.organize.apiKey, '');
  assert.notEqual(configs.organize, configs.agent);
});
