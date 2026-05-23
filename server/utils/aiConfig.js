import db from '../db.js';

const SETTINGS_KEYS = {
  baseUrl: 'ai:base_url',
  model: 'ai:model',
  visionModel: 'ai:vision_model',
  apiKey: 'ai:api_key',
  temperature: 'ai:temperature',
  enableThinking: 'ai:enable_thinking',
};

const DEFAULTS = {
  baseUrl: process.env.LOCAL_LLM_URL || 'http://localhost:8000/v1',
  model: process.env.LOCAL_LLM_MODEL || 'Qwen3.5-4B',
  visionModel: process.env.LOCAL_VISION_MODEL || process.env.LOCAL_LLM_MODEL || 'Qwen3.5-4B',
  apiKey: process.env.LOCAL_LLM_API_KEY || process.env.OPENAI_API_KEY || '',
  temperature: 0.3,
  enableThinking: false,
};

function getSetting(key) {
  try {
    return db.prepare('SELECT value FROM settings WHERE key = ?').get(key)?.value;
  } catch {
    return undefined;
  }
}

function setSetting(key, value) {
  db.prepare('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)').run(key, String(value ?? ''));
}

function normalizeBaseUrl(baseUrl) {
  return String(baseUrl || '').trim().replace(/\/+$/, '');
}

function parseBool(value, fallback = false) {
  if (value === undefined || value === null || value === '') return fallback;
  if (typeof value === 'boolean') return value;
  return ['1', 'true', 'yes', 'on'].includes(String(value).toLowerCase());
}

function parseTemperature(value, fallback = DEFAULTS.temperature) {
  if (value === undefined || value === null || value === '') return fallback;
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(2, Math.max(0, n));
}

function assertValidConfig(config) {
  let parsed;
  try {
    parsed = new URL(config.baseUrl);
  } catch {
    throw new Error('AI 接口地址格式不正确');
  }
  if (!['http:', 'https:'].includes(parsed.protocol)) {
    throw new Error('AI 接口地址必须以 http:// 或 https:// 开头');
  }
  if (!config.model || !String(config.model).trim()) {
    throw new Error('模型名称不能为空');
  }
  // Empty vision model is allowed; runtime calls fall back to text model.
  if (config.visionModel !== undefined && config.visionModel !== null) {
    config.visionModel = String(config.visionModel).trim();
  }
  if (!Number.isFinite(config.temperature) || config.temperature < 0 || config.temperature > 2) {
    throw new Error('温度必须是 0 到 2 之间的数字');
  }
}

export function getAIConfig({ includeSecret = false } = {}) {
  const configuredApiKey = getSetting(SETTINGS_KEYS.apiKey);
  const config = {
    baseUrl: normalizeBaseUrl(getSetting(SETTINGS_KEYS.baseUrl) ?? DEFAULTS.baseUrl),
    model: String(getSetting(SETTINGS_KEYS.model) ?? DEFAULTS.model).trim(),
    visionModel: String(getSetting(SETTINGS_KEYS.visionModel) ?? DEFAULTS.visionModel).trim(),
    temperature: parseTemperature(getSetting(SETTINGS_KEYS.temperature), DEFAULTS.temperature),
    enableThinking: parseBool(getSetting(SETTINGS_KEYS.enableThinking), DEFAULTS.enableThinking),
    apiKeyConfigured: Boolean(configuredApiKey || DEFAULTS.apiKey),
  };
  if (includeSecret) {
    config.apiKey = configuredApiKey ?? DEFAULTS.apiKey;
  }
  return config;
}

export function sanitizeAIConfig(config) {
  const { apiKey, ...safe } = config;
  return {
    ...safe,
    apiKeyConfigured: Boolean(config.apiKey || config.apiKeyConfigured),
  };
}

export function updateAIConfig(input = {}) {
  const current = getAIConfig({ includeSecret: true });
  const next = {
    ...current,
    baseUrl: input.baseUrl !== undefined ? normalizeBaseUrl(input.baseUrl) : current.baseUrl,
    model: input.model !== undefined ? String(input.model).trim() : current.model,
    visionModel: input.visionModel !== undefined ? String(input.visionModel).trim() : current.visionModel,
    temperature: input.temperature !== undefined ? Number(input.temperature) : current.temperature,
    enableThinking: input.enableThinking !== undefined ? parseBool(input.enableThinking, current.enableThinking) : current.enableThinking,
    apiKey: input.apiKey !== undefined ? String(input.apiKey) : current.apiKey,
  };

  assertValidConfig(next);

  const tx = db.transaction(() => {
    setSetting(SETTINGS_KEYS.baseUrl, next.baseUrl);
    setSetting(SETTINGS_KEYS.model, next.model);
    setSetting(SETTINGS_KEYS.visionModel, next.visionModel);
    setSetting(SETTINGS_KEYS.temperature, String(next.temperature));
    setSetting(SETTINGS_KEYS.enableThinking, next.enableThinking ? '1' : '0');
    if (input.apiKey !== undefined) setSetting(SETTINGS_KEYS.apiKey, next.apiKey);
  });
  tx();

  return sanitizeAIConfig(getAIConfig({ includeSecret: true }));
}

export function buildChatCompletionPayload({ messages, model, maxTokens = 200, temperature, enableThinking }) {
  const config = getAIConfig();
  return {
    model: model || config.model,
    messages,
    max_tokens: maxTokens,
    temperature: temperature ?? config.temperature,
    chat_template_kwargs: { enable_thinking: parseBool(enableThinking, config.enableThinking) },
  };
}

export async function callAIChat({ messages, model, maxTokens = 200, temperature, timeoutMs = 60000 }) {
  const config = getAIConfig({ includeSecret: true });
  const response = await fetch(`${config.baseUrl}/chat/completions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(config.apiKey ? { Authorization: `Bearer ${config.apiKey}` } : {}),
    },
    body: JSON.stringify({
      model: model || config.model,
      messages,
      max_tokens: maxTokens,
      temperature: temperature ?? config.temperature,
      chat_template_kwargs: { enable_thinking: config.enableThinking },
    }),
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (!response.ok) {
    const err = await response.text().catch(() => '');
    throw new Error(`LLM error ${response.status}: ${err.slice(0, 200)}`);
  }
  const data = await response.json();
  return (data.choices?.[0]?.message?.content || '').trim();
}

export async function testAIConfig(input = {}) {
  const saved = getAIConfig({ includeSecret: true });
  const requestedBaseUrl = input.baseUrl !== undefined ? normalizeBaseUrl(input.baseUrl) : saved.baseUrl;
  const apiKey = input.apiKey !== undefined
    ? String(input.apiKey)
    : (requestedBaseUrl === saved.baseUrl ? saved.apiKey : '');
  const config = {
    ...saved,
    baseUrl: requestedBaseUrl,
    model: input.model !== undefined ? String(input.model).trim() : saved.model,
    apiKey,
    temperature: input.temperature !== undefined ? Number(input.temperature) : saved.temperature,
    enableThinking: input.enableThinking !== undefined ? parseBool(input.enableThinking, saved.enableThinking) : saved.enableThinking,
  };
  assertValidConfig({ ...config, visionModel: config.visionModel || saved.visionModel });

  const modelsUrl = `${config.baseUrl}/models`;
  const response = await fetch(modelsUrl, {
    headers: config.apiKey ? { Authorization: `Bearer ${config.apiKey}` } : {},
    signal: AbortSignal.timeout(15000),
  });
  if (!response.ok) {
    const err = await response.text().catch(() => '');
    throw new Error(`模型接口返回 ${response.status}: ${err.slice(0, 160)}`);
  }
  const data = await response.json().catch(() => ({}));
  const models = Array.isArray(data.data) ? data.data.map(item => item.id).filter(Boolean) : [];
  return { ok: true, model: config.model, models };
}
