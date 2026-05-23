// OpenAI-compatible LLM helpers. Runtime configuration is stored in settings.
import { callAIChat } from './aiConfig.js';

async function callLLM(systemPrompt, userPrompt, maxTokens = 200) {
  return callAIChat({
    messages: [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userPrompt },
    ],
    maxTokens,
    timeoutMs: 60000,
  });
}

/**
 * Summarize link/text content.
 * type: 'link' | 'text'
 */
export async function summarizeContent(text, type = 'link') {
  const truncated = text.slice(0, 2000);
  const systemPrompt = '你是内容摘要助手。直接输出摘要，不要解释，不要客套。';
  const userPrompt = type === 'text'
    ? `用中文写一段80字以内的摘要：\n\n${truncated}`
    : `用中文写一段80字以内的网页摘要：\n\n标题及描述：${truncated}`;
  return callLLM(systemPrompt, userPrompt, 200);
}

/**
 * Convert markdown to plain text suitable for LLM input:
 * - Image description blockquotes (> 图片描述：xxx) → [图：xxx]
 * - Bare image lines (![alt](url)) → dropped
 * Ensures image descriptions are treated as first-class content.
 */
export function markdownToSummaryText(markdown) {
  return markdown
    .split('\n')
    .map(line => {
      const descMatch = line.match(/^>\s*图片描述[：:]\s*(.+)/);
      if (descMatch) return `[图：${descMatch[1].trim()}]`;
      if (/^!\[.*?\]\(https?:\/\/[^)]+\)$/.test(line.trim())) return '';
      return line;
    })
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/**
 * Summarize extracted markdown content (used after auto-extraction).
 */
export async function summarizeMarkdown(markdown, title = '') {
  const plainText = markdownToSummaryText(markdown);
  // If article is image-only (no real text), use all image descriptions
  const truncated = plainText.slice(0, 3000);
  if (!truncated.trim()) return '';
  const systemPrompt = '你是内容摘要助手。直接输出摘要，不要解释。';
  const userPrompt = `文章标题：${title}\n\n正文内容：\n${truncated}\n\n请用中文写一段100字以内的摘要：`;
  return callLLM(systemPrompt, userPrompt, 250);
}
