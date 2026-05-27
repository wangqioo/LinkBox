import db from '../db.js';

const SETTINGS_KEYS = {
  provider: 'ai:provider',
  baseUrl: 'ai:base_url',
  model: 'ai:model',
  visionModel: 'ai:vision_model',
  apiKey: 'ai:api_key',
  temperature: 'ai:temperature',
  enableThinking: 'ai:enable_thinking',
};

const PROVIDER_PRESETS = [
  {
    id: 'custom',
    name: '自定义 / 本地 OpenAI 兼容',
    baseUrl: process.env.LOCAL_LLM_URL || 'http://localhost:8000/v1',
    model: process.env.LOCAL_LLM_MODEL || 'Qwen3.5-4B',
    visionModel: process.env.LOCAL_VISION_MODEL || process.env.LOCAL_LLM_MODEL || 'Qwen3.5-4B',
    apiKeyEnv: 'LOCAL_LLM_API_KEY',
    keyPlaceholder: '本地服务通常可留空；中转/私有服务填 sk-...',
    supportsThinkingParam: true,
    description: '适合本机 vLLM、OneAPI、NewAPI、LiteLLM、各种中转。',
  },
  {
    id: 'deepseek',
    name: 'DeepSeek',
    baseUrl: 'https://api.deepseek.com/v1',
    model: 'deepseek-chat',
    visionModel: '',
    apiKeyEnv: 'DEEPSEEK_API_KEY',
    keyPlaceholder: 'sk-...',
    supportsThinkingParam: false,
    description: '日常文本推荐；如需推理可手动改成 deepseek-reasoner。',
  },
  {
    id: 'openai',
    name: 'OpenAI',
    baseUrl: 'https://api.openai.com/v1',
    model: 'gpt-4o-mini',
    visionModel: 'gpt-4o-mini',
    apiKeyEnv: 'OPENAI_API_KEY',
    keyPlaceholder: 'sk-...',
    supportsThinkingParam: false,
    description: 'OpenAI 官方接口。',
  },
  {
    id: 'openrouter',
    name: 'OpenRouter',
    baseUrl: 'https://openrouter.ai/api/v1',
    model: 'openai/gpt-4o-mini',
    visionModel: 'openai/gpt-4o-mini',
    apiKeyEnv: 'OPENROUTER_API_KEY',
    keyPlaceholder: 'sk-or-v1-...',
    supportsThinkingParam: false,
    description: '聚合模型平台，模型名需带 provider 前缀。',
  },
  {
    id: 'moonshot',
    name: 'Kimi / Moonshot',
    baseUrl: 'https://api.moonshot.cn/v1',
    model: 'moonshot-v1-8k',
    visionModel: '',
    apiKeyEnv: 'KIMI_API_KEY',
    keyPlaceholder: 'sk-...',
    supportsThinkingParam: false,
    description: '月之暗面 OpenAI 兼容接口。',
  },
  {
    id: 'dashscope',
    name: '阿里云 DashScope / 通义千问',
    baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
    model: 'qwen-plus',
    visionModel: 'qwen-vl-plus',
    apiKeyEnv: 'DASHSCOPE_API_KEY',
    keyPlaceholder: 'sk-...',
    supportsThinkingParam: false,
    description: 'DashScope OpenAI 兼容模式。',
  },
  {
    id: 'zhipu',
    name: '智谱 GLM',
    baseUrl: 'https://open.bigmodel.cn/api/paas/v4',
    model: 'glm-4-flash',
    visionModel: 'glm-4v-flash',
    apiKeyEnv: 'GLM_API_KEY',
    keyPlaceholder: '填入智谱 API Key',
    supportsThinkingParam: false,
    description: '智谱 OpenAI 兼容接口。',
  },
];

const PROVIDERS_BY_ID = new Map(PROVIDER_PRESETS.map(provider => [provider.id, provider]));

function envValue(name) {
  return name ? (process.env[name] || '') : '';
}

const DEFAULTS = {
  provider: 'zhipu',
  baseUrl: PROVIDERS_BY_ID.get('zhipu').baseUrl,
  model: process.env.GLM_MODEL || PROVIDERS_BY_ID.get('zhipu').model,
  visionModel: process.env.GLM_VISION_MODEL || PROVIDERS_BY_ID.get('zhipu').visionModel,
  apiKey: process.env.GLM_API_KEY || '',
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

function normalizeProvider(provider) {
  const id = String(provider || DEFAULTS.provider).trim().toLowerCase();
  return PROVIDERS_BY_ID.has(id) ? id : 'custom';
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

function providerPublic(provider) {
  const { supportsThinkingParam, ...safe } = provider;
  return safe;
}

function getPreset(providerId) {
  return PROVIDERS_BY_ID.get(normalizeProvider(providerId)) || PROVIDERS_BY_ID.get('custom');
}

function getDefaultApiKey(providerId) {
  const preset = getPreset(providerId);
  return envValue(preset.apiKeyEnv) || (providerId === 'custom' ? DEFAULTS.apiKey : '');
}

function resolveProviderConfig({ provider, baseUrl, model, visionModel, enableThinking }) {
  const providerId = normalizeProvider(provider);
  const preset = getPreset(providerId);
  const resolved = {
    provider: providerId,
    baseUrl: normalizeBaseUrl(baseUrl || preset.baseUrl || DEFAULTS.baseUrl),
    model: String(model || preset.model || DEFAULTS.model).trim(),
    visionModel: visionModel === undefined || visionModel === null
      ? String(preset.visionModel ?? '').trim()
      : String(visionModel).trim(),
    enableThinking: parseBool(enableThinking, DEFAULTS.enableThinking),
    supportsThinkingParam: Boolean(preset.supportsThinkingParam),
  };
  return resolved;
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
  if (config.visionModel !== undefined && config.visionModel !== null) {
    config.visionModel = String(config.visionModel).trim();
  }
  if (!Number.isFinite(config.temperature) || config.temperature < 0 || config.temperature > 2) {
    throw new Error('温度必须是 0 到 2 之间的数字');
  }
}

export function getAIProviders() {
  return PROVIDER_PRESETS.map(providerPublic);
}

export function getAIConfig({ includeSecret = false } = {}) {
  const provider = normalizeProvider(getSetting(SETTINGS_KEYS.provider) ?? DEFAULTS.provider);
  const preset = getPreset(provider);
  const configuredApiKey = getSetting(SETTINGS_KEYS.apiKey);
  const config = {
    provider,
    providerName: preset.name,
    baseUrl: normalizeBaseUrl(getSetting(SETTINGS_KEYS.baseUrl) ?? preset.baseUrl ?? DEFAULTS.baseUrl),
    model: String(getSetting(SETTINGS_KEYS.model) ?? preset.model ?? DEFAULTS.model).trim(),
    visionModel: String(getSetting(SETTINGS_KEYS.visionModel) ?? preset.visionModel ?? '').trim(),
    temperature: parseTemperature(getSetting(SETTINGS_KEYS.temperature), DEFAULTS.temperature),
    enableThinking: parseBool(getSetting(SETTINGS_KEYS.enableThinking), DEFAULTS.enableThinking),
    apiKeyConfigured: Boolean(configuredApiKey || getDefaultApiKey(provider)),
    providers: getAIProviders(),
  };
  if (includeSecret) {
    config.apiKey = configuredApiKey ?? getDefaultApiKey(provider);
    config.supportsThinkingParam = Boolean(preset.supportsThinkingParam);
  }
  return config;
}

export function sanitizeAIConfig(config) {
  const { apiKey, supportsThinkingParam, ...safe } = config;
  return {
    ...safe,
    apiKeyConfigured: Boolean(config.apiKey || config.apiKeyConfigured),
    providers: getAIProviders(),
  };
}

export function updateAIConfig(input = {}) {
  const current = getAIConfig({ includeSecret: true });
  const nextProvider = input.provider !== undefined ? normalizeProvider(input.provider) : current.provider;
  const preset = getPreset(nextProvider);
  const providerChanged = nextProvider !== current.provider;
  const baseForProvider = resolveProviderConfig({
    provider: nextProvider,
    baseUrl: providerChanged ? preset.baseUrl : current.baseUrl,
    model: providerChanged ? preset.model : current.model,
    visionModel: providerChanged ? preset.visionModel : current.visionModel,
    enableThinking: providerChanged ? DEFAULTS.enableThinking : current.enableThinking,
  });
  const next = {
    ...current,
    provider: nextProvider,
    providerName: preset.name,
    baseUrl: input.baseUrl !== undefined ? normalizeBaseUrl(input.baseUrl) : baseForProvider.baseUrl,
    model: input.model !== undefined ? String(input.model).trim() : baseForProvider.model,
    visionModel: input.visionModel !== undefined ? String(input.visionModel).trim() : baseForProvider.visionModel,
    temperature: input.temperature !== undefined ? Number(input.temperature) : current.temperature,
    enableThinking: input.enableThinking !== undefined ? parseBool(input.enableThinking, current.enableThinking) : baseForProvider.enableThinking,
    apiKey: input.apiKey !== undefined ? String(input.apiKey) : (providerChanged ? getDefaultApiKey(nextProvider) : current.apiKey),
    supportsThinkingParam: Boolean(preset.supportsThinkingParam),
  };

  assertValidConfig(next);

  const tx = db.transaction(() => {
    setSetting(SETTINGS_KEYS.provider, next.provider);
    setSetting(SETTINGS_KEYS.baseUrl, next.baseUrl);
    setSetting(SETTINGS_KEYS.model, next.model);
    setSetting(SETTINGS_KEYS.visionModel, next.visionModel);
    setSetting(SETTINGS_KEYS.temperature, String(next.temperature));
    setSetting(SETTINGS_KEYS.enableThinking, next.enableThinking ? '1' : '0');
    if (input.apiKey !== undefined || providerChanged) setSetting(SETTINGS_KEYS.apiKey, next.apiKey);
  });
  tx();

  return sanitizeAIConfig(getAIConfig({ includeSecret: true }));
}

function buildProviderSpecificPayload(payload, config) {
  if (config.supportsThinkingParam) {
    return {
      ...payload,
      chat_template_kwargs: { enable_thinking: config.enableThinking },
    };
  }
  return payload;
}

export function buildChatCompletionPayload({ messages, model, maxTokens = 200, temperature, enableThinking }) {
  const config = getAIConfig({ includeSecret: true });
  const effectiveConfig = {
    ...config,
    enableThinking: enableThinking !== undefined ? parseBool(enableThinking, config.enableThinking) : config.enableThinking,
  };
  return buildProviderSpecificPayload({
    model: model || config.model,
    messages,
    max_tokens: maxTokens,
    temperature: temperature ?? config.temperature,
  }, effectiveConfig);
}

export async function callAIChat({ messages, model, maxTokens = 200, temperature, timeoutMs = 60000 }) {
  const config = getAIConfig({ includeSecret: true });
  const response = await fetch(`${config.baseUrl}/chat/completions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(config.apiKey ? { Authorization: `Bearer ${config.apiKey}` } : {}),
    },
    body: JSON.stringify(buildProviderSpecificPayload({
      model: model || config.model,
      messages,
      max_tokens: maxTokens,
      temperature: temperature ?? config.temperature,
    }, config)),
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (!response.ok) {
    const err = await response.text().catch(() => '');
    throw new Error(`LLM error ${response.status}: ${err.slice(0, 200)}`);
  }
  const data = await response.json();
  return (data.choices?.[0]?.message?.content || '').trim();
}

export async function streamAIChat({ messages, model, maxTokens = 200, temperature, enableThinking, timeoutMs = 90000, onToken }) {
  const config = getAIConfig({ includeSecret: true });
  const effectiveConfig = {
    ...config,
    enableThinking: enableThinking !== undefined ? parseBool(enableThinking, config.enableThinking) : config.enableThinking,
  };
  const response = await fetch(`${config.baseUrl}/chat/completions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(config.apiKey ? { Authorization: `Bearer ${config.apiKey}` } : {}),
    },
    body: JSON.stringify(buildProviderSpecificPayload({
      model: model || config.model,
      messages,
      max_tokens: maxTokens,
      temperature: temperature ?? config.temperature,
      stream: true,
    }, effectiveConfig)),
    signal: AbortSignal.timeout(timeoutMs),
  });

  if (!response.ok) {
    const err = await response.text().catch(() => '');
    throw new Error(`LLM error ${response.status}: ${err.slice(0, 200)}`);
  }

  if (!response.body) throw new Error('LLM stream is empty');

  const decoder = new TextDecoder();
  let buffer = '';
  let fullText = '';

  for await (const chunk of response.body) {
    buffer += decoder.decode(chunk, { stream: true });
    const parts = buffer.split('\n\n');
    buffer = parts.pop() || '';

    for (const part of parts) {
      const lines = part.split('\n').map(line => line.trim()).filter(Boolean);
      for (const line of lines) {
        if (!line.startsWith('data:')) continue;
        const data = line.slice(5).trim();
        if (!data || data === '[DONE]') continue;

        let parsed;
        try {
          parsed = JSON.parse(data);
        } catch {
          continue;
        }

        const delta = parsed.choices?.[0]?.delta?.content
          ?? parsed.choices?.[0]?.delta?.reasoning_content
          ?? parsed.choices?.[0]?.delta?.reasoning
          ?? parsed.choices?.[0]?.message?.content
          ?? '';
        if (delta) {
          fullText += delta;
          await onToken?.(delta);
        }
      }
    }
  }

  return fullText.trim();
}

export async function testAIConfig(input = {}) {
  const saved = getAIConfig({ includeSecret: true });
  const provider = input.provider !== undefined ? normalizeProvider(input.provider) : saved.provider;
  const providerChanged = provider !== saved.provider;
  const preset = getPreset(provider);
  const requestedBaseUrl = input.baseUrl !== undefined
    ? normalizeBaseUrl(input.baseUrl)
    : (providerChanged ? normalizeBaseUrl(preset.baseUrl) : saved.baseUrl);
  const apiKey = input.apiKey !== undefined
    ? String(input.apiKey)
    : (providerChanged ? getDefaultApiKey(provider) : (requestedBaseUrl === saved.baseUrl ? saved.apiKey : ''));
  const config = {
    ...saved,
    provider,
    baseUrl: requestedBaseUrl,
    model: input.model !== undefined ? String(input.model).trim() : (providerChanged ? preset.model : saved.model),
    visionModel: input.visionModel !== undefined ? String(input.visionModel).trim() : (providerChanged ? preset.visionModel : saved.visionModel),
    apiKey,
    temperature: input.temperature !== undefined ? Number(input.temperature) : saved.temperature,
    enableThinking: input.enableThinking !== undefined ? parseBool(input.enableThinking, saved.enableThinking) : saved.enableThinking,
  };
  assertValidConfig(config);

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
  return { ok: true, provider: config.provider, model: config.model, models };
}
