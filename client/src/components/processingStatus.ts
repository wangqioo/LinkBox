export interface ProcessingDisplayInput {
  status?: string;
  isProcessing?: boolean;
  hasMarkdown?: boolean;
  hasSummary?: boolean;
  processing?: {
    state?: string;
    stage?: string;
    label?: string;
    canRetry?: boolean;
    lastError?: string;
  };
}

export interface ProcessingDisplay {
  kind: 'active' | 'failed';
  text: string;
  step: number;
  canRetry: boolean;
}

export function deriveProcessingDisplay(input: ProcessingDisplayInput): ProcessingDisplay | null {
  const processing = input.processing;

  if (processing?.state === 'failed') {
    return {
      kind: 'failed',
      text: processing.lastError || '内容处理失败，可重试后台任务',
      step: 0,
      canRetry: Boolean(processing.canRetry),
    };
  }

  if (input.status === 'error') {
    return {
      kind: 'failed',
      text: '处理失败',
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
      text: '正在提取正文...',
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
