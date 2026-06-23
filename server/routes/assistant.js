import { Router } from 'express';
import defaultDb from '../db.js';
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
import {
  appendAssistantMessage,
  createAssistantConversation,
  deleteAssistantConversation,
  ensureAssistantConversationForTurn,
  listAssistantConversations,
  listAssistantMessages,
  maybeUpdateConversationTitle,
} from '../utils/assistantConversations.js';

const MAX_SOURCES = Number(process.env.ASSISTANT_MAX_SOURCES || 8);
const MAX_FALLBACK_SOURCES = Number(process.env.ASSISTANT_MAX_FALLBACK_SOURCES || 2);
const ASSISTANT_MAX_TOKENS = Number(process.env.ASSISTANT_MAX_TOKENS || 900);

function writeSse(res, event, data) {
  res.write(`event: ${event}\n`);
  res.write(`data: ${JSON.stringify(data)}\n\n`);
}

export function createAssistantRouter(database = defaultDb) {
const router = Router();

router.use(authMiddleware);

function isGroupMember(groupId, userId) {
  return Boolean(database.prepare('SELECT 1 FROM group_members WHERE group_id = ? AND user_id = ?').get(groupId, userId));
}

async function retrieveForRequest(req, { question, task }) {
  const groupId = Number(req.body?.groupId || req.body?.group_id || 0);
  if (groupId && !isGroupMember(groupId, req.userId)) {
    const error = new Error('Group material is not accessible');
    error.status = 403;
    throw error;
  }
  const embeddingConfig = getEmbeddingConfig({ includeSecret: true });
  const ranked = await retrieveAssistantSourcesAsync(database, {
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

function groupIdFromRequest(req) {
  const groupId = Number(req.body?.groupId || req.body?.group_id || req.query?.groupId || req.query?.group_id || 0);
  return Number.isFinite(groupId) && groupId > 0 ? groupId : 0;
}

function requireConversationAccess(req, groupId) {
  if (groupId && !isGroupMember(groupId, req.userId)) {
    const error = new Error('Group conversation is not accessible');
    error.status = 403;
    throw error;
  }
}

router.get('/conversations', (req, res) => {
  const groupId = groupIdFromRequest(req);
  try {
    requireConversationAccess(req, groupId);
    res.json({
      conversations: listAssistantConversations(database, {
        userId: req.userId,
        groupId: groupId || null,
      }),
    });
  } catch (error) {
    res.status(error.status || 500).json({ error: error.message || 'Failed to load conversations' });
  }
});

router.post('/conversations', (req, res) => {
  const groupId = groupIdFromRequest(req);
  try {
    requireConversationAccess(req, groupId);
    const conversation = createAssistantConversation(database, {
      userId: req.userId,
      groupId: groupId || null,
      title: req.body?.title || '',
    });
    res.status(201).json({ conversation });
  } catch (error) {
    res.status(error.status || 500).json({ error: error.message || 'Failed to create conversation' });
  }
});

router.get('/conversations/:id/messages', (req, res) => {
  const groupId = groupIdFromRequest(req);
  try {
    requireConversationAccess(req, groupId);
    const result = listAssistantMessages(database, {
      userId: req.userId,
      conversationId: Number(req.params.id),
      groupId: groupId || null,
    });
    if (!result) return res.status(404).json({ error: 'Conversation not found' });
    res.json(result);
  } catch (error) {
    res.status(error.status || 500).json({ error: error.message || 'Failed to load conversation messages' });
  }
});

router.delete('/conversations/:id', (req, res) => {
  const groupId = groupIdFromRequest(req);
  try {
    requireConversationAccess(req, groupId);
    const ok = deleteAssistantConversation(database, {
      userId: req.userId,
      conversationId: Number(req.params.id),
      groupId: groupId || null,
    });
    if (!ok) return res.status(404).json({ error: 'Conversation not found' });
    res.json({ ok: true });
  } catch (error) {
    res.status(error.status || 500).json({ error: error.message || 'Failed to delete conversation' });
  }
});

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
  const groupId = groupIdFromRequest(req);
  let conversation = null;

  res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
  res.setHeader('Cache-Control', 'no-cache, no-transform');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders?.();

  let ranked;
  try {
    conversation = ensureAssistantConversationForTurn(database, {
      userId: req.userId,
      groupId: groupId || null,
      conversationId: req.body?.conversation_id || req.body?.conversationId || null,
      question,
    });
    maybeUpdateConversationTitle(database, { conversationId: conversation.id, question });
    appendAssistantMessage(database, {
      conversationId: conversation.id,
      role: 'user',
      content: question,
      task,
    });
    writeSse(res, 'conversation', { conversation });
    ({ ranked } = await retrieveForRequest(req, { question, task }));
  } catch (error) {
    if (conversation?.id) {
      appendAssistantMessage(database, {
        conversationId: conversation.id,
        role: 'assistant',
        content: '',
        task,
        error: error.message || 'Assistant retrieval failed',
      });
    }
    writeSse(res, 'error', { error: error.message || 'Assistant retrieval failed' });
    return res.end();
  }
  const sources = publicSources(ranked);
  writeSse(res, 'sources', { sources });

  if (!ranked.length) {
    const emptyAnswer = '没有在你的资料库里找到足够相关的内容。可以换个关键词，或先收藏/上传相关资料。';
    appendAssistantMessage(database, {
      conversationId: conversation.id,
      role: 'assistant',
      content: emptyAnswer,
      task,
      sources,
    });
    writeSse(res, 'delta', { text: emptyAnswer });
    writeSse(res, 'done', {});
    return res.end();
  }

  try {
    let answer = '';
    await streamAIChat({
      messages: buildMessages(question, ranked, task),
      maxTokens: ASSISTANT_MAX_TOKENS,
      enableThinking: false,
      timeoutMs: 90000,
      onToken: async text => {
        const normalized = normalizeCitationText(text, sources.length);
        answer += normalized;
        writeSse(res, 'delta', { text: normalized });
      },
    });
    appendAssistantMessage(database, {
      conversationId: conversation.id,
      role: 'assistant',
      content: normalizeCitationText(answer, sources.length),
      task,
      sources,
    });
    writeSse(res, 'done', {});
    res.end();
  } catch (e) {
    console.error('Assistant stream failed:', e.message);
    if (conversation?.id) {
      appendAssistantMessage(database, {
        conversationId: conversation.id,
        role: 'assistant',
        content: '',
        task,
        sources,
        error: e.message || '资料助理生成失败',
      });
    }
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

return router;
}

export default createAssistantRouter();
