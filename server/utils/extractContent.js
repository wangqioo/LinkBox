import * as cheerio from 'cheerio';
import { Readability } from '@mozilla/readability';
import { JSDOM } from 'jsdom';
import TurndownService from 'turndown';

const td = new TurndownService({
  headingStyle: 'atx',
  hr: '---',
  bulletListMarker: '-',
  codeBlockStyle: 'fenced',
});

async function fetchHtml(url, ua) {
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
      },
    });
    if (!res.ok) throw new Error('HTTP ' + res.status);
    return await res.text();
  } finally {
    clearTimeout(timer);
  }
}

// WeChat official account article extractor
async function extractWeixin(url) {
  const WX_UA = 'Mozilla/5.0 (Linux; Android 13; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/116.0.0.0 Mobile Safari/537.36 MicroMessenger/8.0.43.2560 NetType/WIFI Language/zh_CN';
  const html = await fetchHtml(url, WX_UA);
  const $ = cheerio.load(html);

  // Fix lazy-loaded images: data-src -> src
  $('img[data-src]').each((_, el) => {
    const src = $(el).attr('data-src');
    if (src) $(el).attr('src', src);
  });

  const title = ($('#activity-name').text() || $('.rich_media_title').text()).trim();
  const author = ($('#js_name').text() || $('.rich_media_meta_text').first().text()).trim();
  const publishTime = ($('#publish_time').text() || $('.rich_media_meta_text').last().text()).trim();
  const contentEl = $('#js_content');

  if (!contentEl.length) throw new Error('未找到正文内容，可能需要登录或链接已过期');

  // Remove WeChat clutter
  contentEl.find('script,style,svg,.qr_code_pc_outer,.tips_global,.weapp_text_link').remove();

  const contentHtml = contentEl.html() || '';
  const markdown = td.turndown(contentHtml);

  return {
    title,
    author,
    publishTime,
    siteName: '微信公众号',
    markdown,
    wordCount: markdown.length,
  };
}

// Generic extractor using Readability
async function extractGeneric(url) {
  const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';
  const html = await fetchHtml(url, UA);

  const dom = new JSDOM(html, { url });
  const reader = new Readability(dom.window.document);
  const article = reader.parse();

  if (!article) throw new Error('无法提取页面正文');

  const markdown = td.turndown(article.content);
  return {
    title: article.title || '',
    byline: article.byline || '',
    siteName: article.siteName || '',
    excerpt: article.excerpt || '',
    markdown,
    wordCount: article.length || 0,
  };
}

export async function extractPageMarkdown(url) {
  const isWeixin = url.includes('mp.weixin.qq.com') || url.includes('weixin.qq.com');
  if (isWeixin) {
    return await extractWeixin(url);
  }
  return await extractGeneric(url);
}
