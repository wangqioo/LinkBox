export function mobileProcessingText(file) {
  if (!file) return ''

  if (file.processing?.state === 'failed' || file.status === 'failed') {
    return file.error || file.processing?.lastError || '处理失败，点开可重试'
  }

  if (['queued', 'running', 'processing'].includes(file.processing?.state || '') || file.status === 'pending') {
    return file.processing?.label || '后台处理中'
  }

  return ''
}
