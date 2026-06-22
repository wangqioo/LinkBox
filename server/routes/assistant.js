import { Router } from 'express';
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
const ASSISTANT_RETRY_CONTEXT_CHARS = Number(process.env.ASSISTANT_RETRY_CONTEXT_CHARS || 900);
const ASSISTANT_RETRY_FIELD_CHARS = Number(process.env.ASSISTANT_RETRY_FIELD_CHARS || 500);
const ASSISTANT_RETRY_MAX_TOKENS = Number(process.env.ASSISTANT_RETRY_MAX_TOKENS || 120);

router.use(authMiddleware);

function writeSse(res, event, data) {
  res.write(`event: ${event}\n`);
  res.write(`data: ${JSON.stringify(data)}\n\n`);
}

function isLocalRkllmFailure(error) {
  return /RKLLM resident demo pty read failed|Input\/output error|LLM error 500/i.test(String(error?.message || error || ''));
}

function compactMessages(question, ranked, task) {
  return buildMessages(question, ranked.slice(0, 1), task, {
    maxContextChars: ASSISTANT_RETRY_CONTEXT_CHARS,
    maxFieldChars: ASSISTANT_RETRY_FIELD_CHARS,
  });
}

async function callAssistantWithFallback({ question, ranked, task, onToken }) {
  const messages = buildMessages(question, ranked, task);
  try {
    if (onToken) {
      return await streamAIChat({
        messages,
        maxTokens: ASSISTANT_MAX_TOKENS,
        enableThinking: false,
        timeoutMs: 90000,
        onToken,
      });
    }
    return await callAIChat({
      messages,
      maxTokens: ASSISTANT_MAX_TOKENS,
      timeoutMs: 90000,
    });
  } catch (error) {
    if (!isLocalRkllmFailure(error)) throw error;
    console.warn('Assistant local RKLLM failed; retrying with compact context:', error.message);
    if (onToken) {
      return await streamAIChat({
        messages: compactMessages(question, ranked, task),
        maxTokens: ASSISTANT_RETRY_MAX_TOKENS,
        enableThinking: false,
        timeoutMs: 90000,
        onToken,
      });
    }
    const answer = await callAIChat({
      messages: compactMessages(question, ranked, task),
      maxTokens: ASSISTANT_RETRY_MAX_TOKENS,
      timeoutMs: 90000,
    });
    await onToken?.(answer);
    return answer;
  }
}

async function retrieveForRequest(req, { question, task }) {
  const embeddingConfig = getEmbeddingConfig({ includeSecret: true });
  const ranked = await retrieveAssistantSourcesAsync(db, {
    userId: req.userId,
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

  const { ranked } = await retrieveForRequest(req, { question, task });
  if (!ranked.length) {
    return res.json({
      answer: '没有在你的资料库里找到足够相关的内容。可以换个关键词，或先收藏/上传相关资料。',
      sources: [],
    });
  }

  const answer = await callAssistantWithFallback({ question, ranked, task });
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

  const { ranked } = await retrieveForRequest(req, { question, task });
  const sources = publicSources(ranked);
  writeSse(res, 'sources', { sources });

  if (!ranked.length) {
    writeSse(res, 'delta', { text: '没有在你的资料库里找到足够相关的内容。可以换个关键词，或先收藏/上传相关资料。' });
    writeSse(res, 'done', {});
    return res.end();
  }

  try {
    await callAssistantWithFallback({
      question,
      ranked,
      task,
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
  const { ranked, embeddingConfig } = await retrieveForRequest(req, { question, task });

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
