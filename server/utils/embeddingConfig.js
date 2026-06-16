import db from '../db.js';
import {
  LOCAL_EMBEDDING_DIMENSION,
  LOCAL_EMBEDDING_MODEL,
  LOCAL_EMBEDDING_PROVIDER,
} from './documentEmbeddings.js';

const SETTINGS_KEYS = {
  enabled: 'embedding:enabled',
  provider: 'embedding:provider',
  baseUrl: 'embedding:base_url',
  model: 'embedding:model',
  apiKey: 'embedding:api_key',
};

const OPENAI_COMPATIBLE_PROVIDER = 'openai-compatible';
const DEFAULTS = {
  enabled: true,
  provider: LOCAL_EMBEDDING_PROVIDER,
  baseUrl: '',
  model: LOCAL_EMBEDDING_MODEL,
  apiKey: '',
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

function parseBool(value, fallback = false) {
  if (value === undefined || value === null || value === '') return fallback;
  if (typeof value === 'boolean') return value;
  return ['1', 'true', 'yes', 'on'].includes(String(value).toLowerCase());
}

function normalizeBaseUrl(baseUrl) {
  return String(baseUrl || '').trim().replace(/\/+$/, '');
}

function normalizeProvider(provider) {
  const value = String(provider || DEFAULTS.provider).trim().toLowerCase();
  return value === OPENAI_COMPATIBLE_PROVIDER ? OPENAI_COMPATIBLE_PROVIDER : LOCAL_EMBEDDING_PROVIDER;
}

function sanitizeEmbeddingConfig(config) {
  const { apiKey, ...safe } = config;
  return {
    ...safe,
    apiKeyConfigured: Boolean(apiKey || config.apiKeyConfigured),
  };
}

function resolveConfig(input = {}, saved = getEmbeddingConfig({ includeSecret: true })) {
  const provider = input.provider !== undefined ? normalizeProvider(input.provider) : saved.provider;
  const providerChanged = provider !== saved.provider;
  const local = provider === LOCAL_EMBEDDING_PROVIDER;
  const baseUrl = local
    ? ''
    : normalizeBaseUrl(input.baseUrl !== undefined ? input.baseUrl : (providerChanged ? DEFAULTS.baseUrl : saved.baseUrl));
  const model = local
    ? LOCAL_EMBEDDING_MODEL
    : String(input.model !== undefined ? input.model : (providerChanged ? '' : saved.model)).trim();

  return {
    enabled: input.enabled !== undefined ? parseBool(input.enabled, saved.enabled) : saved.enabled,
    provider,
    baseUrl,
    model,
    apiKey: input.apiKey !== undefined ? String(input.apiKey) : (providerChanged ? DEFAULTS.apiKey : saved.apiKey),
  };
}

function assertValidConfig(config) {
  if (config.provider === LOCAL_EMBEDDING_PROVIDER) return;

  let parsed;
  try {
    parsed = new URL(config.baseUrl);
  } catch {
    throw new Error('Embedding endpoint address is invalid');
  }
  if (!['http:', 'https:'].includes(parsed.protocol)) {
    throw new Error('Embedding endpoint address must start with http:// or https://');
  }
  if (!config.model) {
    throw new Error('Embedding model name is required');
  }
}

export function getEmbeddingConfig({ includeSecret = false } = {}) {
  const provider = normalizeProvider(getSetting(SETTINGS_KEYS.provider) ?? DEFAULTS.provider);
  const local = provider === LOCAL_EMBEDDING_PROVIDER;
  const apiKey = getSetting(SETTINGS_KEYS.apiKey) ?? DEFAULTS.apiKey;
  const config = {
    enabled: parseBool(getSetting(SETTINGS_KEYS.enabled), DEFAULTS.enabled),
    provider,
    baseUrl: local ? '' : normalizeBaseUrl(getSetting(SETTINGS_KEYS.baseUrl) ?? DEFAULTS.baseUrl),
    model: local ? LOCAL_EMBEDDING_MODEL : String(getSetting(SETTINGS_KEYS.model) ?? '').trim(),
    apiKeyConfigured: Boolean(apiKey),
  };
  if (includeSecret) config.apiKey = apiKey;
  return config;
}

export function updateEmbeddingConfig(input = {}) {
  const next = resolveConfig(input);
  assertValidConfig(next);

  const tx = db.transaction(() => {
    setSetting(SETTINGS_KEYS.enabled, next.enabled ? '1' : '0');
    setSetting(SETTINGS_KEYS.provider, next.provider);
    setSetting(SETTINGS_KEYS.baseUrl, next.baseUrl);
    setSetting(SETTINGS_KEYS.model, next.model);
    setSetting(SETTINGS_KEYS.apiKey, next.apiKey);
  });
  tx();

  return sanitizeEmbeddingConfig(getEmbeddingConfig({ includeSecret: true }));
}

export async function testEmbeddingConfig(input = {}) {
  const config = resolveConfig(input);
  assertValidConfig(config);

  if (config.provider === LOCAL_EMBEDDING_PROVIDER) {
    return {
      ok: true,
      provider: LOCAL_EMBEDDING_PROVIDER,
      model: LOCAL_EMBEDDING_MODEL,
      dimension: LOCAL_EMBEDDING_DIMENSION,
    };
  }

  const response = await fetch(`${config.baseUrl}/embeddings`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(config.apiKey ? { Authorization: `Bearer ${config.apiKey}` } : {}),
    },
    body: JSON.stringify({
      model: config.model,
      input: ['LinkBox embedding configuration test'],
    }),
    signal: AbortSignal.timeout(15000),
  });
  if (!response.ok) {
    const err = await response.text().catch(() => '');
    throw new Error(`Embedding endpoint returned ${response.status}: ${err.slice(0, 160)}`);
  }

  const data = await response.json().catch(() => ({}));
  const embedding = Array.isArray(data.data) ? data.data[0]?.embedding : null;
  return {
    ok: true,
    provider: OPENAI_COMPATIBLE_PROVIDER,
    model: config.model,
    ...(Array.isArray(embedding) ? { dimension: embedding.length } : {}),
  };
}
