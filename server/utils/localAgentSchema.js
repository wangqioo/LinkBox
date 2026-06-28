export function initLocalAgentSchema(db) {
  if (!db) throw new Error('initLocalAgentSchema requires a database');
  db.exec(`
    CREATE TABLE IF NOT EXISTS agent_runs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      run_type TEXT NOT NULL DEFAULT 'local_factory',
      status TEXT NOT NULL DEFAULT 'running',
      plan_json TEXT DEFAULT '{}',
      summary_json TEXT DEFAULT '{}',
      started_at TEXT DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
      completed_at TEXT DEFAULT '',
      created_at TEXT DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    );
    CREATE INDEX IF NOT EXISTS idx_agent_runs_user ON agent_runs(user_id, created_at);
    CREATE INDEX IF NOT EXISTS idx_agent_runs_type_status ON agent_runs(run_type, status);

    CREATE TABLE IF NOT EXISTS agent_reports (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      scope_type TEXT NOT NULL DEFAULT 'personal',
      scope_id INTEGER,
      report_type TEXT NOT NULL DEFAULT 'daily',
      content_json TEXT NOT NULL DEFAULT '{}',
      created_at TEXT DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    );
    CREATE INDEX IF NOT EXISTS idx_agent_reports_user ON agent_reports(user_id, created_at);
    CREATE INDEX IF NOT EXISTS idx_agent_reports_type ON agent_reports(report_type, created_at);

    CREATE TABLE IF NOT EXISTS agent_suggestions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      item_id INTEGER,
      suggestion_type TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'pending',
      proposal_json TEXT NOT NULL DEFAULT '{}',
      reason TEXT DEFAULT '',
      confidence REAL DEFAULT 0,
      evidence_json TEXT NOT NULL DEFAULT '{}',
      created_at TEXT DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
      updated_at TEXT DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
      resolved_at TEXT DEFAULT '',
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
      FOREIGN KEY (item_id) REFERENCES links(id) ON DELETE CASCADE
    );
    CREATE INDEX IF NOT EXISTS idx_agent_suggestions_user_status ON agent_suggestions(user_id, status, created_at);
    CREATE INDEX IF NOT EXISTS idx_agent_suggestions_item ON agent_suggestions(item_id, status);

    CREATE TABLE IF NOT EXISTS agent_rules (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      rule_type TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'active',
      title TEXT NOT NULL,
      condition_json TEXT NOT NULL DEFAULT '{}',
      action_json TEXT NOT NULL DEFAULT '{}',
      source_suggestion_id INTEGER,
      created_at TEXT DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
      updated_at TEXT DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
      FOREIGN KEY (source_suggestion_id) REFERENCES agent_suggestions(id) ON DELETE SET NULL
    );
    CREATE INDEX IF NOT EXISTS idx_agent_rules_user_status ON agent_rules(user_id, status, rule_type);

    CREATE TABLE IF NOT EXISTS item_maturity_events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      item_id INTEGER NOT NULL,
      user_id INTEGER NOT NULL,
      from_state TEXT DEFAULT '',
      to_state TEXT NOT NULL,
      reason TEXT DEFAULT '',
      metadata_json TEXT NOT NULL DEFAULT '{}',
      created_at TEXT DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
      FOREIGN KEY (item_id) REFERENCES links(id) ON DELETE CASCADE,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    );
    CREATE INDEX IF NOT EXISTS idx_item_maturity_events_item ON item_maturity_events(item_id, created_at);
    CREATE INDEX IF NOT EXISTS idx_item_maturity_events_user ON item_maturity_events(user_id, created_at);
  `);
}
