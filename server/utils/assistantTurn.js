const DEFAULT_MAX_CONTEXT_CHARS = Number(process.env.ASSISTANT_MAX_CONTEXT_CHARS || 12000);
const DEFAULT_MAX_FIELD_CHARS = Number(process.env.ASSISTANT_MAX_FIELD_CHARS || 5000);

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

export function groupSources(items) {
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

function trimContext(sources, {
  maxContextChars = DEFAULT_MAX_CONTEXT_CHARS,
  maxFieldChars = DEFAULT_MAX_FIELD_CHARS,
} = {}) {
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
    if (total + block.length > maxContextChars && blocks.length > 0) break;
    const trimmed = block.slice(0, maxFieldChars);
    blocks.push(trimmed);
    total += trimmed.length;
  }

  return blocks.join('\n\n---\n\n');
}

export function publicSource(item) {
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

export function publicSources(items) {
  return groupSources(items).map(item => ({
    id: item.id,
    link_id: item.id,
    type: item.type,
    title: item.title || item.url || `璧勬枡 ${item.id}`,
    url: item.url || '',
    summary: item.summary || '',
    imported_at: item.imported_at,
    retrieval: publicRetrievalMetadata(item),
    chunks: publicChunks(item.chunks || []),
  }));
}

function publicRetrievalMetadata(item, extraKeys = []) {
  const metadata = {};
  const keys = [
    'sourceKind',
    'score',
    'combined_score',
    'embedding_score',
    'retrieval_modes',
    'rerank_mode',
    'rerank_score',
    ...extraKeys,
  ];

  for (const key of keys) {
    if (item[key] !== undefined && item[key] !== null && item[key] !== '') {
      metadata[key] = item[key];
    }
  }

  return Object.keys(metadata).length ? metadata : undefined;
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
        retrieval: publicRetrievalMetadata(chunk, [
          'document_id',
          'chunk_id',
          'heading_path',
          'chunk_type',
        ]),
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

export function normalizeTask(task) {
  return TASKS[task] ? task : 'ask';
}

export function buildMessages(question, ranked, task = 'ask', options = {}) {
  const taskConfig = TASKS[normalizeTask(task)];
  const grouped = groupSources(ranked);
  const context = trimContext(grouped, options);
  const sourceIds = grouped.map(source => `[资料${source.source_index}]`).join('、');
  return [
    {
      role: 'system',
      content: `你是 LinkBox 私人资料助理。不要输出思考过程。只能基于用户提供的资料工作；资料不足时明确说明不足。回答要具体、可执行，使用 Markdown 组织结构。有序列表必须使用连续数字编号，例如 1. 2. 3.，不要每一条都写 1.。引用只能使用这些编号：${sourceIds || '无'}。引用格式必须是完整的 [资料1]，不要写 [资料1-3]、[资料21] 或缺少右括号。当前任务：${taskConfig.label}。任务要求：${taskConfig.instruction}`,
    },
    {
      role: 'user',
      content: `用户问题：${question}\n\n可用资料：\n${context}\n\n请用中文回答，并附上你实际使用的资料编号。`,
    },
  ];
}

export function normalizeCitationText(text, maxSourceNumber) {
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
