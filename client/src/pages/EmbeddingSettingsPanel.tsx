import { PlugZap, Save } from 'lucide-react';
import type { EmbeddingConfig, EmbeddingProvider } from '../api/client';

interface Props {
  config: EmbeddingConfig;
  selectedProvider?: EmbeddingProvider;
  saving: boolean;
  testing: boolean;
  saved: boolean;
  testResult: string;
  onProviderChange: (providerId: string) => void;
  onFieldChange: <K extends keyof EmbeddingConfig>(key: K, value: EmbeddingConfig[K]) => void;
  onSave: () => void;
  onTest: () => void;
}

export default function EmbeddingSettingsPanel({
  config,
  selectedProvider,
  saving,
  testing,
  saved,
  testResult,
  onProviderChange,
  onFieldChange,
  onSave,
  onTest,
}: Props) {
  const isLocal = config.provider === 'local';

  return (
    <div className="rounded-xl border p-5 space-y-4">
      <div>
        <h2 className="font-semibold">Embedding 配置</h2>
        <p className="text-sm text-gray-500 mt-0.5">
          单独控制文档索引和资料助理检索使用的 embedding 供应商与模型。
        </p>
      </div>

      <label className="flex items-center gap-2 text-sm">
        <input
          type="checkbox"
          className="rounded border-gray-300 text-indigo-600 focus:ring-indigo-500"
          checked={config.enabled}
          onChange={(e) => onFieldChange('enabled', e.target.checked)}
        />
        启用文档 Embedding 索引和语义检索
      </label>

      <div className="grid gap-4 md:grid-cols-2">
        <div className="md:col-span-2 space-y-1.5">
          <label className="text-sm font-medium">供应商</label>
          <select
            className="w-full rounded-lg border px-3 py-2 bg-gray-50 dark:bg-gray-800 focus:outline-none focus:ring-2 focus:ring-indigo-500"
            value={config.provider}
            onChange={(e) => onProviderChange(e.target.value)}
          >
            {(config.providers || []).map((provider) => (
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
            className="w-full rounded-lg border px-3 py-2 bg-gray-50 dark:bg-gray-800 disabled:opacity-60 focus:outline-none focus:ring-2 focus:ring-indigo-500"
            placeholder="https://api.openai.com/v1"
            value={config.baseUrl}
            disabled={isLocal}
            onChange={(e) => onFieldChange('baseUrl', e.target.value)}
          />
        </div>

        <div className="space-y-1.5">
          <label className="text-sm font-medium">模型</label>
          <input
            className="w-full rounded-lg border px-3 py-2 bg-gray-50 dark:bg-gray-800 disabled:opacity-60 focus:outline-none focus:ring-2 focus:ring-indigo-500"
            placeholder={isLocal ? 'linkbox-local-hash-v1' : 'text-embedding-3-small'}
            value={config.model}
            disabled={isLocal}
            onChange={(e) => onFieldChange('model', e.target.value)}
          />
        </div>

        <div className="space-y-1.5">
          <label className="text-sm font-medium">API Key</label>
          <input
            type="password"
            autoComplete="new-password"
            className="w-full rounded-lg border px-3 py-2 bg-gray-50 dark:bg-gray-800 disabled:opacity-60 focus:outline-none focus:ring-2 focus:ring-indigo-500"
            placeholder={config.apiKeyConfigured ? '已保存，留空则不修改' : '远程接口需要时填写'}
            value={config.apiKey || ''}
            disabled={isLocal}
            onChange={(e) => onFieldChange('apiKey', e.target.value)}
          />
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <button
          type="button"
          onClick={onSave}
          disabled={saving}
          className="btn-primary flex items-center gap-2"
        >
          <Save className="w-4 h-4" />
          {saving ? '保存中…' : saved ? '已保存 ✓' : '保存 Embedding 配置'}
        </button>
        <button
          type="button"
          onClick={onTest}
          disabled={testing}
          className="btn-secondary flex items-center gap-2"
        >
          <PlugZap className="w-4 h-4" />
          {testing ? '测试中…' : '测试 Embedding'}
        </button>
        {testResult && <span className="text-sm text-green-600">{testResult}</span>}
      </div>
    </div>
  );
}
