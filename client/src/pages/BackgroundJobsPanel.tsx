import { Activity, RefreshCw, RotateCcw } from 'lucide-react';
import type { SystemStatus } from '../api/client';

interface Props {
  systemStatus: SystemStatus | null;
  loadingSystem: boolean;
  retryingJobs: boolean;
  queueMessage: string;
  onRefresh: () => void;
  onRetryFailedJobs: () => void;
}

export default function BackgroundJobsPanel({
  systemStatus,
  loadingSystem,
  retryingJobs,
  queueMessage,
  onRefresh,
  onRetryFailedJobs,
}: Props) {
  return (
    <div className="rounded-xl border p-5 space-y-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h2 className="font-semibold flex items-center gap-2">
            <Activity className="w-4 h-4 text-indigo-500" />
            后台任务
          </h2>
          <p className="text-sm text-gray-500 mt-0.5">
            链接抓取、文件解析、图片描述和 AI 摘要都会进入持久化队列；服务重启后会继续处理。
          </p>
        </div>
        <button
          type="button"
          onClick={onRefresh}
          disabled={loadingSystem}
          className="btn-secondary flex items-center gap-2 shrink-0"
        >
          <RefreshCw className={`w-4 h-4 ${loadingSystem ? 'animate-spin' : ''}`} />
          刷新
        </button>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        {[
          ['等待', systemStatus?.queue.queued ?? 0],
          ['运行', systemStatus?.queue.leased ?? 0],
          ['完成', systemStatus?.queue.done ?? 0],
          ['失败', systemStatus?.queue.failed ?? 0],
        ].map(([label, value]) => (
          <div key={label} className="rounded-lg border bg-gray-50 dark:bg-gray-800 px-3 py-2">
            <div className="text-xs text-gray-500">{label}</div>
            <div className="text-lg font-semibold">{value}</div>
          </div>
        ))}
      </div>

      {systemStatus && (
        <div className="text-xs text-gray-500">
          并发：{systemStatus.queue.concurrency} · 进程运行：{systemStatus.queue.running} · 服务运行：{Math.floor(systemStatus.uptimeSeconds / 60)} 分钟
        </div>
      )}

      {systemStatus?.queue.lastFailed && (
        <div className="rounded-lg border border-red-200 bg-red-50 dark:bg-red-900/20 px-3 py-2 text-sm">
          <div className="font-medium text-red-700 dark:text-red-300">
            最近失败：#{systemStatus.queue.lastFailed.id} {systemStatus.queue.lastFailed.type}
          </div>
          <div className="text-xs text-red-600 dark:text-red-200 mt-1 break-words">
            {systemStatus.queue.lastFailed.last_error || '未记录错误'}
          </div>
        </div>
      )}

      <div className="flex flex-wrap items-center gap-3">
        <button
          type="button"
          onClick={onRetryFailedJobs}
          disabled={retryingJobs || !systemStatus?.queue.failed}
          className="btn-secondary flex items-center gap-2"
        >
          <RotateCcw className="w-4 h-4" />
          {retryingJobs ? '重试中…' : '重试失败任务'}
        </button>
        {queueMessage && <span className="text-sm text-green-600">{queueMessage}</span>}
      </div>
    </div>
  );
}
