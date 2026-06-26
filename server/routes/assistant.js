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
import { completeAssistantAgentAnswer, prepareAssistantAgentTurn } from '../utils/assistantAgent.js';
import {
  captureAssistantMemories,
  deleteAssistantMemory,
  listAssistantMemories,
} from '../utils/assistantMemory.js';
import { httpError, jsonError } from '../utils/appError.js';

const MAX_SOURCES = Number(process.env.ASSISTANT_MAX_SOURCES || 8);
const MAX_FALLBACK_SOURCES = Number(process.env.ASSISTANT_MAX_FALLBACK_SOURCES || 2);
const ASSISTANT_MAX_TOKENS = Number(process.env.ASSISTANT_MAX_TOKENS || 900);

function writeSse(res, event, data) {
  res.write(`event: ${event}\n`);
  res.write(`data: ${JSON.stringify(data)}\n\n`);
}

function publicAgentTurn(agentTurn) {
  return {
    plan: agentTurn.plan,
    evidence: agentTurn.evidence,
    verification: agentTurn.verification,
    memory: agentTurn.memory,
    run: agentTurn.agent.run,
  };
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
    throw httpError(403, 'Group material is not accessible');
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

async function prepareAgentTurnForRequest(req, { question, task, conversationId = null }) {
  const groupId = groupIdFromRequest(req);
  captureAssistantMemories(database, {
    userId: req.userId,
    groupId: groupId || null,
    text: question,
  });
  return prepareAssistantAgentTurn({
    db: database,
    userId: req.userId,
    conversationId,
    groupId: groupId || null,
    question,
    task,
    scope: req.body?.scope || {},
    retrieve: ({ question: plannedQuestion }) => retrieveForRequest(req, { question: plannedQuestion, task }),
  });
}

function groupIdFromRequest(req) {
  const groupId = Number(req.body?.groupId || req.body?.group_id || req.query?.groupId || req.query?.group_id || 0);
  return Number.isFinite(groupId) && groupId > 0 ? groupId : 0;
}

function requireConversationAccess(req, groupId) {
  if (groupId && !isGroupMember(groupId, req.userId)) {
    throw httpError(403, 'Group conversation is not accessible');
  }
}

router.get('/memories', (req, res) => {
  const groupId = groupIdFromRequest(req);
  try {
    requireConversationAccess(req, groupId);
    res.json({
      memories: listAssistantMemories({
        db: database,
        userId: req.userId,
        groupId: groupId || null,
      }),
    });
  } catch (error) {
    jsonError(res, error, 'Failed to load assistant memories');
  }
});

router.delete('/memories/:id', (req, res) => {
  const groupId = groupIdFromRequest(req);
  try {
    requireConversationAccess(req, groupId);
    const ok = deleteAssistantMemory(database, {
      userId: req.userId,
      groupId: groupId || null,
      memoryId: Number(req.params.id),
    });
    if (!ok) return jsonError(res, httpError(404, 'Memory not found'), 'Failed to delete assistant memory');
    res.json({ ok: true });
  } catch (error) {
    jsonError(res, error, 'Failed to delete assistant memory');
  }
});

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
    jsonError(res, error, 'Failed to load conversations');
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
    jsonError(res, error, 'Failed to create conversation');
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
    if (!result) return jsonError(res, httpError(404, 'Conversation not found'), 'Failed to load conversation messages');
    res.json(result);
  } catch (error) {
    jsonError(res, error, 'Failed to load conversation messages');
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
    if (!ok) return jsonError(res, httpError(404, 'Conversation not found'), 'Failed to delete conversation');
    res.json({ ok: true });
  } catch (error) {
    jsonError(res, error, 'Failed to delete conversation');
  }
});

router.post('/chat', async (req, res) => {
  const question = String(req.body?.question || '').trim();
  if (!question) return jsonError(res, httpError(400, '问题不能为空'), 'Assistant chat failed');
  const task = normalizeTask(req.body?.task);

  let agentTurn;
  try {
    agentTurn = await prepareAgentTurnForRequest(req, { question, task });
  } catch (error) {
    return jsonError(res, error, 'Assistant retrieval failed');
  }
  const ranked = agentTurn.ranked;
  if (!ranked.length) {
    agentTurn = completeAssistantAgentAnswer({
      db: database,
      agentTurn,
      answer: '没有在你的资料库里找到足够相关的内容。可以换个关键词，或先收藏/上传相关资料。',
      sourceCount: 0,
    });
    return res.json({
      answer: '没有在你的资料库里找到足够相关的内容。可以换个关键词，或先收藏/上传相关资料。',
      sources: [],
      agent: publicAgentTurn(agentTurn),
    });
  }

  const answer = await callAIChat({
    messages: buildMessages(question, ranked, task, {
      memoryItems: agentTurn.memory.items,
      plan: agentTurn.plan,
      retrievalConfidence: agentTurn.retrievalConfidence,
      verification: agentTurn.verification,
    }),
    maxTokens: ASSISTANT_MAX_TOKENS,
    timeoutMs: 90000,
  });
  const sources = publicSources(ranked);
  const normalizedAnswer = normalizeCitationText(answer, sources.length);
  agentTurn = completeAssistantAgentAnswer({
    db: database,
    agentTurn,
    answer: normalizedAnswer,
    sourceCount: sources.length,
  });

  res.json({
    answer: normalizedAnswer,
    sources,
    agent: publicAgentTurn(agentTurn),
  });
});

router.post('/chat/stream', async (req, res) => {
  const question = String(req.body?.question || '').trim();
  if (!question) return jsonError(res, httpError(400, '问题不能为空'), 'Assistant stream failed');
  const task = normalizeTask(req.body?.task);
  const groupId = groupIdFromRequest(req);
  let conversation = null;

  res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
  res.setHeader('Cache-Control', 'no-cache, no-transform');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders?.();

  let agentTurn;
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
    agentTurn = await prepareAgentTurnForRequest(req, {
      question,
      task,
      conversationId: conversation.id,
    });
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
  const ranked = agentTurn.ranked;
  const sources = publicSources(ranked);
  writeSse(res, 'agent', { agent: publicAgentTurn(agentTurn) });
  writeSse(res, 'sources', { sources });

  if (!ranked.length) {
    const emptyAnswer = '没有在你的资料库里找到足够相关的内容。可以换个关键词，或先收藏/上传相关资料。';
    agentTurn = completeAssistantAgentAnswer({
      db: database,
      agentTurn,
      answer: emptyAnswer,
      sourceCount: 0,
    });
    appendAssistantMessage(database, {
      conversationId: conversation.id,
      role: 'assistant',
      content: emptyAnswer,
      task,
      sources,
      agent: {
        runId: agentTurn.agent.run.id,
        verification: agentTurn.verification,
      },
    });
    writeSse(res, 'agent', { agent: publicAgentTurn(agentTurn) });
    writeSse(res, 'delta', { text: emptyAnswer });
    writeSse(res, 'done', {});
    return res.end();
  }

  try {
    let answer = '';
    await streamAIChat({
      messages: buildMessages(question, ranked, task, {
        memoryItems: agentTurn.memory.items,
        plan: agentTurn.plan,
        retrievalConfidence: agentTurn.retrievalConfidence,
        verification: agentTurn.verification,
      }),
      maxTokens: ASSISTANT_MAX_TOKENS,
      enableThinking: false,
      timeoutMs: 90000,
      onToken: async text => {
        const normalized = normalizeCitationText(text, sources.length);
        answer += normalized;
        writeSse(res, 'delta', { text: normalized });
      },
    });
    if (!answer.trim()) {
      throw new Error('本地模型没有生成有效回答，请稍后重试或切换更稳定的 AI 模型。');
    }
    const normalizedAnswer = normalizeCitationText(answer, sources.length);
    agentTurn = completeAssistantAgentAnswer({
      db: database,
      agentTurn,
      answer: normalizedAnswer,
      sourceCount: sources.length,
    });
    appendAssistantMessage(database, {
      conversationId: conversation.id,
      role: 'assistant',
      content: normalizedAnswer,
      task,
      sources,
      agent: {
        runId: agentTurn.agent.run.id,
        verification: agentTurn.verification,
      },
    });
    writeSse(res, 'agent', { agent: publicAgentTurn(agentTurn) });
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
  if (!question) return jsonError(res, httpError(400, '问题不能为空'), 'Assistant retrieval failed');
  const task = normalizeTask(req.body?.task);
  let agentTurn;
  try {
    agentTurn = await prepareAgentTurnForRequest(req, { question, task });
  } catch (error) {
    return jsonError(res, error, 'Assistant retrieval failed');
  }
  const { ranked, embeddingConfig } = agentTurn;

  const diagnostics = buildRetrievalDiagnostics({
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
  });
  res.json({
    ...diagnostics,
    agent: publicAgentTurn(agentTurn),
  });
});

return router;
}

export default createAssistantRouter();
