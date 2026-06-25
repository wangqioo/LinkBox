const PERSONAL_SCOPE = 'personal';
const GROUP_SCOPE = 'group';

export function initAssistantConversationSchema(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS assistant_conversations (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      scope_type TEXT NOT NULL DEFAULT 'personal',
      group_id INTEGER,
      title TEXT NOT NULL DEFAULT '新对话',
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now')),
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
      FOREIGN KEY (group_id) REFERENCES groups(id) ON DELETE CASCADE,
      CHECK(scope_type IN ('personal', 'group'))
    );

    CREATE INDEX IF NOT EXISTS idx_assistant_conversations_user ON assistant_conversations(user_id, updated_at);
    CREATE INDEX IF NOT EXISTS idx_assistant_conversations_group ON assistant_conversations(group_id, updated_at);

    CREATE TABLE IF NOT EXISTS assistant_messages (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      conversation_id INTEGER NOT NULL,
      role TEXT NOT NULL,
      content TEXT NOT NULL DEFAULT '',
      task TEXT DEFAULT 'ask',
      sources_json TEXT DEFAULT '[]',
      agent_json TEXT DEFAULT '{}',
      error TEXT DEFAULT '',
      created_at TEXT DEFAULT (datetime('now')),
      FOREIGN KEY (conversation_id) REFERENCES assistant_conversations(id) ON DELETE CASCADE,
      CHECK(role IN ('user', 'assistant'))
    );

    CREATE INDEX IF NOT EXISTS idx_assistant_messages_conversation ON assistant_messages(conversation_id, id);
  `);
}

export function createAssistantConversation(db, { userId, groupId = null, title = '' }) {
  const scopeType = groupId ? GROUP_SCOPE : PERSONAL_SCOPE;
  const result = db.prepare(`
    INSERT INTO assistant_conversations (user_id, scope_type, group_id, title, updated_at)
    VALUES (?, ?, ?, ?, datetime('now'))
  `).run(userId, scopeType, groupId || null, normalizeTitle(title) || '新对话');
  return getAssistantConversation(db, { userId, conversationId: Number(result.lastInsertRowid), groupId });
}

export function getAssistantConversation(db, { userId, conversationId, groupId = undefined }) {
  const row = db.prepare(`
    SELECT c.*,
      (SELECT COUNT(*) FROM assistant_messages m WHERE m.conversation_id = c.id) AS message_count
    FROM assistant_conversations c
    WHERE c.id = ? AND c.user_id = ?
  `).get(conversationId, userId);
  if (!row) return null;
  if (groupId !== undefined && Number(row.group_id || 0) !== Number(groupId || 0)) return null;
  return presentConversation(row);
}

export function listAssistantConversations(db, { userId, groupId = undefined, limit = 50 }) {
  const params = [userId];
  const conditions = ['c.user_id = ?'];
  if (groupId !== undefined) {
    if (groupId) {
      conditions.push('c.scope_type = ? AND c.group_id = ?');
      params.push(GROUP_SCOPE, groupId);
    } else {
      conditions.push('c.scope_type = ? AND c.group_id IS NULL');
      params.push(PERSONAL_SCOPE);
    }
  }
  params.push(Math.min(Math.max(Number(limit) || 50, 1), 100));
  return db.prepare(`
    SELECT c.*,
      (SELECT COUNT(*) FROM assistant_messages m WHERE m.conversation_id = c.id) AS message_count
    FROM assistant_conversations c
    WHERE ${conditions.join(' AND ')}
    ORDER BY c.updated_at DESC, c.id DESC
    LIMIT ?
  `).all(...params).map(presentConversation);
}

export function deleteAssistantConversation(db, { userId, conversationId, groupId = undefined }) {
  const conversation = getAssistantConversation(db, { userId, conversationId, groupId });
  if (!conversation) return false;
  db.prepare('DELETE FROM assistant_conversations WHERE id = ? AND user_id = ?').run(conversationId, userId);
  return true;
}

export function listAssistantMessages(db, { userId, conversationId, groupId = undefined }) {
  const conversation = getAssistantConversation(db, { userId, conversationId, groupId });
  if (!conversation) return null;
  const messages = db.prepare(`
    SELECT id, conversation_id, role, content, task, sources_json, agent_json, error, created_at
    FROM assistant_messages
    WHERE conversation_id = ?
    ORDER BY id ASC
  `).all(conversationId).map(presentMessage);
  return { conversation, messages };
}

export function appendAssistantMessage(db, {
  conversationId,
  role,
  content = '',
  task = 'ask',
  sources = [],
  agent = {},
  error = '',
}) {
  const result = db.prepare(`
    INSERT INTO assistant_messages (conversation_id, role, content, task, sources_json, agent_json, error)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(conversationId, role, content, task, JSON.stringify(sources || []), JSON.stringify(agent || {}), error || '');
  db.prepare('UPDATE assistant_conversations SET updated_at = datetime(\'now\') WHERE id = ?').run(conversationId);
  return Number(result.lastInsertRowid);
}

export function ensureAssistantConversationForTurn(db, { userId, groupId = null, conversationId = null, question = '' }) {
  if (conversationId) {
    const existing = getAssistantConversation(db, { userId, conversationId: Number(conversationId), groupId });
    if (!existing) {
      const error = new Error('Conversation not found');
      error.status = 404;
      throw error;
    }
    return existing;
  }
  return createAssistantConversation(db, { userId, groupId, title: question });
}

export function maybeUpdateConversationTitle(db, { conversationId, question }) {
  const row = db.prepare('SELECT title FROM assistant_conversations WHERE id = ?').get(conversationId);
  if (!row || row.title !== '新对话') return;
  db.prepare('UPDATE assistant_conversations SET title = ?, updated_at = datetime(\'now\') WHERE id = ?')
    .run(normalizeTitle(question) || '新对话', conversationId);
}

function normalizeTitle(value) {
  return String(value || '').replace(/\s+/g, ' ').trim().slice(0, 40);
}

function presentConversation(row) {
  return {
    id: row.id,
    user_id: row.user_id,
    scope_type: row.scope_type,
    group_id: row.group_id,
    title: row.title,
    created_at: row.created_at,
    updated_at: row.updated_at,
    message_count: row.message_count || 0,
  };
}

function presentMessage(row) {
  return {
    id: row.id,
    conversation_id: row.conversation_id,
    role: row.role,
    content: row.content || '',
    task: row.task || 'ask',
    sources: parseJsonArray(row.sources_json),
    agent: parseJsonObject(row.agent_json),
    error: row.error || '',
    created_at: row.created_at,
  };
}

function parseJsonArray(value) {
  try {
    const parsed = JSON.parse(value || '[]');
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function parseJsonObject(value) {
  try {
    const parsed = JSON.parse(value || '{}');
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
  } catch {
    return {};
  }
}
