import { Router } from 'express';
import db from '../db.js';
import { authMiddleware } from '../middleware/auth.js';
import { callAIChat, streamAIChat } from '../utils/aiConfig.js';
import { retrieveSources } from '../utils/assistantRetrieval.js';
import {
  buildMessages,
  normalizeCitationText,
  normalizeTask,
  publicSources,
} from '../utils/assistantTurn.js';

const router = Router();
const MAX_SOURCES = Number(process.env.ASSISTANT_MAX_SOURCES || 8);
const MAX_FALLBACK_SOURCES = Number(process.env.ASSISTANT_MAX_FALLBACK_SOURCES || 2);
const ASSISTANT_MAX_TOKENS = Number(process.env.ASSISTANT_MAX_TOKENS || 900);

router.use(authMiddleware);

function writeSse(res, event, data) {
  res.write(`event: ${event}\n`);
  res.write(`data: ${JSON.stringify(data)}\n\n`);
}

router.post('/chat', async (req, res) => {
  const question = String(req.body?.question || '').trim();
  if (!question) return res.status(400).json({ error: '问题不能为空' });
  const task = normalizeTask(req.body?.task);

  const ranked = retrieveSources({
    db,
    userId: req.userId,
    question,
    task,
    scope: req.body?.scope,
    maxSources: MAX_SOURCES,
    maxFallbackSources: MAX_FALLBACK_SOURCES,
  });
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

  const ranked = retrieveSources({
    db,
    userId: req.userId,
    question,
    task,
    scope: req.body?.scope,
    maxSources: MAX_SOURCES,
    maxFallbackSources: MAX_FALLBACK_SOURCES,
  });
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
