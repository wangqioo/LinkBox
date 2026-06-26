import type { AIConfig, AIPurpose, EmbeddingConfig, EmbeddingProvider } from '../api/client';

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

export const AI_PURPOSES: AIPurpose[] = ['organize', 'agent', 'vision'];

export const AI_PURPOSE_LABELS: Record<AIPurpose, { title: string; description: string }> = {
  organize: {
    title: '资料整理模型',
    description: '用于摘要、学习笔记、转写整理和后台结构化处理，适合本地或低成本模型。',
  },
  agent: {
    title: '资料助理模型',
    description: '用于聊天问答、证据综合和最终回答，建议配置更强的云端模型。',
  },
  vision: {
    title: '图片理解模型',
    description: '用于图片、截图和网页图片描述，可与资料整理模型共用本地视觉接口。',
  },
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

export function normalizeAIPurposeConfigs(config: AIConfig): Record<AIPurpose, AIConfig> {
  const fallback = {
    ...DEFAULT_AI_CONFIG,
    ...config,
    purposes: undefined,
    apiKey: '',
  };

  return AI_PURPOSES.reduce((result, purpose) => {
    const purposeConfig = config.purposes?.[purpose];
    result[purpose] = {
      ...fallback,
      ...(purposeConfig || {}),
      purpose,
      providers: purposeConfig?.providers?.length ? purposeConfig.providers : fallback.providers,
      apiKey: '',
    };
    return result;
  }, {} as Record<AIPurpose, AIConfig>);
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
