import { Bot, Check, Clock3, Play, RefreshCw, Sparkles, X } from 'lucide-react';
import type { LocalAgentStatus, LocalAgentSuggestion, LocalAgentTimelineEvent } from '../api/client';
import {
  autopilotSummary,
  formatPercent,
  maturityPercent,
  maturityRows,
  suggestionActionLabel,
  timelineEventLabel,
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

function eventTime(event: LocalAgentTimelineEvent) {
  return event.createdAt ? new Date(event.createdAt).toLocaleString() : '';
}

export default function LocalAgentWorkbenchPanel({
  status,
  loading,
  generatingReport,
  generatingSuggestions,
  runningAutopilot,
  resolvingSuggestionId,
  message,
  onRefresh,
  onGenerateReport,
  onGenerateSuggestions,
  onRunAutopilot,
  onResolveSuggestion,
}: Props) {
  const total = status?.coverage.total || 0;
  const rows = maturityRows(status?.coverage.states || {});
  const readyPercent = maturityPercent(status?.coverage.ready || 0, total);

  return (
    <div className="rounded-xl border p-5 space-y-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h2 className="font-semibold flex items-center gap-2">
            <Bot className="w-4 h-4 text-indigo-500" />
            本地 Agent 工作台
          </h2>
          <p className="text-sm text-gray-500 mt-0.5">
            查看小盒子已完成的资料加工、待确认建议和本地规则。
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

      <div className="rounded-lg border px-3 py-3 space-y-3">
        <div className="flex items-start justify-between gap-3">
          <div>
            <div className="text-sm font-medium flex items-center gap-2">
              <Play className="w-4 h-4 text-indigo-500" />
              Autopilot
            </div>
            <div className="text-xs text-gray-500 mt-0.5">
              {autopilotSummary(status?.autopilot)}
            </div>
          </div>
          <button
            type="button"
            onClick={onRunAutopilot}
            disabled={runningAutopilot}
            className="btn-primary flex items-center gap-2"
          >
            <Play className="w-4 h-4" />
            {runningAutopilot ? '运行中…' : '运行一次'}
          </button>
        </div>
        {(status?.autopilot?.timeline || []).length ? (
          <div className="space-y-2">
            {(status?.autopilot?.timeline || []).slice(0, 6).map((event) => (
              <div key={event.id} className="flex items-start gap-2 rounded-md bg-gray-50 dark:bg-gray-800 px-3 py-2">
                <Clock3 className="w-3.5 h-3.5 text-gray-400 mt-0.5 shrink-0" />
                <div className="min-w-0">
                  <div className="text-sm truncate">
                    <span className="text-xs text-indigo-600 mr-2">{timelineEventLabel(event.eventType)}</span>
                    {event.title}
                  </div>
                  <div className="text-xs text-gray-500 truncate">
                    {[event.detail, eventTime(event)].filter(Boolean).join(' · ')}
                  </div>
                </div>
              </div>
            ))}
          </div>
        ) : (
          <div className="text-sm text-gray-500">暂无 Autopilot 时间线。</div>
        )}
      </div>

      <div className="rounded-lg border px-3 py-3 space-y-2">
        <div className="flex items-start justify-between gap-3">
          <div>
            <div className="text-sm font-medium">最近报告</div>
            <div className="text-xs text-gray-500">
              {status?.latestReport?.createdAt ? new Date(status.latestReport.createdAt).toLocaleString() : '尚未生成报告'}
            </div>
          </div>
          <button
            type="button"
            onClick={onGenerateReport}
            disabled={generatingReport}
            className="btn-secondary flex items-center gap-2"
          >
            <Sparkles className="w-4 h-4" />
            {generatingReport ? '生成中…' : '生成报告'}
          </button>
        </div>
        <div className="text-sm text-gray-600 dark:text-gray-300">
          {status?.latestReport?.content?.headline || '本地 Agent 会基于队列、成熟度、建议和规则生成工作报告。'}
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
                    {suggestion.reason && <div className="text-xs text-gray-500 mt-1">{suggestion.reason}</div>}
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
          <div className="mt-2 space-y-1">
            {status.rules.slice(0, 5).map((rule) => (
              <div key={rule.id} className="text-sm text-gray-600 dark:text-gray-300 truncate">
                {rule.title}
              </div>
            ))}
          </div>
        )}
      </div>

      {message && <div className="text-sm text-green-600">{message}</div>}
    </div>
  );
}
