import { isVideoSourceUrl } from './sourceKind.ts';

export interface ProcessingDisplayInput {
  status?: string;
  isProcessing?: boolean;
  hasMarkdown?: boolean;
  hasSummary?: boolean;
  itemType?: string;
  url?: string;
  processing?: {
    state?: string;
    stage?: string;
    label?: string;
    canRetry?: boolean;
    lastError?: string;
    recoveryHint?: string;
  };
}

export interface ProcessingDisplay {
  kind: 'active' | 'failed';
  text: string;
  recoveryHint?: string;
  step: number;
  canRetry: boolean;
}

export function deriveProcessingDisplay(input: ProcessingDisplayInput): ProcessingDisplay | null {
  const processing = input.processing;
  const isVideoItem = input.itemType === 'video' || (input.itemType === 'link' && isVideoSourceUrl(input.url || ''));

  if (processing?.state === 'failed') {
    return {
      kind: 'failed',
      text: processing.lastError || '内容处理失败，可重试后台任务',
      recoveryHint: processing.recoveryHint || '',
      step: 0,
      canRetry: Boolean(processing.canRetry),
    };
  }

  if (input.status === 'error') {
    return {
      kind: 'failed',
      text: '处理失败',
      recoveryHint: '',
      step: 0,
      canRetry: false,
    };
  }

  if (processing && ['queued', 'running', 'processing'].includes(processing.state || '')) {
    return {
      kind: 'active',
      text: processing.label || '正在后台处理...',
      step: processing.stage?.includes('summarize') ? 2 : 1,
      canRetry: false,
    };
  }

  if (input.status !== 'processing' && !input.isProcessing) return null;

  if (!input.hasMarkdown && !input.hasSummary) {
    return {
      kind: 'active',
      text: isVideoItem ? '正在处理视频...' : '正在提取正文...',
      step: 1,
      canRetry: false,
    };
  }

  if (input.hasMarkdown && !input.hasSummary) {
    return {
      kind: 'active',
      text: '正在生成摘要...',
      step: 2,
      canRetry: false,
    };
  }

  return null;
}
