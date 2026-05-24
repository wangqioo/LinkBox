import { useState, useEffect } from 'react';
import { api, type AIConfig, type AIProvider } from '../api/client';
import { useAuth } from '../context/AuthContext';
import { Save, ExternalLink, PlugZap } from 'lucide-react';

interface SiteCookieEntry {
  domain: string;
  label: string;
  hint: string;
  helpUrl: string;
  cookieKey: string;
}

const SITE_COOKIES: SiteCookieEntry[] = [
  {
    domain: 'zhihu.com',
    label: '知乎',
    hint: '填入 z_c0 Cookie 值（格式：z_c0=2|xxx...）',
    helpUrl: 'https://www.zhihu.com',
    cookieKey: 'cookie:zhihu.com',
  },
];

const DEFAULT_AI_CONFIG: AIConfig = {
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

function applyProviderPreset(config: AIConfig, providerId: string): AIConfig {
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

export default function SettingsPage() {
  const { user } = useAuth();
  const [settings, setSettings] = useState<Record<string, string>>({});
  const [aiConfig, setAIConfig] = useState<AIConfig>(DEFAULT_AI_CONFIG);
  const [saving, setSaving] = useState(false);
  const [testingAI, setTestingAI] = useState(false);
  const [saved, setSaved] = useState(false);
  const [aiTestResult, setAITestResult] = useState('');
  const [error, setError] = useState('');

  const isAdmin = user?.id === 1;

  useEffect(() => {
    if (!isAdmin) return;
    api.getSettings().then(setSettings).catch(() => {});
    api.getAIConfig()
      .then((config) => setAIConfig({ ...DEFAULT_AI_CONFIG, ...config, apiKey: '' }))
      .catch(() => {});
  }, [isAdmin]);

  const handleSave = async () => {
    setSaving(true);
    setError('');
    setAITestResult('');
    try {
      await api.updateSettings(settings);
      const payload: Partial<AIConfig> = { ...aiConfig };
      if (!payload.apiKey) delete payload.apiKey;
      const result = await api.updateAIConfig(payload);
      setAIConfig({ ...DEFAULT_AI_CONFIG, ...result.config, apiKey: '' });
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    } catch (e: any) {
      setError(e.message || '保存失败');
    } finally {
      setSaving(false);
    }
  };

  const handleTestAI = async () => {
    setTestingAI(true);
    setError('');
    setAITestResult('');
    try {
      const payload: Partial<AIConfig> = { ...aiConfig };
      if (!payload.apiKey) delete payload.apiKey;
      const result = await api.testAIConfig(payload);
      const count = result.models?.length ? `，发现 ${result.models.length} 个模型` : '';
      setAITestResult(`连接成功：${result.provider || aiConfig.provider} / ${result.model}${count}`);
    } catch (e: any) {
      setError(e.message || 'AI 接口测试失败');
    } finally {
      setTestingAI(false);
    }
  };

  const updateAIField = <K extends keyof AIConfig>(key: K, value: AIConfig[K]) => {
    setAIConfig((prev) => ({ ...prev, [key]: value }));
  };

  const handleProviderChange = (providerId: string) => {
    setAIConfig((prev) => applyProviderPreset(prev, providerId));
    setAITestResult('');
  };

  const selectedProvider = aiConfig.providers?.find((item: AIProvider) => item.id === aiConfig.provider);

  if (!isAdmin) {
    return (
      <div className="text-center py-20 text-gray-500">
        仅管理员可访问设置页面
      </div>
    );
  }

  return (
    <div className="max-w-2xl space-y-6">
      <div>
        <h1 className="text-xl font-bold">系统设置</h1>
        <p className="text-sm text-gray-500 mt-1">管理员专用配置</p>
      </div>

      {/* Site Cookies */}
      <div className="rounded-xl border p-5 space-y-4">
        <div>
          <h2 className="font-semibold">站点 Cookie 配置</h2>
          <p className="text-sm text-gray-500 mt-0.5">
            部分网站（如知乎）需要登录后才能提取内容。在此填入对应网站的 Cookie，LinkBox 将使用它来抓取内容。
          </p>
        </div>

        {SITE_COOKIES.map((site) => (
          <div key={site.domain} className="space-y-1.5">
            <div className="flex items-center gap-2">
              <label className="text-sm font-medium">{site.label}</label>
              <a
                href={site.helpUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="text-xs text-indigo-500 flex items-center gap-0.5 hover:underline"
              >
                <ExternalLink className="w-3 h-3" />
                打开网站
              </a>
            </div>
            <textarea
              rows={3}
              className="w-full text-xs font-mono rounded-lg border px-3 py-2 bg-gray-50 dark:bg-gray-800 focus:outline-none focus:ring-2 focus:ring-indigo-500 resize-none"
              placeholder={site.hint}
              value={settings[site.cookieKey] || ''}
              onChange={(e) =>
                setSettings((prev) => ({ ...prev, [site.cookieKey]: e.target.value }))
              }
            />
            <p className="text-xs text-gray-400">
              如何获取：在浏览器登录 {site.label} 后，打开开发者工具 → Application → Cookies，复制 Cookie 字符串粘贴到此处。
            </p>
          </div>
        ))}
      </div>

      {/* AI Configuration */}
      <div className="rounded-xl border p-5 space-y-4">
        <div>
          <h2 className="font-semibold">AI 配置</h2>
          <p className="text-sm text-gray-500 mt-0.5">
            像 Hermes 一样先选供应商，LinkBox 会自动填接口地址和默认模型；多数情况下你只需要粘贴 API Key 后保存。
          </p>
        </div>

        <div className="grid gap-4 md:grid-cols-2">
          <div className="md:col-span-2 space-y-1.5">
            <label className="text-sm font-medium">供应商</label>
            <select
              className="w-full rounded-lg border px-3 py-2 bg-gray-50 dark:bg-gray-800 focus:outline-none focus:ring-2 focus:ring-indigo-500"
              value={aiConfig.provider}
              onChange={(e) => handleProviderChange(e.target.value)}
            >
              {(aiConfig.providers || []).map((provider) => (
                <option key={provider.id} value={provider.id}>{provider.name}</option>
              ))}
            </select>
            {selectedProvider?.description && (
              <p className="text-xs text-gray-400">{selectedProvider.description}</p>
            )}
          </div>

          <div className="md:col-span-2 space-y-1.5">
            <label className="text-sm font-medium">接口地址</label>
            <input
              className="w-full rounded-lg border px-3 py-2 bg-gray-50 dark:bg-gray-800 focus:outline-none focus:ring-2 focus:ring-indigo-500"
              placeholder="http://127.0.0.1:8000/v1"
              value={aiConfig.baseUrl}
              onChange={(e) => updateAIField('baseUrl', e.target.value)}
            />
          </div>

          <div className="space-y-1.5">
            <label className="text-sm font-medium">文本模型</label>
            <input
              className="w-full rounded-lg border px-3 py-2 bg-gray-50 dark:bg-gray-800 focus:outline-none focus:ring-2 focus:ring-indigo-500"
              placeholder="Qwen3.5-4B"
              value={aiConfig.model}
              onChange={(e) => updateAIField('model', e.target.value)}
            />
          </div>

          <div className="space-y-1.5">
            <label className="text-sm font-medium">视觉模型</label>
            <input
              className="w-full rounded-lg border px-3 py-2 bg-gray-50 dark:bg-gray-800 focus:outline-none focus:ring-2 focus:ring-indigo-500"
              placeholder="留空时使用文本模型"
              value={aiConfig.visionModel}
              onChange={(e) => updateAIField('visionModel', e.target.value)}
            />
          </div>

          <div className="space-y-1.5">
            <label className="text-sm font-medium">API Key</label>
            <input
              type="password"
              autoComplete="new-password"
              className="w-full rounded-lg border px-3 py-2 bg-gray-50 dark:bg-gray-800 focus:outline-none focus:ring-2 focus:ring-indigo-500"
              placeholder={aiConfig.apiKeyConfigured ? '已保存，留空则不修改' : selectedProvider?.keyPlaceholder || '粘贴 API Key'}
              value={aiConfig.apiKey || ''}
              onChange={(e) => updateAIField('apiKey', e.target.value)}
            />
          </div>

          <div className="space-y-1.5">
            <label className="text-sm font-medium">温度：{aiConfig.temperature}</label>
            <input
              type="range"
              min="0"
              max="2"
              step="0.1"
              className="w-full accent-indigo-600"
              value={aiConfig.temperature}
              onChange={(e) => updateAIField('temperature', Number(e.target.value))}
            />
          </div>
        </div>

        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            className="rounded border-gray-300 text-indigo-600 focus:ring-indigo-500"
            checked={aiConfig.enableThinking}
            onChange={(e) => updateAIField('enableThinking', e.target.checked)}
          />
          启用本地 Qwen 思考模式（仅自定义/本地接口会传 enable_thinking）
        </label>

        <div className="flex flex-wrap items-center gap-3">
          <button
            type="button"
            onClick={handleTestAI}
            disabled={testingAI}
            className="btn-secondary flex items-center gap-2"
          >
            <PlugZap className="w-4 h-4" />
            {testingAI ? '测试中…' : '测试连接'}
          </button>
          {aiTestResult && <span className="text-sm text-green-600">{aiTestResult}</span>}
        </div>
      </div>

      {error && (
        <div className="text-sm text-red-600 bg-red-50 dark:bg-red-900/20 rounded-lg px-4 py-2">
          {error}
        </div>
      )}

      <button
        onClick={handleSave}
        disabled={saving}
        className="btn-primary flex items-center gap-2"
      >
        <Save className="w-4 h-4" />
        {saving ? '保存中…' : saved ? '已保存 ✓' : '保存设置'}
      </button>
    </div>
  );
}
