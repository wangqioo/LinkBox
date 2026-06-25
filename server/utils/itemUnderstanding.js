import { scoreTextFields, tokenizeQuery } from './textScoring.js';

const TOPIC_TERMS = [
  'agent',
  'retrieval',
  'verification',
  'memory',
  'embedding',
  'database',
  'sqlite',
  'assistant',
  'diagnostics',
  'roadmap',
  'risk',
  'todo',
  'security',
  'deployment',
  'performance',
];

function compactText(value) {
  return String(value || '').replace(/\s+/g, ' ').trim();
}

function sourceText(item = {}) {
  return [
    item.title,
    item.summary,
    item.comment,
    item.content_md,
    item.content,
    item.description,
  ].map(compactText).filter(Boolean).join('\n');
}

function uniqueBy(items, keyFn) {
  const seen = new Set();
  return items.filter(item => {
    const key = keyFn(item);
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function extractEntities(text) {
  const matches = text.match(/\b[A-Z][A-Za-z0-9]*(?:[A-Z][A-Za-z0-9]*)?\b/g) || [];
  return uniqueBy(matches
    .filter(name => name.length >= 3 && !['TODO', 'Claim'].includes(name))
    .map(name => ({ name, kind: 'proper_noun' })), entity => entity.name.toLowerCase())
    .slice(0, 24);
}

function extractTopics(text) {
  const lower = text.toLowerCase();
  return TOPIC_TERMS
    .filter(term => lower.includes(term))
    .map(name => ({ name, weight: 1 }));
}

function extractTodos(text) {
  const lines = String(text || '').split(/\r?\n/);
  return uniqueBy(lines.flatMap(line => {
    const trimmed = line.trim();
    const todo = trimmed.match(/^(?:[-*]\s*)?(?:\[[ xX]\]\s*)?(?:TODO|Todo|todo|待办|行动项)[:：]?\s*(.+)$/);
    if (todo?.[1]) return [{ text: compactText(todo[1]), status: / \[[xX]\]/.test(trimmed) ? 'done' : 'open' }];
    const checkbox = trimmed.match(/^[-*]\s*\[\s\]\s+(.+)$/);
    if (checkbox?.[1]) return [{ text: compactText(checkbox[1]), status: 'open' }];
    return [];
  }), todo => todo.text.toLowerCase()).slice(0, 24);
}

function extractClaims(text) {
  const sentences = String(text || '').split(/(?<=[。.!?])\s+|\r?\n/);
  return uniqueBy(sentences.flatMap(sentence => {
    const trimmed = compactText(sentence);
    const claim = trimmed.match(/^(?:Claim|结论|主张)[:：]\s*(.+)$/i);
    if (claim?.[1]) return [{ text: compactText(claim[1]) }];
    if (/(\bis\b|\bare\b|是|意味着|说明|需要|should|must)/i.test(trimmed) && trimmed.length >= 12 && trimmed.length <= 260) {
      return [{ text: trimmed }];
    }
    return [];
  }), claim => claim.text.toLowerCase()).slice(0, 32);
}

export function initItemUnderstandingSchema(db) {
  if (!db) throw new Error('initItemUnderstandingSchema requires a database');
  db.exec(`
    CREATE TABLE IF NOT EXISTS item_entities (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      item_id INTEGER NOT NULL,
      user_id INTEGER NOT NULL,
      name TEXT NOT NULL,
      kind TEXT DEFAULT '',
      created_at TEXT DEFAULT (datetime('now')),
      FOREIGN KEY (item_id) REFERENCES links(id) ON DELETE CASCADE
    );
    CREATE INDEX IF NOT EXISTS idx_item_entities_user_name ON item_entities(user_id, name);
    CREATE INDEX IF NOT EXISTS idx_item_entities_item ON item_entities(item_id);

    CREATE TABLE IF NOT EXISTS item_topics (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      item_id INTEGER NOT NULL,
      user_id INTEGER NOT NULL,
      name TEXT NOT NULL,
      weight REAL DEFAULT 1,
      created_at TEXT DEFAULT (datetime('now')),
      FOREIGN KEY (item_id) REFERENCES links(id) ON DELETE CASCADE
    );
    CREATE INDEX IF NOT EXISTS idx_item_topics_user_name ON item_topics(user_id, name);
    CREATE INDEX IF NOT EXISTS idx_item_topics_item ON item_topics(item_id);

    CREATE TABLE IF NOT EXISTS item_todos (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      item_id INTEGER NOT NULL,
      user_id INTEGER NOT NULL,
      text TEXT NOT NULL,
      status TEXT DEFAULT 'open',
      created_at TEXT DEFAULT (datetime('now')),
      FOREIGN KEY (item_id) REFERENCES links(id) ON DELETE CASCADE
    );
    CREATE INDEX IF NOT EXISTS idx_item_todos_user ON item_todos(user_id, status);
    CREATE INDEX IF NOT EXISTS idx_item_todos_item ON item_todos(item_id);

    CREATE TABLE IF NOT EXISTS item_claims (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      item_id INTEGER NOT NULL,
      user_id INTEGER NOT NULL,
      text TEXT NOT NULL,
      created_at TEXT DEFAULT (datetime('now')),
      FOREIGN KEY (item_id) REFERENCES links(id) ON DELETE CASCADE
    );
    CREATE INDEX IF NOT EXISTS idx_item_claims_user ON item_claims(user_id);
    CREATE INDEX IF NOT EXISTS idx_item_claims_item ON item_claims(item_id);
  `);
}

export function extractItemUnderstanding(item = {}) {
  const text = sourceText(item);
  return {
    entities: extractEntities(text),
    topics: extractTopics(text),
    todos: extractTodos(text),
    claims: extractClaims(text),
  };
}

export function upsertItemUnderstanding(db, itemId) {
  if (!db) throw new Error('upsertItemUnderstanding requires a database');
  initItemUnderstandingSchema(db);
  const item = db.prepare('SELECT * FROM links WHERE id = ?').get(itemId);
  if (!item) return { entities: [], topics: [], todos: [], claims: [] };
  const understanding = extractItemUnderstanding(item);
  const tx = db.transaction(() => {
    for (const table of ['item_entities', 'item_topics', 'item_todos', 'item_claims']) {
      db.prepare(`DELETE FROM ${table} WHERE item_id = ?`).run(item.id);
    }

    const insertEntity = db.prepare('INSERT INTO item_entities (item_id, user_id, name, kind) VALUES (?, ?, ?, ?)');
    for (const entity of understanding.entities) insertEntity.run(item.id, item.user_id, entity.name, entity.kind);

    const insertTopic = db.prepare('INSERT INTO item_topics (item_id, user_id, name, weight) VALUES (?, ?, ?, ?)');
    for (const topic of understanding.topics) insertTopic.run(item.id, item.user_id, topic.name, topic.weight);

    const insertTodo = db.prepare('INSERT INTO item_todos (item_id, user_id, text, status) VALUES (?, ?, ?, ?)');
    for (const todo of understanding.todos) insertTodo.run(item.id, item.user_id, todo.text, todo.status);

    const insertClaim = db.prepare('INSERT INTO item_claims (item_id, user_id, text) VALUES (?, ?, ?)');
    for (const claim of understanding.claims) insertClaim.run(item.id, item.user_id, claim.text);
  });
  tx();
  return understanding;
}

function rowText(row) {
  return [row.title, row.kind, row.name, row.status, row.text].map(compactText).filter(Boolean).join(' ');
}

export function searchItemUnderstanding({
  db,
  userId,
  query,
  limit = 8,
} = {}) {
  if (!db) throw new Error('searchItemUnderstanding requires a database');
  initItemUnderstandingSchema(db);
  const rows = db.prepare(`
    SELECT 'entity' AS knowledge_type, e.item_id AS id, e.user_id, e.name, e.kind, '' AS text, '' AS status,
      l.type, l.url, l.title, l.summary, l.comment, l.imported_at
    FROM item_entities e
    JOIN links l ON l.id = e.item_id
    WHERE e.user_id = ?
    UNION ALL
    SELECT 'topic' AS knowledge_type, t.item_id AS id, t.user_id, t.name, '' AS kind, '' AS text, '' AS status,
      l.type, l.url, l.title, l.summary, l.comment, l.imported_at
    FROM item_topics t
    JOIN links l ON l.id = t.item_id
    WHERE t.user_id = ?
    UNION ALL
    SELECT 'todo' AS knowledge_type, td.item_id AS id, td.user_id, '' AS name, '' AS kind, td.text, td.status,
      l.type, l.url, l.title, l.summary, l.comment, l.imported_at
    FROM item_todos td
    JOIN links l ON l.id = td.item_id
    WHERE td.user_id = ?
    UNION ALL
    SELECT 'claim' AS knowledge_type, c.item_id AS id, c.user_id, '' AS name, '' AS kind, c.text, '' AS status,
      l.type, l.url, l.title, l.summary, l.comment, l.imported_at
    FROM item_claims c
    JOIN links l ON l.id = c.item_id
    WHERE c.user_id = ?
  `).all(userId, userId, userId, userId);
  const tokens = tokenizeQuery(query);
  return rows
    .map(row => ({
      ...row,
      score: scoreTextFields({ ...row, knowledge: rowText(row) }, tokens, {
        knowledge: 10,
        title: 4,
        summary: 2,
        comment: 2,
      }),
    }))
    .filter(row => row.score > 0)
    .sort((a, b) => b.score - a.score || String(b.imported_at || '').localeCompare(String(a.imported_at || '')))
    .slice(0, limit)
    .map((row, index) => ({
      ...row,
      source_index: index + 1,
      sourceKind: 'structured_knowledge',
      retrieval_modes: ['structured'],
      chunk_text: knowledgeSnippet(row),
    }));
}

function knowledgeSnippet(row) {
  if (row.knowledge_type === 'entity') return `实体：${row.name}${row.kind ? `（${row.kind}）` : ''}`;
  if (row.knowledge_type === 'topic') return `主题：${row.name}`;
  if (row.knowledge_type === 'todo') return `待办：${row.text}${row.status ? `（${row.status}）` : ''}`;
  return `主张：${row.text}`;
}
