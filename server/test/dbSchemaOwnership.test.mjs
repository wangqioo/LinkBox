import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const dbSource = readFileSync(join(__dirname, '../db.js'), 'utf8');

test('db bootstrap leaves all table schema ownership to migrations', () => {
  assert.doesNotMatch(dbSource, /CREATE TABLE IF NOT EXISTS/);
});

test('db bootstrap leaves direct message schema ownership to migrations', () => {
  assert.doesNotMatch(
    dbSource,
    /CREATE TABLE IF NOT EXISTS direct_messages/,
  );
});

test('db bootstrap leaves social collaboration schema ownership to migrations', () => {
  for (const table of [
    'friendships',
    'groups',
    'group_members',
    'group_messages',
    'group_links',
  ]) {
    assert.doesNotMatch(
      dbSource,
      new RegExp(`CREATE TABLE IF NOT EXISTS ${table}`),
    );
  }
});
