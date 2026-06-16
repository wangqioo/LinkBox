import { Database, FileStack, RefreshCw, Rows3 } from 'lucide-react';
import type { DocumentMaintenanceStats } from '../api/client';

interface Props {
  stats: DocumentMaintenanceStats | null;
  loading: boolean;
  reindexing: boolean;
  backfilling: boolean;
  message: string;
  onRefresh: () => void;
  onReindex: () => void;
  onBackfillEmbeddings: () => void;
}

function number(value: number | undefined) {
  return new Intl.NumberFormat().format(value || 0);
}

function embeddingConfigLabel(stats: DocumentMaintenanceStats | null) {
  const provider = stats?.embedding_target?.provider
    || stats?.embedding_provider
    || stats?.embeddingProvider
    || stats?.embedding_config?.provider;
  const model = stats?.embedding_target?.model
    || stats?.embedding_model
    || stats?.embeddingModel
    || stats?.embedding_config?.model;
  if (!provider && !model) return '';
  return [provider, model].filter(Boolean).join(' / ');
}

export default function DocumentMaintenancePanel({
  stats,
  loading,
  reindexing,
  backfilling,
  message,
  onRefresh,
  onReindex,
  onBackfillEmbeddings,
}: Props) {
  const configuredEmbedding = embeddingConfigLabel(stats);

  return (
    <div className="rounded-xl border p-5 space-y-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h2 className="font-semibold flex items-center gap-2">
            <FileStack className="w-4 h-4 text-emerald-500" />
            文档知识库
          </h2>
          <p className="text-sm text-gray-500 mt-0.5">
            维护 canonical Markdown、语义切块和可选 embedding 索引。
          </p>
        </div>
        <button
          type="button"
          onClick={onRefresh}
          disabled={loading}
          className="btn-secondary flex items-center gap-2 shrink-0"
        >
          <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
          刷新
        </button>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        {[
          ['可索引资料', stats?.items_with_content],
          ['Documents', stats?.documents],
          ['Chunks', stats?.chunks],
          ['Embeddings', stats?.embeddings],
        ].map(([label, value]) => (
          <div key={label} className="rounded-lg border bg-gray-50 dark:bg-gray-800 px-3 py-2">
            <div className="text-xs text-gray-500">{label}</div>
            <div className="text-lg font-semibold">{number(Number(value || 0))}</div>
          </div>
        ))}
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-3 text-sm">
        <div className="rounded-lg border px-3 py-2">
          <div className="text-xs text-gray-500">缺失文档</div>
          <div className="text-lg font-semibold">{number(stats?.missing_documents)}</div>
        </div>
        <div className="rounded-lg border px-3 py-2">
          <div className="text-xs text-gray-500">缺失 Embeddings</div>
          <div className="text-lg font-semibold">{number(stats?.missing_embeddings)}</div>
        </div>
      </div>

      {stats && (
        <div className="space-y-1 text-xs text-gray-500">
          {configuredEmbedding && (
            <div>当前 Embedding：{configuredEmbedding}</div>
          )}
          <div>
            Embedding jobs：等待 {number(stats.embedding_jobs.queued)} · 运行 {number(stats.embedding_jobs.running)} · 完成 {number(stats.embedding_jobs.done)} · 失败 {number(stats.embedding_jobs.failed)}
          </div>
        </div>
      )}

      <div className="flex flex-wrap items-center gap-3">
        <button
          type="button"
          onClick={onReindex}
          disabled={reindexing}
          className="btn-secondary flex items-center gap-2"
        >
          <Rows3 className="w-4 h-4" />
          {reindexing ? '重建中…' : '重建文档索引'}
        </button>
        <button
          type="button"
          onClick={onBackfillEmbeddings}
          disabled={backfilling || !stats?.missing_embeddings}
          className="btn-secondary flex items-center gap-2"
        >
          <Database className="w-4 h-4" />
          {backfilling ? '入队中…' : '补齐 Embeddings'}
        </button>
        {message && <span className="text-sm text-green-600">{message}</span>}
      </div>
    </div>
  );
}
