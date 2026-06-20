export function videoSourceForUrl(value) {
  let url;
  try {
    url = new URL(String(value || '').trim());
  } catch {
    return null;
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;

  const host = url.hostname.replace(/^www\./, '').toLowerCase();
  if (host === 'b23.tv') {
    if (url.pathname.length <= 1) return null;
    return {
      source: 'bilibili',
      kind: 'video',
      bvid: '',
      url: url.href,
      short: true,
    };
  }

  if (host !== 'bilibili.com' && host !== 'm.bilibili.com') return null;
  const bvid = url.pathname.match(/\/video\/(BV[A-Za-z0-9]+)/)?.[1] || '';
  if (!bvid) return null;
  return {
    source: 'bilibili',
    kind: 'video',
    bvid,
    url: url.href,
    short: false,
  };
}

export function isBilibiliVideoUrl(value) {
  return Boolean(videoSourceForUrl(value));
}

export function extractBilibiliBvid(value) {
  return videoSourceForUrl(value)?.bvid || '';
}

export function normalizeBilibiliImageUrl(value, baseUrl) {
  const raw = String(value || '').trim();
  if (!raw) return '';
  if (raw.startsWith('//')) return `https:${raw}`;
  if (raw.startsWith('http://') || raw.startsWith('https://')) return raw;
  try {
    return new URL(raw, baseUrl).href;
  } catch {
    return '';
  }
}

export function bilibiliProcessingLabel(jobType) {
  if (jobType === 'link.fetchMetadata') return '解析视频信息';
  if (jobType === 'link.extractMarkdown') return '转写视频文字';
  if (jobType === 'link.summarize') return '生成视频摘要';
  return '';
}
