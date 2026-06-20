const AUTO_PROCESS_URL_PATTERN = /https?:\/\/[^\s，。！？、）】)]+/g;

function parseHttpUrl(value) {
  try {
    const url = new URL(String(value || '').trim());
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;
    return url;
  } catch {
    return null;
  }
}

function normalizedHost(url) {
  return url.hostname.replace(/^www\./, '').toLowerCase();
}

export function isWechatArticleUrl(value) {
  const url = parseHttpUrl(value);
  if (!url) return false;
  const host = normalizedHost(url);
  return host === 'mp.weixin.qq.com' || host === 'weixin.qq.com';
}

export function isZhihuArticleUrl(value) {
  const url = parseHttpUrl(value);
  if (!url) return false;
  const host = normalizedHost(url);
  return (host === 'zhuanlan.zhihu.com' || host === 'zhihu.com') && url.pathname.startsWith('/p/');
}

export function isVideoSourceUrl(value) {
  return isBilibiliVideoUrl(value);
}

export function isAllowedAutoProcessUrl(value) {
  return isWechatArticleUrl(value) || isZhihuArticleUrl(value) || isVideoSourceUrl(value);
}

export function getAutoProcessLinkUrl(value) {
  const text = String(value || '').trim();
  if (!text) return '';
  if (!/\s/.test(text) && isAllowedAutoProcessUrl(text)) return text;

  const matches = text.match(AUTO_PROCESS_URL_PATTERN) || [];
  const allowed = matches.filter(isAllowedAutoProcessUrl);
  return allowed.length === 1 ? allowed[0] : '';
}

export function isAutoProcessLinkText(value) {
  return Boolean(getAutoProcessLinkUrl(value));
}

export function itemKindForRow(row = {}) {
  const type = row.type || 'link';
  if (type === 'file') return 'document';
  if (type !== 'link') return type;
  if (isVideoSourceUrl(row.url)) return 'video';
  if (isWechatArticleUrl(row.url) || isZhihuArticleUrl(row.url)) return 'article';
  return 'link';
}

export function sqlConditionForItemKind(kind, tableAlias = 'l') {
  const prefix = tableAlias ? `${tableAlias}.` : '';
  if (kind === 'document') return { sql: `${prefix}type = ?`, params: ['file'] };
  if (kind === 'video') {
    return {
      sql: `${prefix}type = 'link' AND (
      ${prefix}url LIKE 'https://www.bilibili.com/video/BV%' OR
      ${prefix}url LIKE 'https://m.bilibili.com/video/BV%' OR
      ${prefix}url LIKE 'https://bilibili.com/video/BV%' OR
      ${prefix}url LIKE 'https://b23.tv/%'
    )`,
      params: [],
    };
  }
  if (kind === 'article') {
    return {
      sql: `${prefix}type = 'link' AND (
      ${prefix}url LIKE 'https://mp.weixin.qq.com/%' OR
      ${prefix}url LIKE 'https://weixin.qq.com/%' OR
      ${prefix}url LIKE 'https://zhuanlan.zhihu.com/p/%' OR
      ${prefix}url LIKE 'https://www.zhihu.com/p/%' OR
      ${prefix}url LIKE 'https://zhihu.com/p/%'
    )`,
      params: [],
    };
  }
  return { sql: `${prefix}type = ?`, params: [kind] };
}
import { isBilibiliVideoUrl } from './bilibiliVideoSource.js';
