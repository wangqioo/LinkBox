import { AlertTriangle, Bot, Check, ClipboardList, RefreshCw, Sparkles, X } from 'lucide-react';
import type { LocalAgentNextAction, LocalAgentRule, LocalAgentStatus, LocalAgentSuggestion } from '../api/client';
import {
  actionSeverityLabel,
  formatJobCounts,
  formatPercent,
  maturityPercent,
  maturityRows,
  ruleActionSummary,
  suggestionActionLabel,
  suggestionEvidenceSummary,
} from './localAgentWorkbenchUtils';

interface Props {
  status: LocalAgentStatus | null;
  loading: boolean;
  generatingReport: boolean;
  generatingSuggestions: boolean;
  runningAutopilot: boolean;
  resolvingSuggestionId: number | null;
  message: string;
  onRefresh: () => void;
  onGenerateReport: () => void;
  onGenerateSuggestions: () => void;
  onRunAutopilot: () => void;
  onResolveSuggestion: (id: number, action: 'accept' | 'reject') => void;
}

function number(value: number | undefined) {
  return new Intl.NumberFormat().format(value || 0);
}

function suggestionTitle(suggestion: LocalAgentSuggestion) {
  const proposal = suggestion.proposal || {};
  return String(proposal.title || proposal.topic || suggestion.reason || suggestionActionLabel(suggestion.suggestion_type));
}

function metric(label: string, value: number | undefined, detail: string) {
  return (
    <div className="rounded-lg border px-3 py-2">
      <div className="text-xs text-gray-500">{label}</div>
      <div className="text-lg font-semibold">{number(value)}</div>
      <div className="text-xs text-gray-500 mt-0.5 truncate">{detail}</div>
    </div>
  );
}

function severityClass(action: LocalAgentNextAction) {
  if (action.severity === 'high') {
    return 'border-red-200 bg-red-50 text-red-700 dark:border-red-900 dark:bg-red-950 dark:text-red-200';
  }
  if (action.severity === 'medium') {
    return 'border-amber-200 bg-amber-50 text-amber-700 dark:border-amber-900 dark:bg-amber-950 dark:text-amber-200';
  }
  return 'border-gray-200 bg-gray-50 text-gray-600 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-300';
}

function runTimeLabel(value?: string) {
  return value ? new Date(value).toLocaleString() : '未完成';
}

function ruleSource(rule: LocalAgentRule) {
  return rule.sourceItemTitle || String(rule.sourceSuggestion?.proposal?.topic || '') || '本地建议';
}

export default function LocalAgentWorkbenchPanel({
  status,
  loading,
  generatingReport,
  generatingSuggestions,
  resolvingSuggestionId,
  message,
  onRefresh,
  onGenerateReport,
  onGenerateSuggestions,
  onResolveSuggestion,
}: Props) {
  const total = status?.coverage.total || 0;
  const rows = maturityRows(status?.coverage.states || {});
  const readyPercent = maturityPercent(status?.coverage.ready || 0, total);
  const jobs = status?.jobs;
  const failedJobs = jobs?.failed || [];
  const nextActions = status?.nextActions || [];
  const runs = status?.runs || [];

  return (
    <div className="rounded-xl border p-5 space-y-4">
      <div className="flex flex-col md:flex-row md:items-start md:justify-between gap-3">
        <div>
          <h2 className="font-semibold flex items-center gap-2">
            <Bot className="w-4 h-4 text-indigo-500" />
            本地 Agent 工作台
          </h2>
          <p className="text-sm text-gray-500 mt-0.5">
            查看资料加工阻塞、下一步行动和已学习规则。
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={onGenerateSuggestions}
            disabled={generatingSuggestions}
            className="btn-secondary"
          >
            {generatingSuggestions ? '生成中...' : '生成主题建议'}
          </button>
          <button
            type="button"
            onClick={onGenerateReport}
            disabled={generatingReport}
            className="btn-secondary flex items-center gap-2"
          >
            <Sparkles className="w-4 h-4" />
            {generatingReport ? '生成中...' : '生成报告'}
          </button>
          <button
            type="button"
            onClick={onRefresh}
            disabled={loading}
            className="btn-secondary flex items-center gap-2"
          >
            <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
            刷新
          </button>
        </div>
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        {metric('可调用资料', status?.coverage.ready, `${number(total)} 条总资料`)}
        {metric('待确认', status?.coverage.reviewNeeded, `${number(status?.suggestions?.length)} 条建议`)}
        {metric('失败任务', jobs?.counts.failed, formatJobCounts(jobs?.counts))}
        {metric('活跃规则', status?.rules?.length, '已沉淀的本地偏好')}
      </div>

      <div className="rounded-lg border px-3 py-3 space-y-3">
        <div className="flex items-center gap-2">
          <ClipboardList className="w-4 h-4 text-indigo-500" />
          <div className="text-sm font-medium">下一步行动</div>
        </div>
        {nextActions.length ? (
          <div className="space-y-2">
            {nextActions.map((action) => {
              const severity = actionSeverityLabel(action.severity);
              return (
                <div key={`${action.kind}-${action.action}`} className={`rounded-md border px-3 py-2 ${severityClass(action)}`}>
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="text-sm font-medium">{action.title}</div>
                      <div className="text-xs mt-0.5 opacity-80">{action.detail}</div>
                    </div>
                    <span className="text-xs shrink-0">{severity.label}</span>
                  </div>
                </div>
              );
            })}
          </div>
        ) : (
          <div className="text-sm text-gray-500">暂无需要处理的行动。</div>
        )}
      </div>

      <div className="rounded-lg border bg-gray-50 dark:bg-gray-800 px-4 py-3">
        <div className="flex items-center justify-between gap-3">
          <div>
            <div className="text-sm text-gray-500">知识工厂成熟度</div>
            <div className="text-2xl font-semibold">{formatPercent(readyPercent)}</div>
          </div>
          <div className="text-right text-sm text-gray-500">
            <div>{number(status?.coverage.ready)} 条可调用</div>
            <div>{number(total)} 条总资料</div>
          </div>
        </div>
        <div className="mt-3 h-2 rounded-full bg-gray-200 dark:bg-gray-700 overflow-hidden">
          <div className="h-full bg-indigo-500" style={{ width: formatPercent(readyPercent) }} />
        </div>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        {rows.map((row) => (
          <div key={row.key} className="rounded-lg border px-3 py-2">
            <div className="text-xs text-gray-500">{row.label}</div>
            <div className="text-lg font-semibold">{number(row.value)}</div>
          </div>
        ))}
      </div>

      {!!failedJobs.length && (
        <div className="rounded-lg border px-3 py-3 space-y-2">
          <div className="flex items-center gap-2 text-sm font-medium">
            <AlertTriangle className="w-4 h-4 text-red-500" />
            最近失败任务
          </div>
          <div className="space-y-2">
            {failedJobs.map((job) => (
              <div key={job.id} className="rounded-md bg-gray-50 dark:bg-gray-800 px-3 py-2">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="text-sm font-medium truncate">{job.itemTitle || job.type}</div>
                    <div className="text-xs text-gray-500 mt-0.5">{job.type} · {runTimeLabel(job.updatedAt)}</div>
                    {job.lastError && <div className="text-xs text-gray-500 mt-1 line-clamp-2">{job.lastError}</div>}
                  </div>
                  <div className="text-xs text-gray-500 shrink-0">
                    {number(job.attempts)} / {number(job.maxAttempts)}
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="grid lg:grid-cols-2 gap-3">
        <div className="rounded-lg border px-3 py-3 space-y-2">
          <div>
            <div className="text-sm font-medium">最近报告</div>
            <div className="text-xs text-gray-500">
              {status?.latestReport?.createdAt ? new Date(status.latestReport.createdAt).toLocaleString() : '尚未生成报告'}
            </div>
          </div>
          <div className="text-sm text-gray-600 dark:text-gray-300">
            {status?.latestReport?.content?.headline || '本地 Agent 会基于队列、成熟度、建议和规则生成工作报告。'}
          </div>
        </div>
        <div className="rounded-lg border px-3 py-3 space-y-2">
          <div className="text-sm font-medium">最近运行</div>
          {runs.length ? (
            <div className="space-y-1">
              {runs.slice(0, 3).map((run) => (
                <div key={run.id} className="flex items-center justify-between gap-3 text-sm">
                  <span className="truncate">{run.runType || 'local_agent.run'}</span>
                  <span className="text-xs text-gray-500 shrink-0">
                    {run.status} · {runTimeLabel(run.completedAt || run.createdAt)}
                  </span>
                </div>
              ))}
            </div>
          ) : (
            <div className="text-sm text-gray-500">暂无运行记录。</div>
          )}
        </div>
      </div>

      <div className="rounded-lg border px-3 py-3 space-y-3">
        <div className="flex items-start justify-between gap-3">
          <div>
            <div className="text-sm font-medium">待确认建议</div>
            <div className="text-xs text-gray-500">接受建议会沉淀成本地整理规则。</div>
          </div>
          <button
            type="button"
            onClick={onGenerateSuggestions}
            disabled={generatingSuggestions}
            className="btn-secondary"
          >
            {generatingSuggestions ? '生成中…' : '生成主题建议'}
          </button>
        </div>
        {(status?.suggestions || []).length ? (
          <div className="space-y-2">
            {(status?.suggestions || []).map((suggestion) => (
              <div key={suggestion.id} className="rounded-md bg-gray-50 dark:bg-gray-800 px-3 py-2">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="text-sm font-medium truncate">{suggestionTitle(suggestion)}</div>
                    <div className="text-xs text-gray-500 mt-0.5">
                      {suggestionActionLabel(suggestion.suggestion_type)} · 置信度 {Math.round(Number(suggestion.confidence || 0) * 100)}%
                    </div>
                    <div className="text-xs text-gray-500 mt-1 truncate">
                      {suggestion.itemTitle || suggestionEvidenceSummary(suggestion.evidence)}
                    </div>
                    {suggestion.reason && <div className="text-xs text-gray-500 mt-1 line-clamp-2">{suggestion.reason}</div>}
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    <button
                      type="button"
                      className="btn-secondary px-2 py-1"
                      disabled={resolvingSuggestionId === suggestion.id}
                      onClick={() => onResolveSuggestion(suggestion.id, 'reject')}
                    >
                      <X className="w-3 h-3" />
                    </button>
                    <button
                      type="button"
                      className="btn-primary px-2 py-1"
                      disabled={resolvingSuggestionId === suggestion.id}
                      onClick={() => onResolveSuggestion(suggestion.id, 'accept')}
                    >
                      <Check className="w-3 h-3" />
                    </button>
                  </div>
                </div>
              </div>
            ))}
          </div>
        ) : (
          <div className="text-sm text-gray-500">暂无待确认建议。</div>
        )}
      </div>

      <div className="rounded-lg border px-3 py-3">
        <div className="text-sm font-medium">已学习规则</div>
        <div className="text-xs text-gray-500 mt-0.5">
          {status?.rules?.length ? `${number(status.rules.length)} 条活跃规则` : '接受建议后会在这里出现本地整理规则。'}
        </div>
        {!!status?.rules?.length && (
          <div className="mt-2 space-y-2">
            {status.rules.slice(0, 5).map((rule) => (
              <div key={rule.id} className="rounded-md bg-gray-50 dark:bg-gray-800 px-3 py-2">
                <div className="text-sm font-medium truncate">{rule.title}</div>
                <div className="text-xs text-gray-500 mt-0.5 truncate">
                  {ruleActionSummary(rule.action)} · 来源：{ruleSource(rule)}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {message && <div className="text-sm text-green-600">{message}</div>}
    </div>
  );
}
