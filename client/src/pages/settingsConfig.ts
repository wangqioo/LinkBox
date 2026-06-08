import type { AIConfig } from '../api/client';

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
