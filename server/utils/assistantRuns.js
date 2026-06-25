function json(value, fallback = {}) {
  return JSON.stringify(value ?? fallback);
}

function parseJson(value, fallback) {
  try {
    return JSON.parse(value || '');
  } catch {
    return fallback;
  }
}

function nowIso() {
  return new Date().toISOString();
}

export function initAssistantRunSchema(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS assistant_runs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      conversation_id INTEGER,
      scope_type TEXT NOT NULL DEFAULT 'personal',
      group_id INTEGER,
      question TEXT NOT NULL DEFAULT '',
      task TEXT NOT NULL DEFAULT 'ask',
      intent TEXT NOT NULL DEFAULT '',
      status TEXT NOT NULL DEFAULT 'running',
      plan_json TEXT DEFAULT '{}',
      evidence_json TEXT DEFAULT '{}',
      verification_json TEXT DEFAULT '{}',
      created_at TEXT DEFAULT (datetime('now')),
      completed_at TEXT DEFAULT '',
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
      FOREIGN KEY (conversation_id) REFERENCES assistant_conversations(id) ON DELETE SET NULL,
      FOREIGN KEY (group_id) REFERENCES groups(id) ON DELETE CASCADE
    );

    CREATE INDEX IF NOT EXISTS idx_assistant_runs_user ON assistant_runs(user_id, created_at);
    CREATE INDEX IF NOT EXISTS idx_assistant_runs_conversation ON assistant_runs(conversation_id, created_at);

    CREATE TABLE IF NOT EXISTS assistant_run_steps (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      run_id INTEGER NOT NULL,
      step_index INTEGER NOT NULL,
      step_type TEXT NOT NULL,
      label TEXT NOT NULL DEFAULT '',
      status TEXT NOT NULL DEFAULT 'done',
      metadata_json TEXT DEFAULT '{}',
      created_at TEXT DEFAULT (datetime('now')),
      FOREIGN KEY (run_id) REFERENCES assistant_runs(id) ON DELETE CASCADE,
      UNIQUE(run_id, step_index)
    );

    CREATE INDEX IF NOT EXISTS idx_assistant_run_steps_run ON assistant_run_steps(run_id, step_index);
  `);
}

export function startAssistantRun(db, {
  userId,
  conversationId = null,
  groupId = null,
  question = '',
  task = 'ask',
  plan = {},
} = {}) {
  initAssistantRunSchema(db);
  const result = db.prepare(`
    INSERT INTO assistant_runs (
      user_id, conversation_id, scope_type, group_id, question, task,
      intent, status, plan_json
    )
    VALUES (?, ?, ?, ?, ?, ?, ?, 'running', ?)
  `).run(
    userId,
    conversationId || null,
    groupId ? 'group' : 'personal',
    groupId || null,
    String(question || ''),
    task || 'ask',
    plan.intent || '',
    json(plan),
  );
  return getAssistantRun(db, Number(result.lastInsertRowid));
}

export function recordAssistantRunStep(db, {
  runId,
  stepType,
  label = '',
  status = 'done',
  metadata = {},
} = {}) {
  initAssistantRunSchema(db);
  const current = db.prepare('SELECT COALESCE(MAX(step_index), 0) AS max_index FROM assistant_run_steps WHERE run_id = ?')
    .get(runId);
  const stepIndex = Number(current?.max_index || 0) + 1;
  db.prepare(`
    INSERT INTO assistant_run_steps (run_id, step_index, step_type, label, status, metadata_json)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(runId, stepIndex, stepType, label, status, json(metadata));
  return stepIndex;
}

export function finishAssistantRun(db, {
  runId,
  status = 'completed',
  evidence = {},
  verification = {},
} = {}) {
  initAssistantRunSchema(db);
  db.prepare(`
    UPDATE assistant_runs
    SET status = ?, evidence_json = ?, verification_json = ?, completed_at = ?
    WHERE id = ?
  `).run(status, json(evidence), json(verification), nowIso(), runId);
  return getAssistantRun(db, runId);
}

export function getAssistantRun(db, runId) {
  initAssistantRunSchema(db);
  const row = db.prepare('SELECT * FROM assistant_runs WHERE id = ?').get(runId);
  if (!row) return null;
  const steps = db.prepare(`
    SELECT id, run_id, step_index, step_type, label, status, metadata_json, created_at
    FROM assistant_run_steps
    WHERE run_id = ?
    ORDER BY step_index ASC
  `).all(runId).map(step => ({
    ...step,
    metadata: parseJson(step.metadata_json, {}),
  }));
  return {
    ...row,
    plan: parseJson(row.plan_json, {}),
    evidence: parseJson(row.evidence_json, {}),
    verification: parseJson(row.verification_json, {}),
    steps,
  };
}
