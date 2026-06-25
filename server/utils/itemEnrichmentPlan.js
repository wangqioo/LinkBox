import { bilibiliProcessingLabel } from './bilibiliVideoSource.js';
import { itemKindForRow } from './itemKind.js';

const JOB_LABELS = {
  'link.fetchMetadata': '抓取网页信息',
  'link.extractMarkdown': '提取网页正文',
  'link.summarize': '生成网页摘要',
  'image.describe': '识别图片内容',
  'file.extractMarkdown': '解析文件正文',
  'file.summarize': '生成文件摘要',
};

const JOB_RECOVERY_HINTS = {
  'file.extractMarkdown': '确认文件格式受支持，检查 pdftotext/LibreOffice 等文档解析依赖后重试。',
  'link.summarize': '检查 AI 服务地址、模型和 API Key 是否可用后重试。',
  'file.summarize': '检查 AI 服务地址、模型和 API Key 是否可用后重试。',
  'image.describe': '检查视觉模型配置、图片文件是否可读后重试。',
  'link.fetchMetadata': '检查目标网页是否可访问，必要时补充站点 Cookie 后重试。',
  'link.extractMarkdown': '检查目标网页是否可访问，必要时补充站点 Cookie 后重试。',
  'document.embed': '检查 Embedding 配置和模型服务后重试，必要时重新建立文档索引。',
};

export function initialEnrichmentJob(kind, processing = {}) {
  if (kind === 'link') {
    return {
      type: 'link.fetchMetadata',
      linkId: processing.linkId,
      payload: { url: processing.url, title: processing.title || '' },
      maxAttempts: 3,
    };
  }
  if (kind === 'image') {
    return {
      type: 'image.describe',
      linkId: processing.linkId,
      payload: { diskPath: processing.diskPath },
      maxAttempts: 3,
    };
  }
  if (kind === 'file') {
    return {
      type: 'file.extractMarkdown',
      linkId: processing.linkId,
      payload: {
        diskPath: processing.diskPath,
        originalName: processing.originalName,
        isHtml: Boolean(processing.isHtml),
      },
      maxAttempts: 3,
    };
  }
  return null;
}

export function labelForEnrichmentJob(type, item = null) {
  if (itemKindForRow(item) === 'video') {
    const label = bilibiliProcessingLabel(type);
    if (label) return label;
  }
  return JOB_LABELS[type] || type || '';
}

export function recoveryHintForEnrichmentJob(type) {
  return JOB_RECOVERY_HINTS[type] || '查看错误详情，确认相关服务或文件可用后重试。';
}

export function followupEnrichmentJobs({
  linkId,
  summarize = true,
  summaryJobType = 'link.summarize',
  documentId = null,
} = {}) {
  const jobs = [];
  if (documentId) {
    jobs.push({ type: 'document.embed', linkId, payload: {}, maxAttempts: 2 });
  }
  if (summarize) {
    jobs.push({ type: summaryJobType, linkId, payload: {}, maxAttempts: 3 });
  }
  return jobs;
}
