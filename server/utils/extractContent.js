import * as cheerio from 'cheerio';
import { Readability } from '@mozilla/readability';
import { JSDOM } from 'jsdom';
import TurndownService from 'turndown';
import { gfm, tables, strikethrough } from 'turndown-plugin-gfm';
import db from '../db.js';
import { getAIConfig } from './aiConfig.js';

const td = new TurndownService({
  headingStyle: 'atx',
  hr: '---',
  bulletListMarker: '-',
  codeBlockStyle: 'fenced',
  preformattedCode: true,
});

// Enable GFM: tables, strikethrough, task lists
td.use(gfm);

// Keep <pre> blocks as fenced code blocks, preserve language hint
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
  }
});

const MIN_IMAGE_BYTES = 5000;

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
          { type: 'text', text: '请用一句简短的中文描述这张图片的内容，不超过25个字。' }
        ]
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
      signal: AbortSignal.timeout(30000),
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

async function addImageDescriptions(markdown, referer) {
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

/**
 * Fix broken image markdown where URL is split across lines.
 * Also removes unfixable broken image syntax.
 */
function fixMarkdownImages(markdown) {
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

/**
 * Decode WeChat's JsDecode-encoded string:
 * 1. Decode \xNN hex escape sequences (\x0a=newline, \x26=&, etc.)
 * 2. Decode HTML entities (&lt; &gt; &quot; &amp;)
 */
function decodeWxJsDecode(str) {
  let decoded = str.replace(/\\x([0-9a-fA-F]{2})/g, (_, hex) =>
    String.fromCharCode(parseInt(hex, 16))
  );
  decoded = decoded
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, '&')
    .replace(/&nbsp;/g, '\u00a0');
  return decoded;
}

function getSiteCookie(domain) {
  try {
    const row = db.prepare('SELECT value FROM settings WHERE key = ?').get('cookie:' + domain);
    return row?.value || '';
  } catch {
    return '';
  }
}

async function fetchHtml(url, ua, extraHeaders = {}) {
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

async function extractWeixin(url, withVision) {
  const WX_UA = 'Mozilla/5.0 (Linux; Android 13; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/116.0.0.0 Mobile Safari/537.36 MicroMessenger/8.0.43.2560 NetType/WIFI Language/zh_CN';
  const html = await fetchHtml(url, WX_UA);
  const $ = cheerio.load(html);
  $('img[data-src]').each((_, el) => {
    const src = $(el).attr('data-src');
    if (src) $(el).attr('src', src);
  });

  // Title: try DOM first, then og:title fallback (video articles may not have #activity-name)
  const title = (
    $('#activity-name').text().trim() ||
    $('.rich_media_title').text().trim() ||
    $('meta[property="og:title"]').attr('content') ||
    ''
  ).trim();

  const author = (
    $('#js_name').text().trim() ||
    $('.rich_media_meta_text').first().text().trim() ||
    $('meta[property="og:article:author"]').attr('content') ||
    ''
  ).trim();

  const publishTime = ($('#publish_time').text() || $('.rich_media_meta_text').last().text()).trim();

  let markdown;
  const contentEl = $('#js_content');

  if (contentEl.length && (contentEl.text().trim() || contentEl.find('img[src]').length > 0)) {
    // Standard article type: content in #js_content div
    contentEl.find('script,style,svg,.qr_code_pc_outer,.tips_global,.weapp_text_link').remove();
    const contentHtml = contentEl.html() || '';
    markdown = fixMarkdownImages(td.turndown(contentHtml));
  } else {
    // Video/mixed article type (page_type=2): content encoded in JS as JsDecode('...')
    console.log('[extract] #js_content not found, trying JS-encoded content...');
    // Prefer content_noencode (page_type=2 video articles), fall back to content field
    const jsMatch = html.match(/\bcontent_noencode\s*:\s*JsDecode\('([^']+)'\)/) ||
                    html.match(/\bcontent\s*:\s*JsDecode\('([^']+)'\)/);
    if (jsMatch) {
      const decoded = decodeWxJsDecode(jsMatch[1]);
      // Content is text with \n linebreaks and occasional inline HTML (<a> tags etc.)
      // Wrap paragraph blocks in <p> for proper markdown conversion
      const paragraphs = decoded.split(/\n\n+/).map(p => {
        p = p.trim();
        if (!p) return '';
        // If it starts with a block-level HTML tag, leave as-is
        if (/^<(div|p|h[1-6]|ul|ol|blockquote|pre|table)/i.test(p)) return p;
        return `<p>${p.replace(/\n/g, '<br>')}</p>`;
      }).filter(Boolean).join('\n');
      markdown = td.turndown(paragraphs || decoded);
      console.log(`[extract] JS-decoded content: ${markdown.length} chars`);
    } else {
      throw new Error('未找到正文内容，可能需要登录或链接已过期');
    }
  }

  if (withVision) markdown = await addImageDescriptions(markdown, url);
  return { title, author, publishTime, siteName: '微信公众号', markdown, wordCount: markdown.length };
}

async function extractZhihu(url, withVision) {
  const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';
  const cookie = getSiteCookie('zhihu.com');
  if (!cookie) {
    throw new Error('知乎需要登录才能访问。请在"设置 → 站点Cookie"中添加知乎的 z_c0 Cookie，即可正常提取知乎文章。');
  }
  const html = await fetchHtml(url, UA, {
    'Cookie': cookie,
    'Referer': 'https://www.zhihu.com/',
    'x-requested-with': 'fetch',
  });
  const $ = cheerio.load(html);
  const title = $('h1.Post-Title, .QuestionHeader-title, h1').first().text().trim() ||
    $('meta[property="og:title"]').attr('content') || '';
  const author = $('.AuthorInfo-name, .UserLink-link').first().text().trim() ||
    $('meta[name="author"]').attr('content') || '';
  const contentEl = $('.Post-RichTextContainer, .RichContent-inner, .ztext');
  if (!contentEl.length || !contentEl.text().trim()) {
    // Check if redirected to login
    if (html.includes('请您登录') || html.includes('安全验证') || html.includes('"code":40362')) {
      throw new Error('知乎 Cookie 已失效，请在"设置 → 站点Cookie"中更新知乎的 z_c0 Cookie。');
    }
    throw new Error('无法提取知乎正文，页面结构可能已变化');
  }
  contentEl.find('script,style,.Reward,.FollowButton,.ContentItem-actions').remove();
  let markdown = fixMarkdownImages(td.turndown(contentEl.html() || ''));
  if (withVision) markdown = await addImageDescriptions(markdown, url);
  return { title, author, siteName: '知乎', markdown, wordCount: markdown.length };
}

async function extractGeneric(url, withVision) {
  const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';
  // Check for site-specific cookie
  let cookie = '';
  try {
    const host = new URL(url).hostname.replace(/^www\./, '');
    cookie = getSiteCookie(host);
  } catch { /* ignore */ }
  const html = await fetchHtml(url, UA, cookie ? { 'Cookie': cookie } : {});
  const dom = new JSDOM(html, { url });
  const reader = new Readability(dom.window.document);
  const article = reader.parse();
  if (!article) throw new Error('无法提取页面正文');
  let markdown = fixMarkdownImages(td.turndown(article.content));
  if (withVision) markdown = await addImageDescriptions(markdown, url);
  return { title: article.title || '', byline: article.byline || '', siteName: article.siteName || '', excerpt: article.excerpt || '', markdown, wordCount: article.length || 0 };
}

export { addImageDescriptions };

export async function extractPageMarkdown(url, opts = {}) {
  const withVision = opts.vision !== false;
  const isWeixin = url.includes('mp.weixin.qq.com') || url.includes('weixin.qq.com');
  const isZhihu = url.includes('zhihu.com/p/') || url.includes('zhuanlan.zhihu.com');
  if (isWeixin) return await extractWeixin(url, withVision);
  if (isZhihu) return await extractZhihu(url, withVision);
  return await extractGeneric(url, withVision);
}
