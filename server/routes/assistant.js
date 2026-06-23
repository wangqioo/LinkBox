import { Router } from 'express';
import { requireGroupMember } from './social.js';
import db from '../db.js';
import { authMiddleware } from '../middleware/auth.js';
import { callAIChat, streamAIChat } from '../utils/aiConfig.js';
import { getEmbeddingConfig } from '../utils/embeddingConfig.js';
import {
  buildRetrievalDiagnostics,
  retrieveAssistantSourcesAsync,
} from '../utils/assistantSourceRetrieval.js';
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

async function retrieveForRequest(req, { question, task }) {
  const groupId = Number(req.body?.groupId || req.body?.group_id || 0);
  if (groupId && !requireGroupMember(groupId, req.userId)) {
    const error = new Error('Group material is not accessible');
    error.status = 403;
    throw error;
  }
  const embeddingConfig = getEmbeddingConfig({ includeSecret: true });
  const ranked = await retrieveAssistantSourcesAsync(db, {
    userId: req.userId,
    groupId: groupId || undefined,
    question,
    task,
    scope: req.body?.scope,
    maxSources: MAX_SOURCES,
    maxFallbackSources: MAX_FALLBACK_SOURCES,
    enableEmbeddings: embeddingConfig.enabled,
    embeddingOptions: {
      provider: embeddingConfig.provider,
      model: embeddingConfig.model,
      embeddingConfig,
    },
  });
  return {
    ranked,
    embeddingConfig,
  };
}

router.post('/chat', async (req, res) => {
  const question = String(req.body?.question || '').trim();
  if (!question) return res.status(400).json({ error: '问题不能为空' });
  const task = normalizeTask(req.body?.task);

  let ranked;
  try {
    ({ ranked } = await retrieveForRequest(req, { question, task }));
  } catch (error) {
    return res.status(error.status || 500).json({ error: error.message || 'Assistant retrieval failed' });
  }
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

  let ranked;
  try {
    ({ ranked } = await retrieveForRequest(req, { question, task }));
  } catch (error) {
    writeSse(res, 'error', { error: error.message || 'Assistant retrieval failed' });
    return res.end();
  }
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

router.post('/retrieval-diagnostics', async (req, res) => {
  const question = String(req.body?.question || '').trim();
  if (!question) return res.status(400).json({ error: '问题不能为空' });
  const task = normalizeTask(req.body?.task);
  let ranked;
  let embeddingConfig;
  try {
    ({ ranked, embeddingConfig } = await retrieveForRequest(req, { question, task }));
  } catch (error) {
    return res.status(error.status || 500).json({ error: error.message || 'Assistant retrieval failed' });
  }

  res.json(buildRetrievalDiagnostics({
    question,
    task,
    scope: req.body?.scope || {},
    sources: ranked,
    settings: {
      enabled: embeddingConfig.enabled,
      maxSources: MAX_SOURCES,
      maxFallbackSources: MAX_FALLBACK_SOURCES,
      provider: embeddingConfig.provider,
      baseUrl: embeddingConfig.baseUrl,
      model: embeddingConfig.model,
      apiKeyConfigured: Boolean(embeddingConfig.apiKey || embeddingConfig.apiKeyConfigured),
    },
  }));
});

export default router;
