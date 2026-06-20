import { Readability } from '@mozilla/readability';
import { JSDOM } from 'jsdom';
import {
  addImageDescriptions,
  fetchHtml,
  fixMarkdownImages,
  getSiteCookie,
  td,
} from './shared.js';

export async function extractGeneric(url, withVision) {
  const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';
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
  return {
    title: article.title || '',
    byline: article.byline || '',
    siteName: article.siteName || '',
    excerpt: article.excerpt || '',
    markdown,
    wordCount: article.length || 0,
  };
}
