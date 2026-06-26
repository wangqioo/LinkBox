import { PlugZap } from 'lucide-react';
import type { AIConfig, AIProvider } from '../api/client';

interface Props {
  title?: string;
  description?: string;
  aiConfig: AIConfig;
  selectedProvider?: AIProvider;
  testingAI: boolean;
  aiTestResult: string;
  onProviderChange: (providerId: string) => void;
  onFieldChange: <K extends keyof AIConfig>(key: K, value: AIConfig[K]) => void;
  onTestAI: () => void;
}

export default function AISettingsPanel({
  title = 'AI 配置',
  description = '像 Hermes 一样先选供应商，LinkBox 会自动填接口地址和默认模型；多数情况下你只需要粘贴 API Key 后保存。',
  aiConfig,
  selectedProvider,
  testingAI,
  aiTestResult,
  onProviderChange,
  onFieldChange,
  onTestAI,
}: Props) {
  return (
    <div className="rounded-xl border p-5 space-y-4">
      <div>
        <h2 className="font-semibold">{title}</h2>
        <p className="text-sm text-gray-500 mt-0.5">
          {description}
        </p>
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        <div className="md:col-span-2 space-y-1.5">
          <label className="text-sm font-medium">供应商</label>
          <select
            className="w-full rounded-lg border px-3 py-2 bg-gray-50 dark:bg-gray-800 focus:outline-none focus:ring-2 focus:ring-indigo-500"
            value={aiConfig.provider}
            onChange={(e) => onProviderChange(e.target.value)}
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
            onChange={(e) => onFieldChange('baseUrl', e.target.value)}
          />
        </div>

        <div className="space-y-1.5">
          <label className="text-sm font-medium">文本模型</label>
          <input
            className="w-full rounded-lg border px-3 py-2 bg-gray-50 dark:bg-gray-800 focus:outline-none focus:ring-2 focus:ring-indigo-500"
            placeholder="Qwen3.5-4B"
            value={aiConfig.model}
            onChange={(e) => onFieldChange('model', e.target.value)}
          />
        </div>

        <div className="space-y-1.5">
          <label className="text-sm font-medium">视觉模型</label>
          <input
            className="w-full rounded-lg border px-3 py-2 bg-gray-50 dark:bg-gray-800 focus:outline-none focus:ring-2 focus:ring-indigo-500"
            placeholder="留空时使用文本模型"
            value={aiConfig.visionModel}
            onChange={(e) => onFieldChange('visionModel', e.target.value)}
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
            onChange={(e) => onFieldChange('apiKey', e.target.value)}
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
            onChange={(e) => onFieldChange('temperature', Number(e.target.value))}
          />
        </div>
      </div>

      <label className="flex items-center gap-2 text-sm">
        <input
          type="checkbox"
          className="rounded border-gray-300 text-indigo-600 focus:ring-indigo-500"
          checked={aiConfig.enableThinking}
          onChange={(e) => onFieldChange('enableThinking', e.target.checked)}
        />
        启用本地 Qwen 思考模式（仅自定义/本地接口会传 enable_thinking）
      </label>

      <div className="flex flex-wrap items-center gap-3">
        <button
          type="button"
          onClick={onTestAI}
          disabled={testingAI}
          className="btn-secondary flex items-center gap-2"
        >
          <PlugZap className="w-4 h-4" />
          {testingAI ? '测试中…' : '测试连接'}
        </button>
        {aiTestResult && <span className="text-sm text-green-600">{aiTestResult}</span>}
      </div>
    </div>
  );
}
