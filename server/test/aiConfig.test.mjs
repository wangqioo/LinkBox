import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';

const testDir = mkdtempSync(join(tmpdir(), 'linkbox-ai-config-test-'));
process.env.DB_PATH = join(testDir, 'test.db');
process.env.DATA_DIR = testDir;
process.env.UPLOADS_DIR = join(testDir, 'uploads');

after(() => {
  rmSync(testDir, { recursive: true, force: true });
});

async function withAiConfig(fn) {
  const token = `${Date.now()}-${Math.random()}`;
  const dbModule = await import('../db.js');
  const aiConfig = await import(`../utils/aiConfig.js?ai-config-test=${token}`);
  const db = dbModule.default;
  db.prepare("DELETE FROM settings WHERE key LIKE 'ai:%'").run();
  return await fn({ db, aiConfig });
}

test('purpose AI config falls back to legacy ai keys', async () => withAiConfig(async ({ db, aiConfig }) => {
  db.prepare("INSERT INTO settings (key, value) VALUES ('ai:provider', 'custom')").run();
  db.prepare("INSERT INTO settings (key, value) VALUES ('ai:base_url', 'http://legacy.example/v1')").run();
  db.prepare("INSERT INTO settings (key, value) VALUES ('ai:model', 'legacy-model')").run();
  db.prepare("INSERT INTO settings (key, value) VALUES ('ai:api_key', 'legacy-secret')").run();

  const publicConfig = aiConfig.getAIConfig({ purpose: 'agent' });
  assert.equal(publicConfig.purpose, 'agent');
  assert.equal(publicConfig.provider, 'custom');
  assert.equal(publicConfig.baseUrl, 'http://legacy.example/v1');
  assert.equal(publicConfig.model, 'legacy-model');
  assert.equal(publicConfig.apiKeyConfigured, true);
  assert.equal(Object.hasOwn(publicConfig, 'apiKey'), false);

  const secretConfig = aiConfig.getAIConfig({ purpose: 'agent', includeSecret: true });
  assert.equal(secretConfig.apiKey, 'legacy-secret');
}));

test('purpose AI config stores purpose keys without changing legacy keys', async () => withAiConfig(async ({ db, aiConfig }) => {
  db.prepare("INSERT INTO settings (key, value) VALUES ('ai:model', 'legacy-model')").run();

  const updated = aiConfig.updateAIConfig({
    provider: 'custom',
    baseUrl: 'http://agent.example/v1/',
    model: 'agent-model',
    visionModel: 'agent-vision',
    apiKey: 'agent-secret',
    temperature: 0.2,
    enableThinking: true,
  }, { purpose: 'agent' });

  assert.equal(updated.purpose, 'agent');
  assert.equal(updated.model, 'agent-model');
  assert.equal(updated.baseUrl, 'http://agent.example/v1');
  assert.equal(updated.apiKeyConfigured, true);
  assert.equal(Object.hasOwn(updated, 'apiKey'), false);
  assert.equal(db.prepare("SELECT value FROM settings WHERE key = 'ai:model'").get().value, 'legacy-model');
  assert.equal(db.prepare("SELECT value FROM settings WHERE key = 'ai:agent:model'").get().value, 'agent-model');
  assert.equal(db.prepare("SELECT value FROM settings WHERE key = 'ai:agent:api_key'").get().value, 'agent-secret');
}));

test('getAIPurposeConfigs exposes organize, agent, and vision configs', async () => withAiConfig(async ({ db, aiConfig }) => {
  db.prepare("INSERT INTO settings (key, value) VALUES ('ai:organize:model', 'organize-model')").run();
  db.prepare("INSERT INTO settings (key, value) VALUES ('ai:agent:model', 'agent-model')").run();

  const configs = aiConfig.getAIPurposeConfigs();
  assert.equal(configs.organize.model, 'organize-model');
  assert.equal(configs.agent.model, 'agent-model');
  assert.equal(configs.vision.model.length > 0, true);
  assert.equal(Object.hasOwn(configs.agent, 'apiKey'), false);
}));
