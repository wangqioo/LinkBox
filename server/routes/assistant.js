import { Router } from 'express';
import db from '../db.js';
import { authMiddleware } from '../middleware/auth.js';
import { callAIChat, streamAIChat } from '../utils/aiConfig.js';
import { indexAllMissingChunks, scoreTextFields, searchRelevantChunks, tokenizeQuery } from '../utils/chunkIndex.js';

const router = Router();
const MAX_SOURCES = Number(process.env.ASSISTANT_MAX_SOURCES || 8);
const MAX_FALLBACK_SOURCES = Number(process.env.ASSISTANT_MAX_FALLBACK_SOURCES || 2);
const MAX_CONTEXT_CHARS = Number(process.env.ASSISTANT_MAX_CONTEXT_CHARS || 12000);
const MAX_FIELD_CHARS = Number(process.env.ASSISTANT_MAX_FIELD_CHARS || 5000);
const ASSISTANT_MAX_TOKENS = Number(process.env.ASSISTANT_MAX_TOKENS || 900);

const TASKS = {
  ask: {
    label: '问资料',
    instruction: '回答用户问题。结论要直接，必要时给出依据和下一步建议。',
  },
  recent: {
    label: '总结最近',
    instruction: '总结最近资料的主题、关键结论、值得继续研究的内容和可能的下一步行动。',
  },
  report: {
    label: '生成报告',
    instruction: '把资料整理成结构化报告，包含背景、核心发现、机会、风险、建议和行动计划。',
  },
  organize: {
    label: '整理标签',
    instruction: '根据资料内容给出分类、建议标签、可合并主题、重复或相似资料，以及整理建议。',
  },
  todos: {
    label: '提取待办',
    instruction: '从资料中提取可执行待办，按优先级分组，并给出检查清单。',
  },
};

router.use(authMiddleware);

function tokenize(text) {
  return tokenizeQuery(text);
}

function scoreItem(item, tokens) {
  let score = scoreTextFields(item, tokens, {
    title: 8,
    summary: 5,
    comment: 4,
    url: 3,
    content_md: 1,
    content: 1,
  });

  if (item.summary) score += 1;
  if (item.content_md) score += 1;
  return score;
}

function textForItem(item) {
  return [
    item.title ? `标题：${item.title}` : '',
    item.url ? `链接：${item.url}` : '',
    item.summary ? `摘要：${item.summary}` : '',
    item.chunk_text ? `相关片段：\n${item.chunk_text}` : (
      item.content_md ? `正文 Markdown：\n${item.content_md}` : (item.content ? `内容：\n${item.content}` : '')
    ),
  ].filter(Boolean).join('\n');
}

function groupSources(items) {
  const groups = [];
  const indexBySource = new Map();

  for (const item of items) {
    const sourceKey = sourceDedupeKey(item);
    let group = indexBySource.get(sourceKey);
    if (!group) {
      group = {
        ...item,
        source_index: groups.length + 1,
        chunks: [],
      };
      indexBySource.set(sourceKey, group);
      groups.push(group);
    }

    if (item.chunk_text) {
      group.chunks.push(item);
    } else if (!group.content_md && !group.content) {
      group.content_md = item.content_md;
      group.content = item.content;
    }
  }

  return groups;
}

function normalizeUrlKey(url) {
  return String(url || '')
    .trim()
    .replace(/#.*$/, '')
    .replace(/[?&]utm_[^=&]+=[^&]*/gi, '')
    .replace(/[?&](from|scene|clicktime|enterid|ascene|devicetype|version|nettype|lang)=[^&]*/gi, '')
    .replace(/[?&]$/, '')
    .replace(/\/$/, '')
    .toLowerCase();
}

function normalizeTitleKey(title) {
  return String(title || '').trim().replace(/\s+/g, ' ').toLowerCase();
}

function sourceDedupeKey(item) {
  const url = normalizeUrlKey(item.url);
  const title = normalizeTitleKey(item.title);
  if (title && (url.includes('mp.weixin.qq.com') || title.length >= 8)) return `title:${title}`;
  if (url) return `url:${url}`;
  if (title) return `title:${title}`;
  return `id:${item.id}`;
}

function trimContext(sources) {
  const blocks = [];
  let total = 0;

  for (const source of sources) {
    const body = source.chunks?.length
      ? [
          source.title ? `标题：${source.title}` : '',
          source.url ? `链接：${source.url}` : '',
          source.summary ? `摘要：${source.summary}` : '',
          ...source.chunks.map((chunk, index) => `相关片段 ${index + 1}：\n${chunk.chunk_text}`),
        ].filter(Boolean).join('\n\n')
      : textForItem(source);
    const block = `资料 ${source.source_index}（ID: ${source.id}）\n${body}`;
    if (total + block.length > MAX_CONTEXT_CHARS && blocks.length > 0) break;
    const trimmed = block.slice(0, MAX_FIELD_CHARS);
    blocks.push(trimmed);
    total += trimmed.length;
  }

  return blocks.join('\n\n---\n\n');
}

function publicSource(item) {
  return {
    id: item.id,
    link_id: item.id,
    type: item.type,
    title: item.chunk_index !== undefined
      ? `${item.title || item.url || `资料 ${item.id}`} · 片段 ${item.chunk_index + 1}`
      : (item.title || item.url || `资料 ${item.id}`),
    url: item.url || '',
    summary: item.summary || '',
    imported_at: item.imported_at,
  };
}

function publicSources(items) {
  return groupSources(items).map(item => ({
    id: item.id,
    link_id: item.id,
    type: item.type,
    title: item.title || item.url || `璧勬枡 ${item.id}`,
    url: item.url || '',
    summary: item.summary || '',
    imported_at: item.imported_at,
    chunks: publicChunks(item.chunks || []),
  }));
}

function publicChunks(chunks) {
  const seen = new Set();
  return chunks
    .map((chunk, index) => {
      const text = String(chunk.chunk_text || '').replace(/\s+/g, ' ').trim();
      return {
        id: chunk.chunk_id || `${chunk.id || 'chunk'}-${index}`,
        index: index + 1,
        chunk_index: chunk.chunk_index,
        text: text.slice(0, 420),
      };
    })
    .filter(chunk => {
      if (!chunk.text) return false;
      const key = chunk.text.slice(0, 180);
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .slice(0, 8);
}

function normalizeTask(task) {
  return TASKS[task] ? task : 'ask';
}

function shouldUseFallbackSources(task, question) {
  if (task === 'ask') return false;
  if (task === 'recent') return true;
  return tokenize(question).length < 2;
}

function normalizeScope(scope = {}) {
  const date = String(scope.date || '').trim();
  const type = String(scope.type || '').trim();
  return {
    date: /^\d{4}-\d{2}-\d{2}$/.test(date) ? date : '',
    type: type === 'document' ? 'file' : type,
  };
}

function scopeWhere(scope, params) {
  const conditions = [];
  if (scope.date) {
    conditions.push('substr(l.imported_at, 1, 10) = ?');
    params.push(scope.date);
  }
  if (scope.type) {
    conditions.push('l.type = ?');
    params.push(scope.type);
  }
  return conditions;
}

function retrieveSources(userId, question, task = 'ask', rawScope = {}) {
  indexAllMissingChunks();
  const scope = normalizeScope(rawScope);
  const chunks = searchRelevantChunks({ userId, query: question, task, limit: MAX_SOURCES, scope });
  if (chunks.length) {
    return chunks.map((item, index) => ({ ...item, source_index: index + 1 }));
  }

  const params = [userId];
  const scopedConditions = scopeWhere(scope, params);
  const rows = db.prepare(`
    SELECT id, type, url, title, description, comment, content, content_md, summary, imported_at
    FROM links l
    WHERE l.user_id = ?
      AND (
        COALESCE(l.content_md, '') != ''
        OR COALESCE(l.summary, '') != ''
        OR COALESCE(l.content, '') != ''
        OR COALESCE(l.title, '') != ''
      )
      ${scopedConditions.length ? `AND ${scopedConditions.join(' AND ')}` : ''}
    ORDER BY l.imported_at DESC
    LIMIT 1000
  `).all(...params);

  if (task === 'recent') {
    return rows.slice(0, MAX_SOURCES).map((item, index) => ({ ...item, source_index: index + 1 }));
  }

  const tokens = tokenize(question);
  const ranked = rows
    .map(item => ({ ...item, score: scoreItem(item, tokens) }))
    .filter(item => item.score > 0)
    .sort((a, b) => b.score - a.score || String(b.imported_at || '').localeCompare(String(a.imported_at || '')))
    .slice(0, MAX_SOURCES)
    .map((item, index) => ({ ...item, source_index: index + 1 }));

  if (ranked.length) return ranked;
  if (!shouldUseFallbackSources(task, question)) return [];
  return rows.slice(0, MAX_FALLBACK_SOURCES).map((item, index) => ({ ...item, source_index: index + 1 }));
}

function buildMessages(question, ranked, task = 'ask') {
  const taskConfig = TASKS[normalizeTask(task)];
  const grouped = groupSources(ranked);
  const context = trimContext(grouped);
  const sourceIds = grouped.map(source => `[资料${source.source_index}]`).join('、');
  return [
    {
      role: 'system',
      content: `你是 LinkBox 私人资料助理。不要输出思考过程。只能基于用户提供的资料工作；资料不足时明确说明不足。回答要具体、可执行，使用 Markdown 组织结构。引用只能使用这些编号：${sourceIds || '无'}。引用格式必须是完整的 [资料1]，不要写 [资料1-3]、[资料21] 或缺少右括号。当前任务：${taskConfig.label}。任务要求：${taskConfig.instruction}`,
    },
    {
      role: 'user',
      content: `用户问题：${question}\n\n可用资料：\n${context}\n\n请用中文回答，并附上你实际使用的资料编号。`,
    },
  ];
}

function writeSse(res, event, data) {
  res.write(`event: ${event}\n`);
  res.write(`data: ${JSON.stringify(data)}\n\n`);
}

function normalizeCitationText(text, maxSourceNumber) {
  return String(text || '')
    .replace(/\[资料(\d+)\s*-\s*(\d+)\]/g, (_, start, end) => {
      const from = Number(start);
      const to = Math.min(Number(end), maxSourceNumber);
      if (!Number.isFinite(from) || !Number.isFinite(to) || from > to) return '';
      return Array.from({ length: to - from + 1 }, (_v, index) => `[资料${from + index}]`).join('');
    })
    .replace(/\[资料(\d+)(?!\])/g, (match, n) => {
      const value = Number(n);
      if (!Number.isFinite(value) || value > maxSourceNumber) return match;
      return `[资料${value}]`;
    });
}

router.post('/chat', async (req, res) => {
  const question = String(req.body?.question || '').trim();
  if (!question) return res.status(400).json({ error: '问题不能为空' });
  const task = normalizeTask(req.body?.task);

  const ranked = retrieveSources(req.userId, question, task, req.body?.scope);
  if (!ranked.length) {
    return res.json({
      answer: '没有在你的资料库里找到足够相关的内容。可以换个关键词，或先收藏/上传相关资料。',
      sources: [],
    });
  }

  const answer = await callAIChat({
    messages: buildMessages(question, ranked, task),
    maxTokens: ASSISTANT_MAX_TOKENS,
    timeoutMs: 90000,
  });
  const sources = publicSources(ranked);

  res.json({
    answer: normalizeCitationText(answer, sources.length),
    sources,
  });
});

router.post('/chat/stream', async (req, res) => {
  const question = String(req.body?.question || '').trim();
  if (!question) return res.status(400).json({ error: '问题不能为空' });
  const task = normalizeTask(req.body?.task);

  res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
  res.setHeader('Cache-Control', 'no-cache, no-transform');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders?.();

  const ranked = retrieveSources(req.userId, question, task, req.body?.scope);
  const sources = publicSources(ranked);
  writeSse(res, 'sources', { sources });

  if (!ranked.length) {
    writeSse(res, 'delta', { text: '没有在你的资料库里找到足够相关的内容。可以换个关键词，或先收藏/上传相关资料。' });
    writeSse(res, 'done', {});
    return res.end();
  }

  try {
    await streamAIChat({
      messages: buildMessages(question, ranked, task),
      maxTokens: ASSISTANT_MAX_TOKENS,
      enableThinking: false,
      timeoutMs: 90000,
      onToken: async text => writeSse(res, 'delta', { text: normalizeCitationText(text, sources.length) }),
    });
    writeSse(res, 'done', {});
    res.end();
  } catch (e) {
    console.error('Assistant stream failed:', e.message);
    writeSse(res, 'error', { error: e.message || '资料助理生成失败' });
    res.end();
  }
});

export default router;
