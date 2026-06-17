# Item Content And Assets Migration Plan

Date: 2026-06-17

Status: planning document. Do not start schema changes until the current
`links`-compatible API contracts are covered by server and browser tests.

## Goal

Split the overloaded `links` table into clearer item, content, and asset
ownership boundaries while keeping existing clients compatible during the
migration.

The target is still a SQLite modular monolith. This is not a rewrite. Each step
must be reversible and testable on an existing database.

## Current Pain

- `links` stores source metadata, extracted Markdown, user text, thumbnails,
  uploaded file paths, generated summaries, HTML notes, status, and batch
  metadata in one row.
- `documents` and `document_chunks` already act as the canonical knowledge
  layer, but many write paths still update `links.content_md` and legacy
  `link_chunks`.
- Uploaded files and generated assets are represented by string columns instead
  of an owned asset table.

## Target Tables

```text
items
  id
  user_id
  type
  source_url
  title
  description
  thumbnail_url
  comment
  status
  imported_at
  created_at
  updated_at

item_content
  item_id
  user_id
  text_content
  extracted_markdown
  summary
  html_note
  content_hash
  updated_at

item_assets
  id
  item_id
  user_id
  kind
  public_path
  disk_path
  original_name
  mime_type
  size_bytes
  metadata_json
  created_at
```

Keep `links` as the compatibility table until every route, mobile adapter, and
export path can read through item presentation helpers.

## Migration Sequence

1. Add explicit migrations for `item_content` and `item_assets`.
2. Backfill `item_content` from existing `links.content`, `links.content_md`,
   `links.summary`, and `links.html_note`.
3. Backfill `item_assets` from `links.image_path`, file upload descriptions,
   and existing thumbnail paths where the source is an owned upload.
4. Add repository helpers that read from the new tables and fall back to
   `links` columns when a row has not been backfilled.
5. Update write paths to dual-write `links` compatibility columns and the new
   tables.
6. Update item presentation, mobile file responses, exports, document indexing,
   and assistant retrieval to read through the repository helpers.
7. Add a consistency check script that reports missing content/assets rows for
   items that should have them.
8. After one release cycle, narrow writes to `links.content*` and
   `links.image_path` to compatibility-only updates.
9. Only after backup/restore and export paths are verified, plan a later
   migration to retire the redundant columns.

## Legacy `link_chunks` Retirement Plan

`link_chunks` remains a fallback index today. Do not remove it until all of
these are true:

- New and reprocessed items always create canonical `documents` rows.
- Assistant retrieval diagnostics show canonical document hits for common
  link, text, file, and image-description queries.
- The full browser E2E suite passes with legacy fallback disabled in a test
  configuration.
- Search/report/todo assistant tasks are covered against canonical chunks.
- Existing databases have an admin reindex path that can rebuild missing
  documents and document chunks.

Retirement should happen in two steps:

1. Add a feature flag or environment variable that disables legacy fallback in
   assistant retrieval while keeping indexing writes intact.
2. Stop writing `link_chunks` after canonical-only retrieval is stable, then
   leave read-only migration support for old databases.

## Test Gates

Before any schema-changing commit:

- `cd server && npm test`
- `cd server && npm run test:e2e`
- `cd client && npm test`
- `cd client && npm run build`
- `cd mobile && npm run build`
- `cd client && npm run test:e2e`
- `git diff --check`
