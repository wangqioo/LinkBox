import test from 'node:test';
import assert from 'node:assert/strict';
import {
  inferImagePromptType,
  isLocalVisionConfig,
  promptCacheType,
  promptForImageType,
} from '../utils/imageVisionService.js';

test('isLocalVisionConfig only enables local optimizations for local custom endpoints', () => {
  assert.equal(isLocalVisionConfig({
    provider: 'custom',
    baseUrl: 'http://127.0.0.1:8000/v1',
  }), true);
  assert.equal(isLocalVisionConfig({
    provider: 'custom',
    baseUrl: 'http://localhost:8000/v1',
  }), true);
  assert.equal(isLocalVisionConfig({
    provider: 'zhipu',
    baseUrl: 'http://127.0.0.1:8000/v1',
  }), false);
  assert.equal(isLocalVisionConfig({
    provider: 'custom',
    baseUrl: 'https://api.example.com/v1',
  }), false);
});

test('inferImagePromptType chooses specialized prompts from filenames', () => {
  assert.equal(inferImagePromptType({ originalName: 'phone-screenshot.png' }), 'screenshot');
  assert.equal(inferImagePromptType({ originalName: 'invoice-scan.jpg' }), 'document');
  assert.equal(inferImagePromptType({ originalName: 'holiday-photo.jpg' }), 'photo');
});

test('promptForImageType returns conservative instructions', () => {
  for (const type of ['screenshot', 'document', 'photo']) {
    const prompt = promptForImageType(type);
    assert.match(prompt, /只能使用中文/);
    assert.doesNotMatch(prompt, /Return concise Chinese|Analyze this image/);
  }
  assert.match(promptForImageType('screenshot'), /界面结构/);
  assert.match(promptForImageType('document'), /看不清/);
  assert.match(promptForImageType('photo'), /不要编造/);
});

test('promptCacheType versions cached image descriptions when prompt language changes', () => {
  assert.equal(promptCacheType('photo'), 'photo.zh-v2');
});
