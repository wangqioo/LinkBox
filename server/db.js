import Database from 'better-sqlite3';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const db = new Database(join(__dirname, 'linkbox.db'));

db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    username TEXT UNIQUE NOT NULL,
    password_hash TEXT NOT NULL,
    created_at TEXT DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS links (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    type TEXT DEFAULT 'link',
    url TEXT DEFAULT '',
    title TEXT DEFAULT '',
    description TEXT DEFAULT '',
    thumbnail TEXT DEFAULT '',
    comment TEXT DEFAULT '',
    content TEXT DEFAULT '',
    image_path TEXT DEFAULT '',
    imported_at TEXT DEFAULT (datetime('now')),
    created_at TEXT DEFAULT (datetime('now')),
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS tags (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    name TEXT NOT NULL,
    color TEXT DEFAULT '#6366f1',
    created_at TEXT DEFAULT (datetime('now')),
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
    UNIQUE(user_id, name)
  );

  CREATE TABLE IF NOT EXISTS link_tags (
    link_id INTEGER NOT NULL,
    tag_id INTEGER NOT NULL,
    PRIMARY KEY (link_id, tag_id),
    FOREIGN KEY (link_id) REFERENCES links(id) ON DELETE CASCADE,
    FOREIGN KEY (tag_id) REFERENCES tags(id) ON DELETE CASCADE
  );

  CREATE INDEX IF NOT EXISTS idx_links_user ON links(user_id);
  CREATE INDEX IF NOT EXISTS idx_links_imported ON links(imported_at);
  CREATE INDEX IF NOT EXISTS idx_tags_user ON tags(user_id);
`);

// Migrate existing databases: add new columns if missing
try {
  db.exec(`ALTER TABLE links ADD COLUMN type TEXT DEFAULT 'link'`);
} catch { /* column already exists */ }
try {
  db.exec(`ALTER TABLE links ADD COLUMN content TEXT DEFAULT ''`);
} catch { /* column already exists */ }
try {
  db.exec(`ALTER TABLE links ADD COLUMN image_path TEXT DEFAULT ''`);
} catch { /* column already exists */ }
try {
  db.exec(`ALTER TABLE links ADD COLUMN summary TEXT DEFAULT ''`);
} catch { /* column already exists */ }
try {
  db.exec(`ALTER TABLE links ADD COLUMN html_note TEXT DEFAULT ''`);
} catch { /* column already exists */ }

try {
  db.exec(`ALTER TABLE links ADD COLUMN content_md TEXT DEFAULT ''`);
} catch { /* column already exists */ }
try {
  db.exec(`ALTER TABLE links ADD COLUMN status TEXT DEFAULT ''`);
} catch { /* column already exists */ }

// Settings table: global key-value store (admin-managed)
db.exec(`
  CREATE TABLE IF NOT EXISTS settings (
    key TEXT PRIMARY KEY,
    value TEXT DEFAULT ''
  );
`);

// Ensure uploads directory exists
import { mkdirSync } from 'fs';
mkdirSync(join(__dirname, 'uploads'), { recursive: true });

export default db;
