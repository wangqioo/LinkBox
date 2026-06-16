import type { AIConfig, EmbeddingConfig, EmbeddingProvider } from '../api/client';

export interface SiteCookieEntry {
  domain: string;
  label: string;
  hint: string;
  helpUrl: string;
  cookieKey: string;
}

export const SITE_COOKIES: SiteCookieEntry[] = [
  {
    domain: 'zhihu.com',
    label: '知乎',
    hint: '填入 z_c0 Cookie 值（格式：z_c0=2|xxx...）',
    helpUrl: 'https://www.zhihu.com',
    cookieKey: 'cookie:zhihu.com',
  },
];

export const DEFAULT_AI_CONFIG: AIConfig = {
  provider: 'custom',
  providerName: '自定义 / 本地 OpenAI 兼容',
  providers: [],
  baseUrl: '',
  model: '',
  visionModel: '',
  temperature: 0.3,
  enableThinking: false,
  apiKeyConfigured: false,
  apiKey: '',
};

export const EMBEDDING_PROVIDERS: EmbeddingProvider[] = [
  {
    id: 'local',
    name: '本地 Hash Embedding',
    description: '不调用外部接口，适合离线索引和小规模语义检索。',
  },
  {
    id: 'openai-compatible',
    name: 'OpenAI 兼容接口',
    description: '调用 /embeddings 接口，索引和检索会使用同一个远程模型。',
  },
];

export const DEFAULT_EMBEDDING_CONFIG: EmbeddingConfig = {
  enabled: true,
  provider: 'local',
  providers: EMBEDDING_PROVIDERS,
  baseUrl: '',
  model: 'linkbox-local-hash-v1',
  apiKeyConfigured: false,
  apiKey: '',
};

export function applyProviderPreset(config: AIConfig, providerId: string): AIConfig {
  const provider = config.providers?.find((item) => item.id === providerId);
  if (!provider) return { ...config, provider: providerId };
  return {
    ...config,
    provider: provider.id,
    providerName: provider.name,
    baseUrl: provider.baseUrl,
    model: provider.model,
    visionModel: provider.visionModel || '',
  };
}

export function applyEmbeddingProviderPreset(config: EmbeddingConfig, providerId: string): EmbeddingConfig {
  if (providerId === 'local') {
    return {
      ...config,
      provider: 'local',
      baseUrl: '',
      model: DEFAULT_EMBEDDING_CONFIG.model,
    };
  }
  return {
    ...config,
    provider: providerId,
  };
}
