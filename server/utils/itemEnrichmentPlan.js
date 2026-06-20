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
