import { Database, FileStack, RefreshCw, Rows3 } from 'lucide-react';
import type { DocumentMaintenanceStats } from '../api/client';
import { consistencyIssueTotal, issueSampleLabel } from './documentMaintenanceUtils';

interface Props {
  stats: DocumentMaintenanceStats | null;
  loading: boolean;
  reindexing: boolean;
  backfilling: boolean;
  backfillingUnderstanding: boolean;
  message: string;
  onRefresh: () => void;
  onReindex: () => void;
  onBackfillEmbeddings: () => void;
  onBackfillUnderstanding: () => void;
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
  backfillingUnderstanding,
  message,
  onRefresh,
  onReindex,
  onBackfillEmbeddings,
  onBackfillUnderstanding,
}: Props) {
  const configuredEmbedding = embeddingConfigLabel(stats);
  const consistencyTotal = consistencyIssueTotal(stats);
  const consistencyRows = [
    ['缺失 Documents', stats?.consistency?.missing_documents],
    ['缺失 Content rows', stats?.consistency?.missing_content_rows],
    ['缺失 Asset rows', stats?.consistency?.missing_asset_rows],
  ] as const;

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

      {stats?.item_understanding && (
        <div className="rounded-lg border px-3 py-3 space-y-3">
          <div className="flex items-start justify-between gap-3">
            <div>
              <div className="text-sm font-medium">结构化理解</div>
              <div className="text-xs text-gray-500">
                为 Assistant 生成实体、主题、待办和主张，用于可解释检索 fallback。
              </div>
            </div>
            <div className={stats.item_understanding.missing_items ? 'text-sm font-semibold text-amber-600' : 'text-sm font-semibold text-green-600'}>
              {stats.item_understanding.missing_items ? `${number(stats.item_understanding.missing_items)} 个待补齐` : '已补齐'}
            </div>
          </div>

          <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
            {[
              ['已处理', stats.item_understanding.processed_items],
              ['实体', stats.item_understanding.entities],
              ['主题', stats.item_understanding.topics],
              ['待办', stats.item_understanding.todos],
              ['主张', stats.item_understanding.claims],
            ].map(([label, value]) => (
              <div key={label} className="rounded-md bg-gray-50 dark:bg-gray-800 px-3 py-2">
                <div className="text-xs text-gray-500">{label}</div>
                <div className="text-base font-semibold">{number(Number(value || 0))}</div>
              </div>
            ))}
          </div>
        </div>
      )}

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

      {stats?.consistency && (
        <div className="rounded-lg border px-3 py-3 space-y-3">
          <div className="flex items-start justify-between gap-3">
            <div>
              <div className="text-sm font-medium">存储一致性</div>
              <div className="text-xs text-gray-500">
                检查 legacy 字段与 canonical documents、item_content、item_assets 的缺口。
              </div>
            </div>
            <div className={consistencyTotal ? 'text-sm font-semibold text-amber-600' : 'text-sm font-semibold text-green-600'}>
              {consistencyTotal ? `${number(consistencyTotal)} 个缺口` : '正常'}
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-2">
            {consistencyRows.map(([label, bucket]) => (
              <div key={label} className="rounded-md bg-gray-50 dark:bg-gray-800 px-3 py-2">
                <div className="text-xs text-gray-500">{label}</div>
                <div className="text-base font-semibold">{number(bucket?.count)}</div>
              </div>
            ))}
          </div>

          {consistencyRows.some(([, bucket]) => bucket?.samples?.length) && (
            <div className="space-y-2 text-xs text-gray-500">
              {consistencyRows.map(([label, bucket]) => bucket?.samples?.length ? (
                <div key={label}>
                  <div className="font-medium text-gray-600 dark:text-gray-300">{label} 样本</div>
                  <ul className="mt-1 space-y-1">
                    {bucket.samples.map((sample) => (
                      <li key={`${label}-${sample.id}-${sample.kind || ''}-${sample.public_path || ''}`} className="truncate">
                        {issueSampleLabel(sample)}
                      </li>
                    ))}
                  </ul>
                </div>
              ) : null)}
            </div>
          )}
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
        <button
          type="button"
          onClick={onBackfillUnderstanding}
          disabled={backfillingUnderstanding || !stats?.item_understanding?.missing_items}
          className="btn-secondary flex items-center gap-2"
        >
          <Rows3 className="w-4 h-4" />
          {backfillingUnderstanding ? '补齐中…' : '补齐结构化理解'}
        </button>
        {message && <span className="text-sm text-green-600">{message}</span>}
      </div>
    </div>
  );
}
