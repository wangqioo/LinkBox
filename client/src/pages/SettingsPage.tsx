import { useState, useEffect } from 'react';
import { api, type AIConfig, type AIProvider, type SystemStatus } from '../api/client';
import { useAuth } from '../context/AuthContext';
import { Save } from 'lucide-react';
import AISettingsPanel from './AISettingsPanel';
import BackgroundJobsPanel from './BackgroundJobsPanel';
import DocumentMaintenancePanel from './DocumentMaintenancePanel';
import SiteCookiesSettings from './SiteCookiesSettings';
import { applyProviderPreset, DEFAULT_AI_CONFIG } from './settingsConfig';
import { useToast } from '../context/ToastContext';

export default function SettingsPage() {
  const { user } = useAuth();
  const toast = useToast();
  const [settings, setSettings] = useState<Record<string, string>>({});
  const [aiConfig, setAIConfig] = useState<AIConfig>(DEFAULT_AI_CONFIG);
  const [saving, setSaving] = useState(false);
  const [testingAI, setTestingAI] = useState(false);
  const [saved, setSaved] = useState(false);
  const [aiTestResult, setAITestResult] = useState('');
  const [systemStatus, setSystemStatus] = useState<SystemStatus | null>(null);
  const [loadingSystem, setLoadingSystem] = useState(false);
  const [retryingJobs, setRetryingJobs] = useState(false);
  const [reindexingDocuments, setReindexingDocuments] = useState(false);
  const [backfillingEmbeddings, setBackfillingEmbeddings] = useState(false);
  const [queueMessage, setQueueMessage] = useState('');
  const [documentMessage, setDocumentMessage] = useState('');
  const [error, setError] = useState('');

  const isAdmin = user?.id === 1;

  useEffect(() => {
    if (!isAdmin) return;
    api.getSettings().then(setSettings).catch(() => {});
    api.getAIConfig()
      .then((config) => setAIConfig({ ...DEFAULT_AI_CONFIG, ...config, apiKey: '' }))
      .catch(() => {});
    refreshSystemStatus();
  }, [isAdmin]);

  const refreshSystemStatus = async () => {
    setLoadingSystem(true);
    setQueueMessage('');
    setDocumentMessage('');
    try {
      setSystemStatus(await api.getSystemStatus());
    } catch (e: any) {
      const message = e.message || '系统状态加载失败';
      setError(message);
      toast.error('系统状态加载失败', message);
    } finally {
      setLoadingSystem(false);
    }
  };

  const handleReindexDocuments = async () => {
    setReindexingDocuments(true);
    setError('');
    setDocumentMessage('');
    try {
      const result = await api.reindexDocuments();
      setSystemStatus((prev) => prev ? { ...prev, documents: result.stats } : prev);
      const message = `已重建 ${result.indexed} 个文档，生成 ${result.chunks} 个切块`;
      setDocumentMessage(message);
      toast.success('文档索引已重建', message);
    } catch (e: any) {
      const message = e.message || '重建文档索引失败';
      setError(message);
      toast.error('重建文档索引失败', message);
    } finally {
      setReindexingDocuments(false);
    }
  };

  const handleBackfillEmbeddings = async () => {
    setBackfillingEmbeddings(true);
    setError('');
    setDocumentMessage('');
    try {
      const result = await api.backfillDocumentEmbeddings();
      setSystemStatus((prev) => prev ? { ...prev, queue: result.queue, documents: result.stats } : prev);
      const message = result.enqueued ? `已入队 ${result.enqueued} 个 embedding 任务` : '没有缺失 embedding 需要补齐';
      setDocumentMessage(message);
      toast.success('Embedding 任务已更新', message);
    } catch (e: any) {
      const message = e.message || '补齐 Embeddings 失败';
      setError(message);
      toast.error('补齐 Embeddings 失败', message);
    } finally {
      setBackfillingEmbeddings(false);
    }
  };

  const handleRetryFailedJobs = async () => {
    setRetryingJobs(true);
    setError('');
    setQueueMessage('');
    try {
      const result = await api.retryFailedJobs();
      setSystemStatus((prev) => prev ? { ...prev, queue: result.queue } : prev);
      const message = result.retried ? `已重新入队 ${result.retried} 个失败任务` : '没有失败任务需要重试';
      setQueueMessage(message);
      toast.success('后台任务已更新', message);
    } catch (e: any) {
      const message = e.message || '重试失败任务失败';
      setError(message);
      toast.error('重试失败任务失败', message);
    } finally {
      setRetryingJobs(false);
    }
  };

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
      toast.success('设置已保存');
      setTimeout(() => setSaved(false), 2000);
    } catch (e: any) {
      const message = e.message || '保存失败';
      setError(message);
      toast.error('保存失败', message);
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
      toast.success('AI 接口连接成功', `${result.provider || aiConfig.provider} / ${result.model}${count}`);
    } catch (e: any) {
      const message = e.message || 'AI 接口测试失败';
      setError(message);
      toast.error('AI 接口测试失败', message);
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

      <SiteCookiesSettings settings={settings} onChange={setSettings} />
      <AISettingsPanel
        aiConfig={aiConfig}
        selectedProvider={selectedProvider}
        testingAI={testingAI}
        aiTestResult={aiTestResult}
        onProviderChange={handleProviderChange}
        onFieldChange={updateAIField}
        onTestAI={handleTestAI}
      />
      <DocumentMaintenancePanel
        stats={systemStatus?.documents || null}
        loading={loadingSystem}
        reindexing={reindexingDocuments}
        backfilling={backfillingEmbeddings}
        message={documentMessage}
        onRefresh={refreshSystemStatus}
        onReindex={handleReindexDocuments}
        onBackfillEmbeddings={handleBackfillEmbeddings}
      />
      <BackgroundJobsPanel
        systemStatus={systemStatus}
        loadingSystem={loadingSystem}
        retryingJobs={retryingJobs}
        queueMessage={queueMessage}
        onRefresh={refreshSystemStatus}
        onRetryFailedJobs={handleRetryFailedJobs}
      />

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
