import { Loader2, RotateCcw } from 'lucide-react';
import type { ProcessingDisplay } from './processingStatus';

interface Props {
  display: ProcessingDisplay;
  retryError?: string;
  retrying?: boolean;
  onRetry?: () => void;
}

export default function ProcessingBanner({
  display,
  retryError = '',
  retrying = false,
  onRetry,
}: Props) {
  if (display.kind === 'failed') {
    return (
      <div className="mt-2 flex flex-wrap items-center gap-2 text-xs text-red-500 bg-red-50 dark:bg-red-900/20 rounded-lg px-2.5 py-2">
        <div className="min-w-0 flex-1">
          <div className="break-words">{retryError || display.text}</div>
          {display.recoveryHint && (
            <div className="mt-1 break-words text-red-600 dark:text-red-200">
              建议：{display.recoveryHint}
            </div>
          )}
        </div>
        {onRetry && display.canRetry && (
          <button
            type="button"
            onClick={onRetry}
            disabled={retrying}
            className="inline-flex items-center gap-1 rounded-md border border-red-200 bg-white/70 px-2 py-1 font-medium text-red-600 transition-colors hover:bg-red-100 disabled:opacity-50 dark:border-red-800 dark:bg-red-950/30 dark:text-red-200 dark:hover:bg-red-900/40"
          >
            {retrying ? <Loader2 className="w-3 h-3 animate-spin" /> : <RotateCcw className="w-3 h-3" />}
            {retrying ? '重试中' : '重试'}
          </button>
        )}
      </div>
    );
  }

  return (
    <div className="mt-2 flex min-w-0 items-center gap-2 text-xs text-blue-600 dark:text-blue-400 bg-blue-50 dark:bg-blue-900/20 rounded-lg px-2.5 py-2">
      <Loader2 className="w-3 h-3 animate-spin shrink-0" />
      <span className="min-w-0 flex-1 break-words">{display.text}</span>
      <div className="flex gap-1 shrink-0">
        {[1, 2].map(step => (
          <div
            key={step}
            className={`w-1.5 h-1.5 rounded-full ${
              step < display.step
                ? 'bg-blue-400'
                : step === display.step
                  ? 'bg-blue-600 animate-pulse'
                  : 'bg-blue-200'
            }`}
          />
        ))}
      </div>
    </div>
  );
}
