const TASK_INTENTS = {
  ask: 'question_answering',
  recent: 'recent_summary',
  report: 'report_generation',
  organize: 'organization',
  todos: 'todo_extraction',
};

function cleanQuestion(question) {
  return String(question || '').replace(/\s+/g, ' ').trim();
}

function stripGroupPrefix(question) {
  return question.replace(/^群里\s*/u, '').trim();
}

function retrievalTools({ intent, scopeType, question }) {
  if (intent === 'insufficient_input') return [];
  const tools = [];
  if (scopeType === 'group') {
    tools.push({
      name: 'group_context',
      reason: 'search shared group materials and group messages',
    });
  }
  if (intent === 'recent_summary') {
    tools.push({
      name: 'recent',
      reason: 'prioritize newest materials in the requested scope',
    });
  }
  tools.push({
    name: 'keyword',
    reason: 'match exact terms, titles, notes, and headings',
  });
  tools.push({
    name: 'vector',
    reason: 'find semantically related document chunks when embeddings are enabled',
  });
  if (question.length < 12 || /总结|报告|整理|待办/u.test(question)) {
    tools.push({
      name: 'fallback_recent',
      reason: 'use bounded recent context when direct matches are sparse',
    });
  }
  return tools;
}

export function planAssistantTurn({
  question,
  task = 'ask',
  scope = {},
  groupId = 0,
} = {}) {
  const normalizedQuestion = cleanQuestion(question);
  if (!normalizedQuestion) {
    return {
      intent: 'insufficient_input',
      needsAnswer: false,
      scopeType: groupId ? 'group' : 'personal',
      scope: scope || {},
      tools: [],
      rewriteQueries: [],
    };
  }

  const intent = TASK_INTENTS[task] || TASK_INTENTS.ask;
  const scopeType = groupId ? 'group' : 'personal';
  const rewriteQueries = [
    normalizedQuestion,
    stripGroupPrefix(normalizedQuestion),
  ].filter((value, index, values) => value && values.indexOf(value) === index);

  return {
    intent,
    needsAnswer: true,
    scopeType,
    scope: scope || {},
    tools: retrievalTools({ intent, scopeType, question: normalizedQuestion }),
    rewriteQueries,
  };
}

export function summarizeRetrievalPlan(plan) {
  return (plan?.tools || [])
    .map(tool => `${tool.name}: ${tool.reason}`)
    .join('; ');
}
