import { useEffect, useMemo, useState } from 'react';
import { Braces, FileSearch, ListTree, Loader2, RefreshCw, Sparkles, X } from 'lucide-react';
import { api, type DocumentInspection } from '../api/client';

interface Props {
  linkId: number;
  title: string;
  onClose: () => void;
}

function shortHash(hash = '') {
  return hash ? hash.slice(0, 12) : '';
}

function formatNumber(value: number | undefined) {
  return new Intl.NumberFormat().format(value || 0);
}

function formatAnnotationContent(raw: string) {
  try {
    return JSON.stringify(JSON.parse(raw), null, 2);
  } catch {
    return raw;
  }
}

export default function DocumentInspectorModal({ linkId, title, onClose }: Props) {
  const [data, setData] = useState<DocumentInspection | null>(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const [runningAction, setRunningAction] = useState('');
  const [activeChunk, setActiveChunk] = useState<number | null>(null);

  const selectedChunk = useMemo(() => {
    if (!data?.chunks.length) return null;
    return data.chunks.find(chunk => chunk.id === activeChunk) || data.chunks[0];
  }, [activeChunk, data]);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError('');
    api.getLinkDocument(linkId)
      .then(result => {
        if (cancelled) return;
        setData(result);
        setActiveChunk(result.chunks[0]?.id ?? null);
      })
      .catch(err => {
        if (!cancelled) setError(err.message || '文档加载失败');
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => { cancelled = true; };
  }, [linkId]);

  const runAction = async (action: 'rechunk' | 'reindex' | 'annotate') => {
    if (runningAction) return;
    setRunningAction(action);
    setError('');
    try {
      const result = action === 'rechunk'
        ? await api.rechunkLinkDocument(linkId)
        : action === 'annotate'
          ? await api.annotateLinkDocument(linkId)
          : await api.reindexLinkDocument(linkId);
      setData(result);
      setActiveChunk(result.chunks[0]?.id ?? null);
    } catch (err: any) {
      setError(err.message || '文档操作失败');
    } finally {
      setRunningAction('');
    }
  };

  const disabledActions = Boolean(runningAction || loading);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm">
      <div className="bg-white dark:bg-gray-900 rounded-2xl shadow-2xl w-full max-w-6xl max-h-[88vh] flex flex-col overflow-hidden">
        <div className="flex items-center justify-between gap-3 px-5 py-4 border-b border-gray-200 dark:border-gray-700">
          <div className="flex items-center gap-2 min-w-0">
            <FileSearch className="w-4 h-4 text-indigo-500 shrink-0" />
            <div className="min-w-0">
              <div className="font-semibold text-sm truncate">{title}</div>
              <div className="text-[11px] text-gray-400">Document / chunks</div>
            </div>
          </div>
          <div className="flex flex-wrap items-center justify-end gap-2 shrink-0">
            <button
              onClick={() => runAction('rechunk')}
              disabled={disabledActions}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs bg-gray-100 dark:bg-gray-800 text-gray-600 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-700 transition-colors disabled:opacity-50"
            >
              {runningAction === 'rechunk' ? <Loader2 className="w-3 h-3 animate-spin" /> : <ListTree className="w-3 h-3" />}
              重新切块
            </button>
            <button
              onClick={() => runAction('reindex')}
              disabled={disabledActions}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs bg-indigo-50 dark:bg-indigo-900/30 text-indigo-600 dark:text-indigo-300 hover:bg-indigo-100 transition-colors disabled:opacity-50"
            >
              {runningAction === 'reindex' ? <Loader2 className="w-3 h-3 animate-spin" /> : <RefreshCw className="w-3 h-3" />}
              重建索引
            </button>
            <button
              onClick={() => runAction('annotate')}
              disabled={disabledActions}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs bg-purple-50 dark:bg-purple-900/30 text-purple-600 dark:text-purple-300 hover:bg-purple-100 transition-colors disabled:opacity-50"
            >
              {runningAction === 'annotate' ? <Loader2 className="w-3 h-3 animate-spin" /> : <Sparkles className="w-3 h-3" />}
              生成标注
            </button>
            <button onClick={onClose} className="btn-ghost p-1.5">
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>

        <div className="flex-1 min-h-0 overflow-hidden">
          {loading ? (
            <div className="h-80 flex items-center justify-center">
              <Loader2 className="w-6 h-6 animate-spin text-indigo-500" />
            </div>
          ) : error ? (
            <div className="p-6">
              <div className="rounded-lg border border-red-200 bg-red-50 dark:border-red-900 dark:bg-red-950/30 px-4 py-3 text-sm text-red-600 dark:text-red-300">
                {error}
              </div>
            </div>
          ) : data && (
            <div className="grid grid-cols-1 lg:grid-cols-[280px_1fr] h-full min-h-0">
              <aside className="border-b lg:border-b-0 lg:border-r border-gray-200 dark:border-gray-700 overflow-y-auto p-4 space-y-4">
                <div className="grid grid-cols-2 gap-2">
                  <div className="rounded-lg bg-gray-50 dark:bg-gray-800 px-3 py-2">
                    <div className="text-[11px] text-gray-400">Chunks</div>
                    <div className="text-lg font-semibold">{formatNumber(data.stats.chunk_count)}</div>
                  </div>
                  <div className="rounded-lg bg-gray-50 dark:bg-gray-800 px-3 py-2">
                    <div className="text-[11px] text-gray-400">Tokens</div>
                    <div className="text-lg font-semibold">{formatNumber(data.stats.token_count)}</div>
                  </div>
                </div>

                <div className="text-xs text-gray-500 dark:text-gray-400 space-y-1.5">
                  <div>Parser: <span className="font-mono">{data.document.parser_version}</span></div>
                  <div>Status: <span className="font-mono">{data.document.status}</span></div>
                  <div>Hash: <span className="font-mono">{shortHash(data.document.markdown_hash)}</span></div>
                  <div>Updated: <span className="font-mono">{data.document.updated_at}</span></div>
                </div>

                <div className="rounded-lg border border-gray-200 dark:border-gray-700 px-3 py-2">
                  <div className="flex items-center justify-between gap-2">
                    <div className="text-[11px] font-medium text-gray-400 uppercase tracking-wide">Embeddings</div>
                    <div className="text-xs font-semibold">
                      {formatNumber(data.embeddings.indexed)} / {formatNumber(data.stats.chunk_count)}
                    </div>
                  </div>
                  {data.embeddings.models.length > 0 ? (
                    <div className="mt-2 space-y-1">
                      {data.embeddings.models.map(model => (
                        <div key={`${model.provider}-${model.model}`} className="text-[11px] text-gray-500 dark:text-gray-400">
                          <span className="font-mono">{model.provider}/{model.model}</span>
                          <span className="text-gray-400"> · {model.dimension}d · {formatNumber(model.count)}</span>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <div className="mt-1 text-[11px] text-gray-400">Not indexed</div>
                  )}
                  {data.embeddings.missing > 0 && (
                    <div className="mt-1 text-[11px] text-amber-600 dark:text-amber-300">
                      Missing {formatNumber(data.embeddings.missing)} chunks
                    </div>
                  )}
                </div>

                {data.annotations.length > 0 && (
                  <div>
                    <div className="text-[11px] font-medium text-gray-400 uppercase tracking-wide mb-2">Annotations</div>
                    <div className="space-y-2">
                      {data.annotations.slice(0, 4).map(annotation => (
                        <div key={annotation.id} className="rounded-lg border border-gray-200 dark:border-gray-700 px-3 py-2">
                          <div className="flex items-center justify-between gap-2">
                            <span className="text-xs font-medium">{annotation.type}</span>
                            <span className="text-[10px] text-gray-400">{annotation.model}</span>
                          </div>
                          <div className="mt-1 text-[11px] text-gray-400 font-mono truncate">{annotation.created_at}</div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                <div>
                  <div className="text-[11px] font-medium text-gray-400 uppercase tracking-wide mb-2">Chunk List</div>
                  <div className="space-y-2">
                    {data.chunks.map(chunk => (
                      <button
                        key={chunk.id}
                        onClick={() => setActiveChunk(chunk.id)}
                        className={`w-full text-left rounded-lg border px-3 py-2 transition-colors ${
                          selectedChunk?.id === chunk.id
                            ? 'border-indigo-300 bg-indigo-50 dark:border-indigo-700 dark:bg-indigo-950/40'
                            : 'border-gray-200 dark:border-gray-700 hover:bg-gray-50 dark:hover:bg-gray-800'
                        }`}
                      >
                        <div className="flex items-center justify-between gap-2">
                          <span className="text-xs font-medium">#{chunk.chunk_index + 1}</span>
                          <span className="text-[10px] px-1.5 py-0.5 rounded bg-gray-100 dark:bg-gray-800 text-gray-500">
                            {chunk.chunk_type}
                          </span>
                        </div>
                        <div className="mt-1 text-xs text-gray-500 line-clamp-2">{chunk.heading_path || '(root)'}</div>
                      </button>
                    ))}
                  </div>
                </div>
              </aside>

              <main className="min-h-0 overflow-y-auto p-4 space-y-4">
                {selectedChunk && (
                  <section className="rounded-xl border border-gray-200 dark:border-gray-700 overflow-hidden">
                    <div className="flex items-center justify-between gap-3 px-4 py-3 border-b border-gray-200 dark:border-gray-700">
                      <div className="min-w-0">
                        <div className="text-xs text-gray-400">Selected Chunk</div>
                        <div className="text-sm font-medium truncate">{selectedChunk.heading_path || '(root)'}</div>
                      </div>
                      <div className="text-[11px] text-gray-400 shrink-0">
                        {selectedChunk.token_count} tokens · {selectedChunk.char_start}-{selectedChunk.char_end}
                      </div>
                    </div>
                    <pre className="p-4 text-xs leading-5 whitespace-pre-wrap break-words bg-gray-50 dark:bg-gray-950 overflow-x-auto">
                      {selectedChunk.content}
                    </pre>
                  </section>
                )}

                <section className="rounded-xl border border-gray-200 dark:border-gray-700 overflow-hidden">
                  <div className="flex items-center gap-2 px-4 py-3 border-b border-gray-200 dark:border-gray-700">
                    <Braces className="w-3.5 h-3.5 text-gray-400" />
                    <div className="text-sm font-medium">Canonical Markdown</div>
                    <div className="text-xs text-gray-400 ml-auto">{formatNumber(data.stats.markdown_chars)} chars</div>
                  </div>
                  <pre className="p-4 text-xs leading-5 whitespace-pre-wrap break-words bg-gray-50 dark:bg-gray-950 overflow-x-auto">
                    {data.document.markdown}
                  </pre>
                </section>

                {data.annotations.length > 0 && (
                  <section className="rounded-xl border border-gray-200 dark:border-gray-700 overflow-hidden">
                    <div className="flex items-center gap-2 px-4 py-3 border-b border-gray-200 dark:border-gray-700">
                      <Sparkles className="w-3.5 h-3.5 text-purple-400" />
                      <div className="text-sm font-medium">Latest Annotation</div>
                    </div>
                    <pre className="p-4 text-xs leading-5 whitespace-pre-wrap break-words bg-gray-50 dark:bg-gray-950 overflow-x-auto">
                      {formatAnnotationContent(data.annotations[0].content_json)}
                    </pre>
                  </section>
                )}
              </main>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
