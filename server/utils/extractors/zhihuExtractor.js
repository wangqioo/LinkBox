import * as cheerio from 'cheerio';
import {
  addImageDescriptions,
  fetchHtml,
  fixMarkdownImages,
  getSiteCookie,
  td,
} from './shared.js';

export async function extractZhihu(url, withVision) {
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
