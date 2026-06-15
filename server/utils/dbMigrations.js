const MIGRATIONS = [
  {
    name: '001_links_item_columns',
    up(db) {
      addColumnIfMissing(db, 'links', 'type', "TEXT DEFAULT 'link'");
      addColumnIfMissing(db, 'links', 'content', "TEXT DEFAULT ''");
      addColumnIfMissing(db, 'links', 'image_path', "TEXT DEFAULT ''");
      addColumnIfMissing(db, 'links', 'summary', "TEXT DEFAULT ''");
      addColumnIfMissing(db, 'links', 'html_note', "TEXT DEFAULT ''");
      addColumnIfMissing(db, 'links', 'content_md', "TEXT DEFAULT ''");
      addColumnIfMissing(db, 'links', 'status', "TEXT DEFAULT ''");
    },
  },
];

function initMigrationSchema(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      name TEXT PRIMARY KEY,
      applied_at TEXT DEFAULT (datetime('now'))
    );
  `);
}

function tableColumns(db, table) {
  return new Set(db.prepare(`PRAGMA table_info(${table})`).all().map(column => column.name));
}

function addColumnIfMissing(db, table, column, definition) {
  if (tableColumns(db, table).has(column)) return false;
  db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
  return true;
}

function appliedMigrations(db) {
  return new Set(db.prepare('SELECT name FROM schema_migrations').all().map(row => row.name));
}

export function runMigrations(db) {
  if (!db) throw new Error('runMigrations requires a database');
  initMigrationSchema(db);

  const applied = appliedMigrations(db);
  const names = [];
  const insert = db.prepare('INSERT INTO schema_migrations (name) VALUES (?)');
  const tx = db.transaction(() => {
    for (const migration of MIGRATIONS) {
      if (applied.has(migration.name)) continue;
      migration.up(db);
      insert.run(migration.name);
      names.push(migration.name);
    }
  });
  tx();

  return {
    applied: names.length,
    names,
  };
}
