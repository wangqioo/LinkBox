import Database from 'better-sqlite3';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { mkdirSync } from 'fs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const DATA_DIR = process.env.DATA_DIR || __dirname;
const UPLOADS_DIR = process.env.UPLOADS_DIR || join(DATA_DIR, 'uploads');
const DB_PATH = process.env.DB_PATH || join(DATA_DIR, 'linkbox.db');

mkdirSync(DATA_DIR, { recursive: true });
mkdirSync(UPLOADS_DIR, { recursive: true });

const db = new Database(DB_PATH);

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

  CREATE TABLE IF NOT EXISTS link_chunks (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    link_id INTEGER NOT NULL,
    user_id INTEGER NOT NULL,
    chunk_index INTEGER NOT NULL,
    text TEXT NOT NULL,
    created_at TEXT DEFAULT (datetime('now')),
    FOREIGN KEY (link_id) REFERENCES links(id) ON DELETE CASCADE,
    UNIQUE(link_id, chunk_index)
  );

  CREATE INDEX IF NOT EXISTS idx_link_chunks_link ON link_chunks(link_id);
  CREATE INDEX IF NOT EXISTS idx_link_chunks_user ON link_chunks(user_id);

  CREATE TABLE IF NOT EXISTS jobs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    type TEXT NOT NULL,
    link_id INTEGER,
    payload TEXT DEFAULT '{}',
    status TEXT NOT NULL DEFAULT 'queued',
    attempts INTEGER NOT NULL DEFAULT 0,
    max_attempts INTEGER NOT NULL DEFAULT 3,
    next_run_at TEXT DEFAULT (datetime('now')),
    locked_at TEXT DEFAULT '',
    last_error TEXT DEFAULT '',
    created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT DEFAULT (datetime('now')),
    completed_at TEXT DEFAULT '',
    FOREIGN KEY (link_id) REFERENCES links(id) ON DELETE SET NULL
  );

  CREATE INDEX IF NOT EXISTS idx_jobs_status_next_run ON jobs(status, next_run_at);
  CREATE INDEX IF NOT EXISTS idx_jobs_link ON jobs(link_id);
`);

// Uploads directory is created above so multer/static serving can use a Docker volume.

export default db;
