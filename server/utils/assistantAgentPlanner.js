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

function projectSubject(question) {
  const normalized = cleanQuestion(question);
  const match = normalized.match(/(LinkBox\s*Agent|LinkBox|Agent|智能助手|助手)/iu);
  return match?.[1]?.replace(/\s+/g, ' ').trim() || '这个项目';
}

function shouldDecompose(question) {
  return /还差|下一步|怎么做|规划|状态|进展|优化|完善/u.test(question)
    && /(Agent|智能助手|助手|项目|LinkBox)/iu.test(question);
}

function subQuestionsFor(question) {
  if (!shouldDecompose(question)) return [];
  const subject = projectSubject(question);
  return [
    `${subject} 已经完成了哪些能力？`,
    `${subject} 现在还缺哪些能力或决策？`,
    `${subject} 下一步最应该做什么？`,
  ];
}

function isLatestItemQuestion(question) {
  const text = String(question || '').replace(/\s+/g, '');
  if (!text) return false;
  const hasLatest = /最新|最近|刚刚|刚才|最后|上一条|新发|新传|新上传/.test(text);
  const hasItem = /发的|上传|传的|保存|资料|文件|图片|照片|视频|音频|文章|链接|内容|材料/.test(text);
  const asksIdentity = /是啥|是什么|哪个|哪一个|哪条|发了什么|传了什么|保存了什么|有啥|有什么/.test(text);
  return hasLatest && hasItem && asksIdentity;
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
  if (isLatestItemQuestion(question)) {
    tools.push({
      name: 'latest_item',
      reason: 'answer newest uploaded/saved item identity questions by time order',
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
  const subQuestions = subQuestionsFor(normalizedQuestion);
  const rewriteQueries = [
    normalizedQuestion,
    stripGroupPrefix(normalizedQuestion),
    ...subQuestions,
  ].filter((value, index, values) => value && values.indexOf(value) === index);

  return {
    intent,
    needsAnswer: true,
    scopeType,
    scope: scope || {},
    tools: retrievalTools({ intent, scopeType, question: normalizedQuestion }),
    rewriteQueries,
    subQuestions,
  };
}

export function summarizeRetrievalPlan(plan) {
  return (plan?.tools || [])
    .map(tool => `${tool.name}: ${tool.reason}`)
    .join('; ');
}
