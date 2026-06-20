const AUTO_PROCESS_URL_PATTERN = /https?:\/\/[^\s，。！？、）】)]+/g;

function parseHttpUrl(value: string) {
  try {
    const url = new URL(String(value || '').trim());
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;
    return url;
  } catch {
    return null;
  }
}

function normalizedHost(url: URL) {
  return url.hostname.replace(/^www\./, '').toLowerCase();
}

export function isWechatArticleUrl(value: string) {
  const url = parseHttpUrl(value);
  if (!url) return false;
  const host = normalizedHost(url);
  return host === 'mp.weixin.qq.com' || host === 'weixin.qq.com';
}

export function isZhihuArticleUrl(value: string) {
  const url = parseHttpUrl(value);
  if (!url) return false;
  const host = normalizedHost(url);
  return (host === 'zhuanlan.zhihu.com' || host === 'zhihu.com') && url.pathname.startsWith('/p/');
}

export function isVideoSourceUrl(value: string) {
  const url = parseHttpUrl(value);
  if (!url) return false;
  const host = normalizedHost(url);
  if (host === 'b23.tv') return url.pathname.length > 1;
  return (host === 'bilibili.com' || host === 'm.bilibili.com') && /^\/video\/BV[A-Za-z0-9]+/.test(url.pathname);
}

export function isAllowedAutoProcessUrl(value: string) {
  return isWechatArticleUrl(value) || isZhihuArticleUrl(value) || isVideoSourceUrl(value);
}

export function getAutoProcessLinkUrl(value: string) {
  const text = String(value || '').trim();
  if (!text) return '';
  if (!/\s/.test(text) && isAllowedAutoProcessUrl(text)) return text;

  const matches = text.match(AUTO_PROCESS_URL_PATTERN) || [];
  const allowed = matches.filter(isAllowedAutoProcessUrl);
  return allowed.length === 1 ? allowed[0] : '';
}

export function itemKindForInput({ type, url }: { type?: string; url?: string }) {
  if (type === 'file') return 'document';
  if (type && type !== 'link') return type;
  if (isVideoSourceUrl(url || '')) return 'video';
  if (isWechatArticleUrl(url || '') || isZhihuArticleUrl(url || '')) return 'article';
  return type || 'link';
}
