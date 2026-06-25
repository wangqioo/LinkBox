import { FormEvent, useMemo, useState } from 'react';
import { Activity, Loader2, Search } from 'lucide-react';
import { api, type RetrievalDiagnosticsResponse, type RetrievalDiagnosticsSource } from '../api/client';

const TASKS = [
  { key: 'ask', label: '问资料' },
  { key: 'recent', label: '总结最近' },
  { key: 'report', label: '生成报告' },
  { key: 'organize', label: '整理标签' },
  { key: 'todos', label: '提取待办' },
];

function formatScore(value: unknown) {
  if (typeof value !== 'number' || Number.isNaN(value)) return '—';
  return value.toFixed(3);
}

function formatHeadingPath(value: RetrievalDiagnosticsSource['heading_path'] | RetrievalDiagnosticsSource['headingPath']) {
  if (Array.isArray(value)) return value.filter(Boolean).join(' > ');
  return value || '—';
}

function sourceKind(source: RetrievalDiagnosticsSource) {
  return source.sourceKind || source.source_kind || source.type || 'source';
}

function retrievalModes(source: RetrievalDiagnosticsSource) {
  const modes = source.retrieval_modes || source.retrievalModes || [];
  return modes.length ? modes.join(' + ') : '—';
}

function snippet(source: RetrievalDiagnosticsSource) {
  return source.snippet || source.text || source.summary || '';
}

function scopeSummary(scope: unknown) {
  if (!scope || (typeof scope === 'object' && !Array.isArray(scope) && Object.keys(scope).length === 0)) {
    return '全部资料';
  }
  try {
    return JSON.stringify(scope);
  } catch {
    return '自定义范围';
  }
}

function settingsSummary(settings: RetrievalDiagnosticsResponse['settings']) {
  if (!settings || !Object.keys(settings).length) return '';
  try {
    return JSON.stringify(settings);
  } catch {
    return '已返回检索设置';
  }
}

function AgentDiagnostics({ agent }: { agent?: RetrievalDiagnosticsResponse['agent'] }) {
  if (!agent) return null;
  const tools = agent.plan?.tools || [];
  const subQuestions = agent.plan?.subQuestions || [];
  const memories = agent.memory?.items || [];
  const evidence = agent.evidence?.items || [];
  const issues = agent.verification?.issues || [];
  const steps = agent.run?.steps || [];
  const retrievalStep = steps.find(step => step.step_type === 'retrieval');
  const confidence = agent.verification?.retrievalConfidence || retrievalStep?.metadata?.confidence as { level?: string; score?: number; reasons?: string[] } | undefined;

  return (
    <div className="rounded-lg border bg-gray-50 dark:bg-gray-800 px-3 py-3 space-y-3">
      <div className="flex flex-wrap gap-2 text-xs text-gray-500">
        <span>Intent：{agent.plan?.intent || '—'}</span>
        <span>Evidence：{agent.evidence?.status || '—'}</span>
        <span>Support：{agent.verification?.support || '—'}</span>
        {confidence?.level && <span>Confidence：{confidence.level}{typeof confidence.score === 'number' ? ` ${confidence.score}` : ''}</span>}
        <span>Run：{agent.run?.status || '—'}</span>
      </div>

      {!!tools.length && (
        <div>
          <div className="text-xs font-semibold mb-1">Tools</div>
          <div className="flex flex-wrap gap-1.5">
            {tools.map((tool, index) => (
              <span key={`${tool.name || 'tool'}-${index}`} className="rounded-md border bg-white px-1.5 py-0.5 text-[11px] text-gray-500 dark:bg-gray-900 dark:border-gray-700">
                {tool.name}{tool.reason ? ` · ${tool.reason}` : ''}
              </span>
            ))}
          </div>
        </div>
      )}

      {!!subQuestions.length && (
        <div>
          <div className="text-xs font-semibold mb-1">Sub-questions</div>
          <div className="space-y-1">
            {subQuestions.map((question, index) => (
              <div key={`${question}-${index}`} className="text-xs text-gray-500">
                {index + 1}. {question}
              </div>
            ))}
          </div>
        </div>
      )}

      {confidence?.reasons?.length ? (
        <div>
          <div className="text-xs font-semibold mb-1">Confidence reasons</div>
          <div className="flex flex-wrap gap-1.5">
            {confidence.reasons.map(reason => (
              <span key={reason} className="rounded-md border bg-white px-1.5 py-0.5 text-[11px] text-gray-500 dark:bg-gray-900 dark:border-gray-700">
                {reason}
              </span>
            ))}
          </div>
        </div>
      ) : null}

      {!!memories.length && (
        <div>
          <div className="text-xs font-semibold mb-1">Memory</div>
          <div className="space-y-1">
            {memories.map((memory, index) => (
              <div key={memory.id || index} className="text-xs text-gray-500">
                {memory.memory_type || 'note'}：{memory.content}
              </div>
            ))}
          </div>
        </div>
      )}

      {!!evidence.length && (
        <div>
          <div className="text-xs font-semibold mb-1">Evidence Notebook</div>
          <div className="space-y-1">
            {evidence.slice(0, 4).map((item, index) => (
              <div key={`${item.citation || 'evidence'}-${index}`} className="text-xs text-gray-500">
                {item.citation || `[${index + 1}]`} {item.title || 'Untitled'}{item.supportReason ? ` · ${item.supportReason}` : ''}
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="grid grid-cols-1 md:grid-cols-2 gap-2 text-xs text-gray-500">
        <div>Issues：{issues.length ? issues.join(', ') : '—'}</div>
        <div>Steps：{steps.map(step => step.step_type).filter(Boolean).join(' → ') || '—'}</div>
      </div>
    </div>
  );
}

export default function RetrievalDiagnosticsPanel() {
  const [question, setQuestion] = useState('');
  const [task, setTask] = useState('ask');
  const [scopeText, setScopeText] = useState('{}');
  const [result, setResult] = useState<RetrievalDiagnosticsResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const parsedScope = useMemo(() => {
    try {
      return { ok: true as const, value: scopeText.trim() ? JSON.parse(scopeText) : {} };
    } catch {
      return { ok: false as const, value: null };
    }
  }, [scopeText]);

  const runDiagnostics = async (event: FormEvent) => {
    event.preventDefault();
    const trimmedQuestion = question.trim();
    if (!trimmedQuestion || loading || !parsedScope.ok) return;

    setLoading(true);
    setError('');
    try {
      const diagnostics = await api.getRetrievalDiagnostics({
        question: trimmedQuestion,
        task,
        scope: parsedScope.value,
      });
      setResult(diagnostics);
    } catch (e) {
      setError(e instanceof Error ? e.message : '检索诊断失败');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="rounded-xl border p-5 space-y-4">
      <div>
        <h2 className="font-semibold flex items-center gap-2">
          <Activity className="w-4 h-4 text-violet-500" />
          检索诊断
        </h2>
        <p className="text-sm text-gray-500 mt-0.5">
          只运行资料检索，不调用 LLM，用于查看资料助理会选中哪些来源和切块。
        </p>
      </div>

      <form onSubmit={runDiagnostics} className="space-y-3">
        <div>
          <label className="block text-sm font-medium mb-1" htmlFor="retrieval-diagnostics-question">
            查询
          </label>
          <input
            id="retrieval-diagnostics-question"
            className="input"
            value={question}
            onChange={(event) => setQuestion(event.target.value)}
            placeholder="输入要诊断的资料问题"
            disabled={loading}
          />
        </div>

        <div className="grid grid-cols-1 md:grid-cols-[minmax(0,12rem),1fr] gap-3">
          <div>
            <label className="block text-sm font-medium mb-1" htmlFor="retrieval-diagnostics-task">
              任务
            </label>
            <select
              id="retrieval-diagnostics-task"
              className="input"
              value={task}
              onChange={(event) => setTask(event.target.value)}
              disabled={loading}
            >
              {TASKS.map((item) => (
                <option key={item.key} value={item.key}>{item.label}</option>
              ))}
            </select>
          </div>

          <div>
            <label className="block text-sm font-medium mb-1" htmlFor="retrieval-diagnostics-scope">
              Scope JSON
            </label>
            <textarea
              id="retrieval-diagnostics-scope"
              className="input min-h-10 resize-y font-mono"
              value={scopeText}
              onChange={(event) => setScopeText(event.target.value)}
              disabled={loading}
              spellCheck={false}
            />
          </div>
        </div>

        {!parsedScope.ok && (
          <div className="text-sm text-red-600">Scope 必须是合法 JSON。</div>
        )}

        <button
          type="submit"
          className="btn-primary"
          disabled={loading || !question.trim() || !parsedScope.ok}
        >
          {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Search className="w-4 h-4" />}
          {loading ? '诊断中…' : '运行诊断'}
        </button>
      </form>

      {error && (
        <div className="text-sm text-red-600 bg-red-50 dark:bg-red-900/20 rounded-lg px-4 py-2">
          {error}
        </div>
      )}

      {result && (
        <div className="space-y-3">
          <div className="rounded-lg border bg-gray-50 dark:bg-gray-800 px-3 py-2 text-xs text-gray-500">
            Query：{result.query} · Task：{result.task} · Scope：{scopeSummary(result.scope)}
            {settingsSummary(result.settings) ? ` · Settings：${settingsSummary(result.settings)}` : ''}
          </div>

          <AgentDiagnostics agent={result.agent} />

          <div className="space-y-2">
            {result.sources.length ? result.sources.map((source, index) => (
              <div key={`${sourceKind(source)}-${source.chunk_id || source.id || source.source_index || index}`} className="rounded-lg border px-3 py-3 space-y-2">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="text-sm font-semibold truncate">
                      {index + 1}. {source.title || `Source ${source.source_index ?? index + 1}`}
                    </div>
                    <div className="text-xs text-gray-500 mt-0.5">
                      {sourceKind(source)} · {retrievalModes(source)}
                    </div>
                  </div>
                  <div className="text-right text-xs text-gray-500 shrink-0">
                    <div>score {formatScore(source.score)}</div>
                    <div>combined {formatScore(source.combined_score)}</div>
                    <div>embed {formatScore(source.embedding_score)}</div>
                    {source.rerank_score !== undefined && <div>rerank {formatScore(source.rerank_score)}</div>}
                  </div>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-2 text-xs text-gray-500">
                  <div>Heading：{formatHeadingPath(source.heading_path || source.headingPath)}</div>
                  <div>
                    Chunk：{source.chunk_id ?? '—'}
                    {source.chunk_type ? ` · ${source.chunk_type}` : ''}
                    {source.rerank_mode ? ` · ${source.rerank_mode}` : ''}
                  </div>
                </div>

                {snippet(source) && (
                  <div className="rounded-md bg-gray-50 dark:bg-gray-800 px-3 py-2 text-xs text-gray-600 dark:text-gray-300 whitespace-pre-wrap">
                    {snippet(source)}
                  </div>
                )}
              </div>
            )) : (
              <div className="rounded-lg border px-3 py-4 text-sm text-gray-500">
                没有返回诊断来源。
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
