import * as cheerio from 'cheerio';
import {
  addImageDescriptions,
  fetchHtml,
  fixMarkdownImages,
  preserveHtmlTables,
  td,
} from './shared.js';

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

export async function extractWeixin(url, withVision) {
  const WX_UA = 'Mozilla/5.0 (Linux; Android 13; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/116.0.0.0 Mobile Safari/537.36 MicroMessenger/8.0.43.2560 NetType/WIFI Language/zh_CN';
  const html = await fetchHtml(url, WX_UA);
  const $ = cheerio.load(html);
  $('img[data-src]').each((_, el) => {
    const src = $(el).attr('data-src');
    if (src) $(el).attr('src', src);
  });

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
    contentEl.find('script,style,svg,.qr_code_pc_outer,.tips_global,.weapp_text_link').remove();
    const contentHtml = preserveHtmlTables(contentEl.html() || '');
    markdown = fixMarkdownImages(td.turndown(contentHtml));
  } else {
    console.log('[extract] #js_content not found, trying JS-encoded content...');
    const jsMatch = html.match(/\bcontent_noencode\s*:\s*JsDecode\('([^']+)'\)/) ||
                    html.match(/\bcontent\s*:\s*JsDecode\('([^']+)'\)/);
    if (jsMatch) {
      const decoded = decodeWxJsDecode(jsMatch[1]);
      const paragraphs = decoded.split(/\n\n+/).map(p => {
        p = p.trim();
        if (!p) return '';
        if (/^<(div|p|h[1-6]|ul|ol|blockquote|pre|table)/i.test(p)) return p;
        return `<p>${p.replace(/\n/g, '<br>')}</p>`;
      }).filter(Boolean).join('\n');
      markdown = td.turndown(preserveHtmlTables(paragraphs || decoded));
      console.log(`[extract] JS-decoded content: ${markdown.length} chars`);
    } else {
      throw new Error('未找到正文内容，可能需要登录或链接已过期');
    }
  }

  if (withVision) markdown = await addImageDescriptions(markdown, url);
  return { title, author, publishTime, siteName: '微信公众号', markdown, wordCount: markdown.length };
}
