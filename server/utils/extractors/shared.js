import * as cheerio from 'cheerio';
import TurndownService from 'turndown';
import { gfm } from 'turndown-plugin-gfm';
import db from '../../db.js';
import { getAIConfig } from '../aiConfig.js';

export const td = new TurndownService({
  headingStyle: 'atx',
  hr: '---',
  bulletListMarker: '-',
  codeBlockStyle: 'fenced',
  preformattedCode: true,
});

td.use(gfm);

td.addRule('pre-code', {
  filter: (node) => node.nodeName === 'PRE',
  replacement: (content, node) => {
    const code = node.querySelector ? node.querySelector('code') : null;
    const lang = code ? (code.className.match(/language-(\S+)/) || [])[1] || '' : '';
    const text = (code ? code.textContent : node.textContent) || '';
    return `

\`\`\`${lang}
${text.trim()}
\`\`\`

`;
  },
});

td.addRule('preserve-html-table', {
  filter: (node) => {
    if (node.nodeName === 'TABLE') return true;
    return node.nodeName === 'DIV' && node.getAttribute?.('data-linkbox-table');
  },
  replacement: (content, node) => {
    const html = node.outerHTML || '';
    const tableHtml = node.nodeName === 'TABLE'
      ? cleanTableHtml(html)
      : cleanTableHtml(html.match(/<table[\s\S]*<\/table>/i)?.[0] || html);
    const id = node.getAttribute?.('data-linkbox-table') || 'preserved';
    return `\n\n<div data-linkbox-table="${id}">\n${tableHtml}\n</div>\n\n`;
  },
});

export function cleanTableHtml(tableHtml) {
  const $ = cheerio.load(tableHtml, { decodeEntities: false });
  const table = $('table').first();
  if (!table.length) return tableHtml;

  table.find('script,style,svg').remove();
  table.find('*').each((_, el) => {
    const node = $(el);
    const allowed = {};
    for (const attr of ['rowspan', 'colspan']) {
      const value = node.attr(attr);
      if (value) allowed[attr] = value;
    }
    node.attr({});
    Object.entries(allowed).forEach(([key, value]) => node.attr(key, value));
  });

  table.attr({});
  return $.html(table);
}

export function preserveHtmlTables(html) {
  const $ = cheerio.load(html, { decodeEntities: false });
  $('table').each((index, el) => {
    const tableHtml = cleanTableHtml($.html(el));
    $(el).replaceWith(`\n\n<div data-linkbox-table="wechat-${index}">\n${tableHtml}\n</div>\n\n`);
  });
  return $('body').html() || $.root().html() || html;
}

export function fixMarkdownImages(markdown) {
  let result = markdown;
  result = result.replace(/!\[([^\]]*)\]\s*\n\s*\(([^)]*(?:\n[^)]*)*)\)/g, (match, alt, url) => {
    const cleanUrl = url.replace(/\s*\n\s*/g, '').trim();
    if (!cleanUrl.startsWith('http')) return '';
    return `![${alt}](${cleanUrl})`;
  });
  result = result.replace(/^!\[([^\]]*)\]\s*$/gm, '');
  result = result.replace(/^!\[([^\]]*)\]\(\s*\)\s*$/gm, '');
  result = result.replace(/\n{3,}/g, '\n\n');
  return result;
}

const MIN_IMAGE_BYTES = 5000;
const WEB_IMAGE_VISION_TIMEOUT_MS = Number(process.env.WEB_IMAGE_VISION_TIMEOUT_MS || 30000);

async function fetchImageAsBase64(url, referer) {
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 15000);
    const res = await fetch(url, {
      signal: controller.signal,
      headers: {
        'User-Agent': 'Mozilla/5.0 (Linux; Android 13; Pixel 7) AppleWebKit/537.36 Chrome/116.0.0.0 Mobile Safari/537.36',
        'Referer': referer || 'https://mp.weixin.qq.com/',
        'Accept': 'image/*,*/*',
      },
    });
    clearTimeout(timer);
    if (!res.ok) return null;
    const contentType = res.headers.get('content-type') || '';
    const mime = contentType.split(';')[0].trim() || 'image/jpeg';
    if (!mime.startsWith('image/')) return null;
    if (mime === 'image/gif') return null;
    const buf = Buffer.from(await res.arrayBuffer());
    if (buf.length < MIN_IMAGE_BYTES) return null;
    return { b64: buf.toString('base64'), mime };
  } catch {
    return null;
  }
}

async function describeWebImage(imageUrl, referer) {
  const img = await fetchImageAsBase64(imageUrl, referer);
  if (!img) return null;
  try {
    const aiConfig = getAIConfig({ includeSecret: true });
    const payload = {
      model: aiConfig.visionModel || aiConfig.model,
      messages: [{
        role: 'user',
        content: [
          { type: 'image_url', image_url: { url: `data:${img.mime};base64,${img.b64}` } },
          { type: 'text', text: '请用一句简短的中文描述这张图片的内容，不超过25个字。' },
        ],
      }],
      max_tokens: 80,
      temperature: aiConfig.temperature,
      chat_template_kwargs: { enable_thinking: aiConfig.enableThinking },
    };
    const resp = await fetch(`${aiConfig.baseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(aiConfig.apiKey ? { Authorization: `Bearer ${aiConfig.apiKey}` } : {}),
      },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(WEB_IMAGE_VISION_TIMEOUT_MS),
    });
    if (!resp.ok) return null;
    const data = await resp.json();
    const desc = (data?.choices?.[0]?.message?.content?.trim() || '').slice(0, 60);
    console.log(`[extract] Image described: ${desc}`);
    return desc || null;
  } catch (e) {
    console.warn(`[extract] Vision LLM error: ${e.message}`);
    return null;
  }
}

export async function addImageDescriptions(markdown, referer) {
  const imgPattern = /^(!\[[^\]]*\]\(([^)]+)\))$/gm;
  const matches = [];
  let m;
  while ((m = imgPattern.exec(markdown)) !== null) {
    matches.push({ full: m[1], url: m[2] });
  }
  if (matches.length === 0) return markdown;
  console.log(`[extract] Describing ${matches.length} image(s)...`);
  const descriptions = {};
  for (const img of matches) {
    const desc = await describeWebImage(img.url, referer);
    if (desc) descriptions[img.url] = desc;
  }
  return markdown.replace(/^(!\[[^\]]*\]\(([^)]+)\))$/gm, (match, full, url) => {
    const desc = descriptions[url];
    return desc ? `${full}\n\n> 图片描述：${desc}` : full;
  });
}

export function getSiteCookie(domain) {
  try {
    const row = db.prepare('SELECT value FROM settings WHERE key = ?').get('cookie:' + domain);
    return row?.value || '';
  } catch {
    return '';
  }
}

export async function fetchHtml(url, ua, extraHeaders = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 25000);
  try {
    const res = await fetch(url, {
      signal: controller.signal,
      headers: {
        'User-Agent': ua,
        'Accept': 'text/html,application/xhtml+xml,*/*;q=0.9',
        'Accept-Language': 'zh-CN,zh;q=0.9',
        'Referer': 'https://mp.weixin.qq.com/',
        ...extraHeaders,
      },
    });
    if (!res.ok) throw new Error('HTTP ' + res.status);
    return await res.text();
  } finally {
    clearTimeout(timer);
  }
}
