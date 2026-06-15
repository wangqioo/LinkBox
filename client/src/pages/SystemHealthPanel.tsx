import { AlertTriangle, CheckCircle2, CircleHelp, RefreshCw, ServerCog, XCircle } from 'lucide-react';
import type { SystemHealth } from '../api/client';
import {
  describeOverallHealth,
  healthChecksForDisplay,
  type HealthCheckDescription,
  type OverallHealthDescription,
} from './systemHealthUtils';

interface Props {
  health: SystemHealth | null;
  loading: boolean;
  onRefresh: () => void;
}

const toneClasses: Record<OverallHealthDescription['tone'], string> = {
  ok: 'border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-900 dark:bg-emerald-950/30 dark:text-emerald-300',
  warn: 'border-amber-200 bg-amber-50 text-amber-700 dark:border-amber-900 dark:bg-amber-950/30 dark:text-amber-300',
  fail: 'border-red-200 bg-red-50 text-red-700 dark:border-red-900 dark:bg-red-950/30 dark:text-red-300',
  unknown: 'border-gray-200 bg-gray-50 text-gray-600 dark:border-gray-800 dark:bg-gray-900 dark:text-gray-300',
};

const checkDotClasses: Record<HealthCheckDescription['status'], string> = {
  ok: 'bg-emerald-500',
  warn: 'bg-amber-500',
  fail: 'bg-red-500',
};

function OverallIcon({ tone }: { tone: OverallHealthDescription['tone'] }) {
  if (tone === 'ok') return <CheckCircle2 className="w-5 h-5" />;
  if (tone === 'warn') return <AlertTriangle className="w-5 h-5" />;
  if (tone === 'fail') return <XCircle className="w-5 h-5" />;
  return <CircleHelp className="w-5 h-5" />;
}

function formatCheckedAt(value?: string) {
  if (!value) return '尚未检查';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString();
}

export default function SystemHealthPanel({ health, loading, onRefresh }: Props) {
  const overall = describeOverallHealth(health?.status);
  const checks = healthChecksForDisplay(health?.checks || {});

  return (
    <div className="rounded-xl border p-5 space-y-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h2 className="font-semibold flex items-center gap-2">
            <ServerCog className="w-4 h-4 text-sky-500" />
            系统健康
          </h2>
          <p className="text-sm text-gray-500 mt-0.5">
            检查数据库、上传目录、后台队列、AI endpoint 和文档处理工具。
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

      <div className={`rounded-lg border px-4 py-3 ${toneClasses[overall.tone]}`}>
        <div className="flex items-start gap-3">
          <OverallIcon tone={overall.tone} />
          <div>
            <div className="font-semibold">状态：{overall.label}</div>
            <div className="text-sm mt-0.5">{overall.description}</div>
          </div>
        </div>
      </div>

      {health && (
        <div className="grid grid-cols-3 gap-3">
          {[
            ['正常', health.summary.ok],
            ['降级', health.summary.degraded],
            ['失败', health.summary.failed],
          ].map(([label, value]) => (
            <div key={label} className="rounded-lg border bg-gray-50 dark:bg-gray-800 px-3 py-2">
              <div className="text-xs text-gray-500">{label}</div>
              <div className="text-lg font-semibold">{value}</div>
            </div>
          ))}
        </div>
      )}

      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        {checks.map((check) => (
          <div key={check.key} className="rounded-lg border px-3 py-2">
            <div className="flex items-center justify-between gap-3">
              <div className="flex items-center gap-2 min-w-0">
                <span className={`w-2 h-2 rounded-full shrink-0 ${checkDotClasses[check.status]}`} />
                <span className="font-medium text-sm truncate">{check.title}</span>
              </div>
              <span className="text-xs text-gray-500 shrink-0">{check.label}</span>
            </div>
            <div className="text-xs text-gray-500 mt-1 break-words">{check.detail}</div>
          </div>
        ))}
      </div>

      <div className="text-xs text-gray-500">
        检查时间：{formatCheckedAt(health?.checkedAt)}
      </div>
    </div>
  );
}
