import test from 'node:test';
import assert from 'node:assert/strict';
import Database from 'better-sqlite3';
import { mkdtempSync, rmSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import {
  createAudioItem,
  createFileItem,
  createImageItem,
  createLinkItem,
  createTextItem,
  importLinkItems,
} from '../utils/linkCreateService.js';

function withDb(fn) {
  const dir = mkdtempSync(join(tmpdir(), 'linkbox-create-test-'));
  const db = new Database(join(dir, 'test.db'));
  try {
    db.exec(`
      CREATE TABLE links (
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
        imported_at TEXT DEFAULT '',
        status TEXT DEFAULT '',
        batch_id TEXT DEFAULT '',
        batch_index INTEGER DEFAULT 0
      );
      CREATE TABLE tags (
        id INTEGER PRIMARY KEY,
        user_id INTEGER NOT NULL,
        name TEXT NOT NULL
      );
      CREATE TABLE link_tags (
        link_id INTEGER NOT NULL,
        tag_id INTEGER NOT NULL,
        PRIMARY KEY (link_id, tag_id)
      );
    `);
    db.prepare("INSERT INTO tags (id, user_id, name) VALUES (1, 5, 'AI'), (2, 5, 'Read')").run();
    return fn(db);
  } finally {
    db.close();
    rmSync(dir, { recursive: true, force: true });
  }
}

test('createLinkItem saves a processing link with tags and enqueue payload', () => withDb((db) => {
  const result = createLinkItem(db, {
    userId: 5,
    url: 'https://example.com',
    title: '',
    comment: 'later',
    tagIds: [1, 2],
    importedAt: '2026-06-09T00:00:00.000Z',
  });

  assert.equal(result.link.type, 'link');
  assert.equal(result.link.url, 'https://example.com');
  assert.equal(result.link.title, 'https://example.com');
  assert.equal(result.link.status, 'processing');
  assert.equal(result.link.display.type, 'link');
  assert.equal(result.link.display.status, 'processing');
  assert.deepEqual(result.link.tags.map(tag => tag.name), ['AI', 'Read']);
  assert.deepEqual(result.processing, {
    linkId: result.link.id,
    url: 'https://example.com',
    title: '',
  });
}));

test('createTextItem saves text content and indexes the created link', () => withDb((db) => {
  const indexed = [];
  const result = createTextItem(db, {
    userId: 5,
    title: 'Note',
    content: 'Body',
    comment: '',
    tagIds: [1],
    importedAt: '2026-06-09T00:00:00.000Z',
    indexLink: linkId => indexed.push(linkId),
  });

  assert.equal(result.link.type, 'text');
  assert.equal(result.link.title, 'Note');
  assert.equal(result.link.content, 'Body');
  assert.equal(result.link.display.type, 'text');
  assert.deepEqual(result.link.tags.map(tag => tag.name), ['AI']);
  assert.deepEqual(indexed, [result.link.id]);
}));

test('importLinkItems skips blank items and returns enqueue payloads', () => withDb((db) => {
  const result = importLinkItems(db, {
    userId: 5,
    items: [
      'https://a.example',
      { url: 'https://b.example', title: 'B', comment: 'c', imported_at: '2026-01-01T00:00:00.000Z' },
      { title: 'missing url' },
    ],
  });

  assert.equal(result.imported, 2);
  assert.deepEqual(result.toFetch.map(item => ({ url: item.url, title: item.title })), [
    { url: 'https://a.example', title: '' },
    { url: 'https://b.example', title: 'B' },
  ]);
  assert.deepEqual(
    db.prepare('SELECT url, title, comment, status FROM links ORDER BY id').all(),
    [
      { url: 'https://a.example', title: 'https://a.example', comment: '', status: 'processing' },
      { url: 'https://b.example', title: 'B', comment: 'c', status: 'processing' },
    ],
  );
}));

test('createImageItem saves image metadata and returns image processing payload', () => withDb((db) => {
  const result = createImageItem(db, {
    userId: 5,
    imagePath: '/uploads/a.png',
    diskPath: '/tmp/a.png',
    originalName: 'photo.png',
    title: '',
    comment: 'look',
    tagIds: [2],
    importedAt: '2026-06-09T00:00:00.000Z',
    batchId: 'batch-abc',
    batchIndex: 1,
  });

  assert.equal(result.link.type, 'image');
  assert.equal(result.link.title, 'photo.png');
  assert.equal(result.link.image_path, '/uploads/a.png');
  assert.equal(result.link.thumbnail, '/uploads/a.png');
  assert.equal(result.link.batch_id, 'batch-abc');
  assert.equal(result.link.batch_index, 1);
  assert.equal(result.link.status, 'processing');
  assert.equal(result.link.display.type, 'image');
  assert.equal(result.link.display.primaryAssetUrl, '/uploads/a.png');
  assert.deepEqual(result.processing, {
    linkId: result.link.id,
    diskPath: '/tmp/a.png',
  });
}));

test('createAudioItem saves audio uploads without background processing', () => withDb((db) => {
  const result = createAudioItem(db, {
    userId: 5,
    audioPath: '/uploads/a.wav',
    title: '',
    comment: '',
    tagIds: [1],
    importedAt: '2026-06-09T00:00:00.000Z',
  });

  assert.equal(result.link.type, 'audio');
  assert.equal(result.link.title, '录音');
  assert.equal(result.link.image_path, '/uploads/a.wav');
  assert.equal(result.link.display.type, 'audio');
  assert.deepEqual(result.link.tags.map(tag => tag.name), ['AI']);
}));

test('createFileItem saves supported files as processing and returns extraction payload', () => withDb((db) => {
  const result = createFileItem(db, {
    userId: 5,
    filePath: '/uploads/report.html',
    diskPath: '/tmp/report.html',
    originalName: 'report.html',
    sizeBytes: 2048,
    title: '',
    comment: '',
    tagIds: [],
    importedAt: '2026-06-09T00:00:00.000Z',
  });

  assert.equal(result.link.type, 'file');
  assert.equal(result.link.title, 'report.html');
  assert.equal(result.link.description, 'report.html (2 KB)');
  assert.equal(result.link.status, 'processing');
  assert.equal(result.link.display.type, 'document');
  assert.equal(result.link.display.status, 'processing');
  assert.deepEqual(result.processing, {
    linkId: result.link.id,
    diskPath: '/tmp/report.html',
    originalName: 'report.html',
    isHtml: true,
  });
}));

test('createFileItem saves unsupported files as done without extraction payload', () => withDb((db) => {
  const result = createFileItem(db, {
    userId: 5,
    filePath: '/uploads/archive.zip',
    diskPath: '/tmp/archive.zip',
    originalName: 'archive.zip',
    sizeBytes: 4096,
  });

  assert.equal(result.link.status, 'done');
  assert.equal(result.link.display.status, 'done');
  assert.equal(result.processing, null);
}));
