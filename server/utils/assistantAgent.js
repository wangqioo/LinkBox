import { planAssistantTurn, summarizeRetrievalPlan } from './assistantAgentPlanner.js';
import { buildEvidenceNotebook } from './assistantEvidence.js';
import {
  finishAssistantRun,
  getAssistantRun,
  recordAssistantRunStep,
  startAssistantRun,
} from './assistantRuns.js';
import { verifyAssistantAnswer, verifyEvidence } from './assistantVerifier.js';
import { searchAssistantMemories } from './assistantMemory.js';
import { assessRetrievalConfidence } from './assistantRetrievalConfidence.js';

function uniqueQueries(queries) {
  const seen = new Set();
  return queries
    .map(query => String(query || '').trim())
    .filter(query => {
      if (!query || seen.has(query)) return false;
      seen.add(query);
      return true;
    });
}

async function executeRetrievalPlan({ retrieve, question, task, scope, groupId, plan }) {
  if (!plan.needsAnswer) {
    return {
      ranked: [],
      embeddingConfig: {},
      attempts: [],
    };
  }

  const queries = uniqueQueries([
    question,
    ...(plan.rewriteQueries || []),
  ]);
  let finalRetrieval = { ranked: [], embeddingConfig: {} };
  let bestConfidence = null;
  const attempts = [];

  for (const plannedQuestion of queries) {
    const retrieval = await retrieve({
      question: plannedQuestion,
      originalQuestion: question,
      task,
      scope,
      groupId,
      plan,
    });
    const ranked = retrieval.ranked || [];
    const confidence = assessRetrievalConfidence({
      question: plannedQuestion,
      sources: ranked,
      attempts: [...attempts, { question: plannedQuestion, sourceCount: ranked.length }],
    });
    attempts.push({
      question: plannedQuestion,
      sourceCount: ranked.length,
      confidence,
      modes: Array.from(new Set(ranked.flatMap(source => source.retrieval_modes || source.retrievalModes || []))),
    });
    if (!bestConfidence || confidence.score >= bestConfidence.score || (!finalRetrieval.ranked.length && ranked.length)) {
      bestConfidence = confidence;
      finalRetrieval = {
        ranked,
        embeddingConfig: retrieval.embeddingConfig || finalRetrieval.embeddingConfig || {},
      };
    }
    if (ranked.length && !confidence.shouldCorrect) break;
  }

  return {
    ...finalRetrieval,
    attempts,
    confidence: bestConfidence,
  };
}

export async function prepareAssistantAgentTurn({
  db,
  userId,
  conversationId = null,
  groupId = null,
  question,
  task = 'ask',
  scope = {},
  retrieve,
} = {}) {
  if (!db) throw new Error('prepareAssistantAgentTurn requires a database');
  if (!retrieve) throw new Error('prepareAssistantAgentTurn requires a retrieve function');

  const plan = planAssistantTurn({ question, task, scope, groupId });
  const run = startAssistantRun(db, {
    userId,
    conversationId,
    groupId,
    question,
    task,
    plan,
  });
  recordAssistantRunStep(db, {
    runId: run.id,
    stepType: 'plan',
    label: 'Plan retrieval',
    metadata: {
      intent: plan.intent,
      summary: summarizeRetrievalPlan(plan),
      tools: plan.tools.map(tool => tool.name),
    },
  });
  const memory = {
    items: searchAssistantMemories({
      db,
      userId,
      groupId,
      query: question,
      limit: 5,
    }),
  };
  recordAssistantRunStep(db, {
    runId: run.id,
    stepType: 'memory',
    label: 'Load assistant memory',
    metadata: {
      memoryCount: memory.items.length,
      memoryTypes: Array.from(new Set(memory.items.map(item => item.memory_type))),
    },
  });

  const retrieval = await executeRetrievalPlan({
    retrieve,
    question,
    task,
    scope,
    groupId,
    plan,
  });
  const ranked = retrieval.ranked || [];
  const retrievalConfidence = retrieval.confidence || assessRetrievalConfidence({
    question,
    sources: ranked,
    attempts: retrieval.attempts,
  });
  recordAssistantRunStep(db, {
    runId: run.id,
    stepType: 'retrieval',
    label: 'Retrieve sources',
    metadata: {
      sourceCount: ranked.length,
      queryCount: retrieval.attempts.length,
      attempts: retrieval.attempts,
      confidence: retrievalConfidence,
      embeddingEnabled: Boolean(retrieval.embeddingConfig?.enabled),
      provider: retrieval.embeddingConfig?.provider,
      model: retrieval.embeddingConfig?.model,
    },
  });

  const evidence = buildEvidenceNotebook(ranked);
  const verification = verifyEvidence(evidence, { retrievalConfidence });
  recordAssistantRunStep(db, {
    runId: run.id,
    stepType: 'evidence',
    label: 'Build evidence notebook',
    metadata: {
      status: evidence.status,
      evidenceCount: evidence.items.length,
      support: verification.support,
      confidence: retrievalConfidence,
    },
  });

  const completedRun = finishAssistantRun(db, {
    runId: run.id,
    status: 'completed',
    evidence,
    verification,
  });

  return {
    plan,
    ranked,
    embeddingConfig: retrieval.embeddingConfig || {},
    retrievalConfidence,
    memory,
    evidence,
    verification,
    agent: {
      run: completedRun,
    },
  };
}

export function completeAssistantAgentAnswer({
  db,
  agentTurn,
  answer = '',
  sourceCount = 0,
} = {}) {
  if (!db) throw new Error('completeAssistantAgentAnswer requires a database');
  if (!agentTurn?.agent?.run?.id) throw new Error('completeAssistantAgentAnswer requires an agent run');

  const verification = verifyAssistantAnswer({
    answer,
    evidence: agentTurn.evidence,
    sourceCount,
  });
  recordAssistantRunStep(db, {
    runId: agentTurn.agent.run.id,
    stepType: 'answer_verification',
    label: 'Verify answer citations',
    metadata: {
      support: verification.support,
      issues: verification.issues,
      citations: verification.citations,
    },
  });
  const completedRun = finishAssistantRun(db, {
    runId: agentTurn.agent.run.id,
    status: 'completed',
    evidence: agentTurn.evidence,
    verification,
  });

  return {
    ...agentTurn,
    verification,
    agent: {
      run: completedRun || getAssistantRun(db, agentTurn.agent.run.id),
    },
  };
}
