import { initJobSchema } from './jobQueue.js';
import { initDocumentSchema } from './documentIndex.js';
import { backfillItemContent } from './itemContentStore.js';
import { backfillItemAssets } from './itemAssetStore.js';
import { initAssistantConversationSchema } from './assistantConversations.js';
import { initAssistantRunSchema } from './assistantRuns.js';
import { initItemUnderstandingSchema } from './itemUnderstanding.js';
import { initAssistantMemorySchema } from './assistantMemory.js';

const MIGRATIONS = [
  {
    name: '000_base_schema',
    up(db) {
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
    },
  },
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
  {
    name: '002_links_batch_columns',
    up(db) {
      addColumnIfMissing(db, 'links', 'batch_id', "TEXT DEFAULT ''");
      addColumnIfMissing(db, 'links', 'batch_index', 'INTEGER DEFAULT 0');
      db.exec('CREATE INDEX IF NOT EXISTS idx_links_batch ON links(user_id, batch_id, batch_index)');
    },
  },
  {
    name: '003_jobs_schema',
    up(db) {
      initJobSchema(db);
    },
  },
  {
    name: '004_document_schema',
    up(db) {
      initDocumentSchema(db);
    },
  },
  {
    name: '005_item_content_schema',
    up(db) {
      backfillItemContent(db);
    },
  },
  {
    name: '006_item_assets_schema',
    up(db) {
      backfillItemAssets(db);
    },
  },
  {
    name: '007_direct_messages_schema',
    up(db) {
      db.exec(`
        CREATE TABLE IF NOT EXISTS direct_messages (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          sender_id INTEGER NOT NULL,
          recipient_id INTEGER NOT NULL,
          body TEXT NOT NULL,
          message_type TEXT NOT NULL DEFAULT 'text',
          created_at TEXT DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
          FOREIGN KEY (sender_id) REFERENCES users(id) ON DELETE CASCADE,
          FOREIGN KEY (recipient_id) REFERENCES users(id) ON DELETE CASCADE
        );
        CREATE INDEX IF NOT EXISTS idx_direct_messages_pair ON direct_messages(sender_id, recipient_id, created_at);
      `);
    },
  },
  {
    name: '008_link_scope',
    up(db) {
      addColumnIfMissing(db, 'links', 'scope', "TEXT DEFAULT 'personal'");
      db.exec('CREATE INDEX IF NOT EXISTS idx_links_user_scope ON links(user_id, scope, imported_at)');
    },
  },
  {
    name: '009_assistant_conversations',
    up(db) {
      initAssistantConversationSchema(db);
    },
  },
  {
    name: '010_social_collaboration_schema',
    up(db) {
      db.exec(`
        CREATE TABLE IF NOT EXISTS friendships (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          requester_id INTEGER NOT NULL,
          addressee_id INTEGER NOT NULL,
          status TEXT NOT NULL DEFAULT 'pending',
          created_at TEXT DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
          updated_at TEXT DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
          FOREIGN KEY (requester_id) REFERENCES users(id) ON DELETE CASCADE,
          FOREIGN KEY (addressee_id) REFERENCES users(id) ON DELETE CASCADE,
          UNIQUE(requester_id, addressee_id),
          CHECK(requester_id != addressee_id)
        );

        CREATE INDEX IF NOT EXISTS idx_friendships_requester ON friendships(requester_id);
        CREATE INDEX IF NOT EXISTS idx_friendships_addressee ON friendships(addressee_id);

        CREATE TABLE IF NOT EXISTS groups (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          name TEXT NOT NULL,
          description TEXT DEFAULT '',
          owner_id INTEGER NOT NULL,
          agent_name TEXT DEFAULT 'Group Agent',
          created_at TEXT DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
          updated_at TEXT DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
          FOREIGN KEY (owner_id) REFERENCES users(id) ON DELETE CASCADE
        );

        CREATE INDEX IF NOT EXISTS idx_groups_owner ON groups(owner_id);

        CREATE TABLE IF NOT EXISTS group_members (
          group_id INTEGER NOT NULL,
          user_id INTEGER NOT NULL,
          role TEXT NOT NULL DEFAULT 'member',
          joined_at TEXT DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
          PRIMARY KEY (group_id, user_id),
          FOREIGN KEY (group_id) REFERENCES groups(id) ON DELETE CASCADE,
          FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
        );

        CREATE INDEX IF NOT EXISTS idx_group_members_user ON group_members(user_id);

        CREATE TABLE IF NOT EXISTS group_messages (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          group_id INTEGER NOT NULL,
          user_id INTEGER NOT NULL,
          body TEXT NOT NULL,
          message_type TEXT NOT NULL DEFAULT 'text',
          created_at TEXT DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
          FOREIGN KEY (group_id) REFERENCES groups(id) ON DELETE CASCADE,
          FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
        );

        CREATE INDEX IF NOT EXISTS idx_group_messages_group ON group_messages(group_id, created_at);

        CREATE TABLE IF NOT EXISTS group_links (
          group_id INTEGER NOT NULL,
          link_id INTEGER NOT NULL,
          shared_by INTEGER NOT NULL,
          note TEXT DEFAULT '',
          created_at TEXT DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
          PRIMARY KEY (group_id, link_id),
          FOREIGN KEY (group_id) REFERENCES groups(id) ON DELETE CASCADE,
          FOREIGN KEY (link_id) REFERENCES links(id) ON DELETE CASCADE,
          FOREIGN KEY (shared_by) REFERENCES users(id) ON DELETE CASCADE
        );

        CREATE INDEX IF NOT EXISTS idx_group_links_group ON group_links(group_id);
        CREATE INDEX IF NOT EXISTS idx_group_links_link ON group_links(link_id);
      `);
    },
  },
  {
    name: '011_settings_and_legacy_chunks_schema',
    up(db) {
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
      `);
    },
  },
  {
    name: '012_assistant_runs_schema',
    up(db) {
      initAssistantRunSchema(db);
    },
  },
  {
    name: '013_assistant_message_agent_metadata',
    up(db) {
      addColumnIfMissing(db, 'assistant_messages', 'agent_json', "TEXT DEFAULT '{}'");
    },
  },
  {
    name: '014_item_understanding_schema',
    up(db) {
      initItemUnderstandingSchema(db);
    },
  },
  {
    name: '015_assistant_memory_schema',
    up(db) {
      initAssistantMemorySchema(db);
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
  const insert = db.prepare('INSERT OR IGNORE INTO schema_migrations (name) VALUES (?)');
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
