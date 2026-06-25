import { scoreTextFields, tokenizeQuery } from './textScoring.js';

function compact(value) {
  return String(value || '').replace(/\s+/g, ' ').trim();
}

function classifyMemory(text) {
  if (/偏好|喜欢|以后都|默认|回答时|输出时|先给|不要/.test(text)) return 'preference';
  if (/项目|背景|上下文|长期|一直|固定/.test(text)) return 'project_context';
  return 'note';
}

function explicitMemoryText(text) {
  const value = compact(text);
  const match = value.match(/(?:记住|请记住|以后|以后都|我偏好|我的偏好是|默认)[:：]?\s*(.+)$/);
  return compact(match?.[1] || '');
}

export function initAssistantMemorySchema(db) {
  if (!db) throw new Error('initAssistantMemorySchema requires a database');
  db.exec(`
    CREATE TABLE IF NOT EXISTS assistant_memories (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      scope_type TEXT NOT NULL DEFAULT 'personal',
      group_id INTEGER,
      memory_type TEXT NOT NULL DEFAULT 'note',
      content TEXT NOT NULL,
      source TEXT DEFAULT 'explicit',
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now')),
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
      FOREIGN KEY (group_id) REFERENCES groups(id) ON DELETE CASCADE,
      CHECK(scope_type IN ('personal', 'group'))
    );
    CREATE INDEX IF NOT EXISTS idx_assistant_memories_user ON assistant_memories(user_id, updated_at);
    CREATE INDEX IF NOT EXISTS idx_assistant_memories_group ON assistant_memories(group_id, updated_at);
  `);
}

export function captureAssistantMemories(db, {
  userId,
  groupId = null,
  text = '',
  source = 'explicit',
} = {}) {
  if (!db) throw new Error('captureAssistantMemories requires a database');
  initAssistantMemorySchema(db);
  const content = explicitMemoryText(text);
  if (!content) return { created: 0, memories: [] };
  const memoryType = classifyMemory(content);
  const scopeType = groupId ? 'group' : 'personal';
  const existing = db.prepare(`
    SELECT id FROM assistant_memories
    WHERE user_id = ? AND scope_type = ? AND COALESCE(group_id, 0) = ? AND content = ?
  `).get(userId, scopeType, groupId || 0, content);
  if (existing) return { created: 0, memories: [existing.id] };

  const result = db.prepare(`
    INSERT INTO assistant_memories (user_id, scope_type, group_id, memory_type, content, source, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, datetime('now'))
  `).run(userId, scopeType, groupId || null, memoryType, content, source);
  return { created: 1, memories: [Number(result.lastInsertRowid)] };
}

export function searchAssistantMemories({
  db,
  userId,
  groupId = null,
  query = '',
  limit = 5,
} = {}) {
  if (!db) throw new Error('searchAssistantMemories requires a database');
  initAssistantMemorySchema(db);
  const params = [userId];
  const conditions = ['user_id = ?'];
  if (groupId) {
    conditions.push("scope_type = 'group'", 'group_id = ?');
    params.push(groupId);
  } else {
    conditions.push("scope_type = 'personal'", 'group_id IS NULL');
  }
  const rows = db.prepare(`
    SELECT id, user_id, scope_type, group_id, memory_type, content, source, created_at, updated_at
    FROM assistant_memories
    WHERE ${conditions.join(' AND ')}
    ORDER BY updated_at DESC, id DESC
    LIMIT 100
  `).all(...params);
  const tokens = tokenizeQuery(query);
  return rows
    .map(row => ({
      ...row,
      score: scoreTextFields(row, tokens, {
        content: 10,
        memory_type: 2,
      }),
    }))
    .filter(row => row.score > 0 || !tokens.length)
    .sort((a, b) => b.score - a.score || String(b.updated_at || '').localeCompare(String(a.updated_at || '')))
    .slice(0, limit);
}

function scopeConditions({ userId, groupId = null }) {
  const params = [userId];
  const conditions = ['user_id = ?'];
  if (groupId) {
    conditions.push("scope_type = 'group'", 'group_id = ?');
    params.push(groupId);
  } else {
    conditions.push("scope_type = 'personal'", 'group_id IS NULL');
  }
  return { conditions, params };
}

export function listAssistantMemories({
  db,
  userId,
  groupId = null,
  limit = 100,
} = {}) {
  if (!db) throw new Error('listAssistantMemories requires a database');
  initAssistantMemorySchema(db);
  const { conditions, params } = scopeConditions({ userId, groupId });
  params.push(Math.max(1, Math.min(200, Number(limit) || 100)));
  return db.prepare(`
    SELECT id, user_id, scope_type, group_id, memory_type, content, source, created_at, updated_at
    FROM assistant_memories
    WHERE ${conditions.join(' AND ')}
    ORDER BY updated_at DESC, id DESC
    LIMIT ?
  `).all(...params);
}

export function deleteAssistantMemory(db, {
  userId,
  groupId = null,
  memoryId,
} = {}) {
  if (!db) throw new Error('deleteAssistantMemory requires a database');
  initAssistantMemorySchema(db);
  const { conditions, params } = scopeConditions({ userId, groupId });
  const result = db.prepare(`
    DELETE FROM assistant_memories
    WHERE id = ? AND ${conditions.join(' AND ')}
  `).run(memoryId, ...params);
  return result.changes > 0;
}
