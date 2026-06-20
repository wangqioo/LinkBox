import { isBilibiliVideoUrl } from './bilibiliVideoSource.js';
import { extractBilibili } from './extractors/bilibiliExtractor.js';
import { extractGeneric } from './extractors/genericExtractor.js';
import { extractWeixin } from './extractors/weixinExtractor.js';
import { extractZhihu } from './extractors/zhihuExtractor.js';
import {
  addImageDescriptions,
} from './extractors/shared.js';

export { addImageDescriptions };

export async function extractPageMarkdown(url, opts = {}) {
  const withVision = opts.vision !== false;
  const extractors = {
    weixin: extractWeixin,
    zhihu: extractZhihu,
    bilibili: extractBilibili,
    generic: extractGeneric,
    ...(opts.extractors || {}),
  };
  const isWeixin = url.includes('mp.weixin.qq.com') || url.includes('weixin.qq.com');
  const isZhihu = url.includes('zhihu.com/p/') || url.includes('zhuanlan.zhihu.com');
  const isBilibili = isBilibiliVideoUrl(url);
  if (isWeixin) return await extractors.weixin(url, withVision);
  if (isZhihu) return await extractors.zhihu(url, withVision);
  if (isBilibili) return await extractors.bilibili(url, { videoTranscriptExtractor: opts.videoTranscriptExtractor });
  return await extractors.generic(url, withVision);
}
