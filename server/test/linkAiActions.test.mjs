import test from 'node:test';
import assert from 'node:assert/strict';
import Database from 'better-sqlite3';
import { mkdtempSync, rmSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import {
  extractLinkContent,
  summarizeLinkItem,
} from '../utils/linkAiActions.js';

async function withDb(fn) {
  const dir = mkdtempSync(join(tmpdir(), 'linkbox-ai-action-test-'));
  const db = new Database(join(dir, 'test.db'));
  try {
    db.exec(`
      CREATE TABLE links (
        id INTEGER PRIMARY KEY,
        user_id INTEGER NOT NULL,
        type TEXT DEFAULT 'link',
        url TEXT DEFAULT '',
        title TEXT DEFAULT '',
        description TEXT DEFAULT '',
        content TEXT DEFAULT '',
        content_md TEXT DEFAULT '',
        summary TEXT DEFAULT ''
      );
      CREATE TABLE tags (id INTEGER PRIMARY KEY, user_id INTEGER NOT NULL, name TEXT NOT NULL);
      CREATE TABLE link_tags (link_id INTEGER NOT NULL, tag_id INTEGER NOT NULL);
    `);
    return await fn(db);
  } finally {
    db.close();
    rmSync(dir, { recursive: true, force: true });
  }
}

test('summarizeLinkItem summarizes text items from title and content', async () => withDb(async (db) => {
  db.prepare("INSERT INTO links (id, user_id, type, title, content) VALUES (1, 5, 'text', 'T', 'Body')").run();
  const calls = [];

  const result = await summarizeLinkItem(db, {
    linkId: 1,
    userId: 5,
    summarizeContent: async (text, type) => {
      calls.push({ text, type });
      return '摘要';
    },
  });

  assert.deepEqual(calls, [{ text: 'T\n\nBody', type: 'text' }]);
  assert.equal(result.link.summary, '摘要');
  assert.equal(db.prepare('SELECT summary FROM links WHERE id = 1').get().summary, '摘要');
}));

test('summarizeLinkItem prefers extracted markdown when present', async () => withDb(async (db) => {
  db.prepare("INSERT INTO links (id, user_id, type, title, content_md) VALUES (1, 5, 'link', 'Article', '# Markdown')").run();
  const calls = [];

  await summarizeLinkItem(db, {
    linkId: 1,
    userId: 5,
    summarizeMarkdown: async (markdown, title) => {
      calls.push({ markdown, title });
      return 'md summary';
    },
  });

  assert.deepEqual(calls, [{ markdown: '# Markdown', title: 'Article' }]);
}));

test('summarizeLinkItem falls back to title description or url for links', async () => withDb(async (db) => {
  db.prepare("INSERT INTO links (id, user_id, type, url, title, description) VALUES (1, 5, 'link', 'https://x.example', '', '')").run();
  const calls = [];

  await summarizeLinkItem(db, {
    linkId: 1,
    userId: 5,
    summarizeContent: async (text, type) => {
      calls.push({ text, type });
      return 'fallback summary';
    },
  });

  assert.deepEqual(calls, [{ text: 'https://x.example', type: 'link' }]);
}));

test('summarizeLinkItem rejects missing or unsupported items', async () => withDb(async (db) => {
  db.prepare("INSERT INTO links (id, user_id, type) VALUES (1, 5, 'image')").run();
  db.prepare("INSERT INTO links (id, user_id, type, title, content) VALUES (2, 5, 'text', '', '')").run();

  await assert.rejects(
    () => summarizeLinkItem(db, { linkId: 404, userId: 5 }),
    error => error.status === 404 && error.message === '不存在',
  );
  await assert.rejects(
    () => summarizeLinkItem(db, { linkId: 1, userId: 5 }),
    error => error.status === 400 && error.message === '该类型不支持摘要',
  );
  await assert.rejects(
    () => summarizeLinkItem(db, {
      linkId: 2,
      userId: 5,
      summarizeContent: async () => '',
    }),
    error => error.status === 400 && error.message === '没有可摘要的内容',
  );
}));

test('extractLinkContent extracts markdown, stores it, and indexes the link', async () => withDb(async (db) => {
  db.prepare("INSERT INTO links (id, user_id, type, url) VALUES (1, 5, 'link', 'https://article.example')").run();
  const indexed = [];

  const result = await extractLinkContent(db, {
    linkId: 1,
    userId: 5,
    extractPageMarkdown: async url => ({
      markdown: `# From ${url}`,
      title: 'Article',
      byline: 'Author',
      siteName: 'Site',
      wordCount: 123,
    }),
    indexLink: linkId => indexed.push(linkId),
  });

  assert.deepEqual(result, {
    content_md: '# From https://article.example',
    meta: {
      title: 'Article',
      byline: 'Author',
      siteName: 'Site',
      wordCount: 123,
    },
  });
  assert.equal(db.prepare('SELECT content_md FROM links WHERE id = 1').get().content_md, '# From https://article.example');
  assert.deepEqual(indexed, [1]);
}));

test('extractLinkContent validates item ownership, type, and url', async () => withDb(async (db) => {
  db.prepare("INSERT INTO links (id, user_id, type, url) VALUES (1, 5, 'text', '')").run();
  db.prepare("INSERT INTO links (id, user_id, type, url) VALUES (2, 5, 'link', '')").run();

  await assert.rejects(
    () => extractLinkContent(db, { linkId: 404, userId: 5 }),
    error => error.status === 404 && error.message === '不存在',
  );
  await assert.rejects(
    () => extractLinkContent(db, { linkId: 1, userId: 5 }),
    error => error.status === 400 && error.message === '只有链接类型支持正文提取',
  );
  await assert.rejects(
    () => extractLinkContent(db, { linkId: 2, userId: 5 }),
    error => error.status === 400 && error.message === '链接地址为空',
  );
}));
