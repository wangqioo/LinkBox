import * as cheerio from 'cheerio';
import db from '../../db.js';
import {
  extractBilibiliBvid,
  normalizeBilibiliImageUrl,
} from '../bilibiliVideoSource.js';
import { extractTranscriptWithYtDlp } from '../videoTranscriptExtractor.js';

const BILIBILI_UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';

function getSiteCookie(domain) {
  try {
    const row = db.prepare('SELECT value FROM settings WHERE key = ?').get('cookie:' + domain);
    return row?.value || '';
  } catch {
    return '';
  }
}

async function fetchHtml(url, extraHeaders = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 25000);
  try {
    const res = await fetch(url, {
      signal: controller.signal,
      headers: {
        'User-Agent': BILIBILI_UA,
        'Accept': 'text/html,application/xhtml+xml,*/*;q=0.9',
        'Accept-Language': 'zh-CN,zh;q=0.9',
        'Referer': 'https://www.bilibili.com/',
        ...extraHeaders,
      },
    });
    if (!res.ok) throw new Error('HTTP ' + res.status);
    return await res.text();
  } finally {
    clearTimeout(timer);
  }
}

function extractInitialState(html) {
  const match = html.match(/window\.__INITIAL_STATE__\s*=\s*({[\s\S]*?});\s*\(function\(\)/) ||
    html.match(/window\.__INITIAL_STATE__\s*=\s*({[\s\S]*?});?\s*<\/script>/);
  if (!match) return {};
  try {
    return JSON.parse(match[1]);
  } catch {
    return {};
  }
}

function findBilibiliVideoData(value) {
  if (!value || typeof value !== 'object') return null;
  if (value.bvid || value.cid || value.title || value.desc) return value;
  for (const child of Object.values(value)) {
    const found = findBilibiliVideoData(child);
    if (found) return found;
  }
  return null;
}

function bilibiliSubtitleUrl(value) {
  if (!value) return '';
  const raw = String(value);
  if (raw.startsWith('//')) return `https:${raw}`;
  if (raw.startsWith('/')) return `https://www.bilibili.com${raw}`;
  return raw;
}

function formatSeconds(seconds) {
  const total = Math.max(0, Math.floor(Number(seconds) || 0));
  const minutes = Math.floor(total / 60);
  const rest = total % 60;
  return `${String(minutes).padStart(2, '0')}:${String(rest).padStart(2, '0')}`;
}

function bilibiliMarkdown({ title, desc, subtitles }) {
  const parts = [];
  if (title) parts.push(`# ${title}`);
  if (desc) parts.push(`> ${desc}`);
  if (subtitles.length) {
    parts.push('## 视频字幕');
    parts.push(subtitles.map(item => `${formatSeconds(item.from)} ${item.content}`).join('\n\n'));
  } else {
    parts.push('## 视频字幕');
    parts.push('未找到公开视频字幕。');
  }
  return parts.filter(Boolean).join('\n\n');
}

async function fetchBilibiliSubtitles({ bvid, cid, cookie }) {
  if (!bvid || !cid) return [];
  const apiUrl = `https://api.bilibili.com/x/player/v2?bvid=${encodeURIComponent(bvid)}&cid=${encodeURIComponent(cid)}`;
  const resp = await fetch(apiUrl, {
    headers: {
      'User-Agent': BILIBILI_UA,
      'Referer': `https://www.bilibili.com/video/${bvid}/`,
      'Accept': 'application/json,text/plain,*/*',
      ...(cookie ? { 'Cookie': cookie } : {}),
    },
    signal: AbortSignal.timeout(25000),
  });
  if (!resp.ok) return [];
  const data = await resp.json();
  const subtitle = data?.data?.subtitle?.subtitles?.find(item => item?.subtitle_url) ||
    data?.data?.subtitle?.subtitles?.[0];
  const subtitleUrl = bilibiliSubtitleUrl(subtitle?.subtitle_url);
  if (!subtitleUrl) return [];

  const subResp = await fetch(subtitleUrl, {
    headers: {
      'User-Agent': BILIBILI_UA,
      'Referer': `https://www.bilibili.com/video/${bvid}/`,
      'Accept': 'application/json,text/plain,*/*',
      ...(cookie ? { 'Cookie': cookie } : {}),
    },
    signal: AbortSignal.timeout(25000),
  });
  if (!subResp.ok) return [];
  const subData = await subResp.json();
  return Array.isArray(subData?.body)
    ? subData.body
      .map(item => ({
        from: item.from,
        content: String(item.content || '').trim(),
      }))
      .filter(item => item.content)
    : [];
}

export async function extractBilibili(url, options = {}) {
  const transcriptExtractor = options.videoTranscriptExtractor || extractTranscriptWithYtDlp;
  const cookie = getSiteCookie('bilibili.com');
  const html = await fetchHtml(url, cookie ? {
    'Cookie': cookie,
  } : {});
  const $ = cheerio.load(html);
  const state = extractInitialState(html);
  const videoData = state.videoData || findBilibiliVideoData(state) || {};
  const bvid = videoData.bvid || extractBilibiliBvid(url);
  const cid = videoData.cid || videoData.pages?.[0]?.cid || state.cid || '';
  const title = videoData.title || $('meta[property="og:title"]').attr('content') || $('title').text().replace(/_哔哩哔哩_bilibili$/, '').trim();
  const desc = videoData.desc || $('meta[name="description"]').attr('content') || '';
  const author = videoData.owner?.name || videoData.owner_name || '';
  const thumbnail = normalizeBilibiliImageUrl(
    videoData.pic
      || videoData.pic_url
      || $('meta[property="og:image"]').attr('content')
      || $('meta[name="twitter:image"]').attr('content'),
    url,
  );
  const subtitles = await fetchBilibiliSubtitles({ bvid, cid, cookie });
  if (!subtitles.length) {
    try {
      const transcript = await transcriptExtractor(url);
      if (transcript?.markdown) {
        return {
          title: transcript.title || title,
          author,
          siteName: 'Bilibili',
          thumbnail,
          markdown: transcript.markdown,
          wordCount: transcript.wordCount || transcript.markdown.length,
        };
      }
    } catch (e) {
      throw new Error(`Bilibili video audio transcription failed: ${e.message}`);
    }
    throw new Error('Bilibili video audio transcription did not return transcript text');
  }
  const markdown = bilibiliMarkdown({ title, desc, subtitles });
  return {
    title,
    author,
    siteName: 'Bilibili',
    thumbnail,
    markdown,
    wordCount: markdown.length,
  };
}
