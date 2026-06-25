# Markdown-First Knowledge Base Redesign Plan

Date: 2026-06-11

Status: usable as of 2026-06-11. The Markdown document layer, chunk index,
assistant retrieval, inspection UI, manual document actions, and optional
embedding/rerank pipeline have been implemented in the working tree. Remaining
work is now product hardening and configuration polish, not a blocker for basic
use.

For current planning status and active architecture debt, start with
[roadmap.md](./roadmap.md). This document is retained as Markdown-first
knowledge-base design background.

## Goal

Promote Markdown from an item field into LinkBox's canonical knowledge
representation. Links, files, images, audio, and text notes should all become
normalized Markdown documents that can be stored, chunked, indexed, retrieved,
and shown to AI with clear source references.

## Why This Matters

The current model stores extracted Markdown mostly as `links.content_md`. That
works for display and simple search, but it makes the knowledge base too tightly
coupled to the original collection item. AI retrieval needs a more explicit
document layer:

- original imported items should remain recoverable and reprocessable
- normalized Markdown should be versioned and reusable
- chunks should preserve Markdown structure and source headings
- AI context should be assembled from clean, cited chunks instead of raw fields
- future embedding, rerank, and re-indexing work should not require rewriting
  import routes

## Target Architecture

```text
items
  link / file / image / audio / text source metadata
      |
      v
documents
  canonical Markdown + parser metadata + version/hash
      |
      v
document_chunks
  heading-aware, type-aware Markdown chunks
      |
      v
retrieval
  keyword search -> optional vector search -> rerank
      |
      v
AI context
  compact, cited Markdown snippets for assistant/summaries/reports
```

## Proposed Tables

```text
documents
  id
  item_id
  user_id
  title
  markdown
  markdown_hash
  parser_version
  language
  status
  created_at
  updated_at

document_chunks
  id
  document_id
  chunk_index
  heading_path
  chunk_type
  content
  content_hash
  token_count
  char_start
  char_end
  metadata_json

document_embeddings
  id
  chunk_id
  provider
  model
  dimension
  vector
  content_hash
  created_at

document_annotations
  id
  document_id
  type
  content_json
  model
  created_at
```

Keep `items`/`links` as the source collection layer. Move AI retrieval toward
`documents` and `document_chunks`.

## Canonical Markdown Format

Every import should produce a canonical Markdown document with frontmatter-like
metadata:

```md
---
title: Example Title
source_type: link
source_url: https://example.com
imported_at: 2026-06-11
tags: [AI, RK3576]
parser: readability-v1
---

# Example Title

Main extracted content.

## Image Notes

![image](/uploads/example.png)

> Image description: generated visual summary.
```

This format should be human-readable, exportable, re-indexable, and compact
enough for AI context assembly.

## Chunking Rules

Prefer semantic Markdown chunks over fixed-size slicing:

- split by heading hierarchy first
- keep `heading_path` on every chunk
- keep tables, image captions, code blocks, and lists as typed chunks
- merge chunks that are too short with nearby context
- split chunks that are too long by paragraph boundaries
- store stable hashes so unchanged chunks do not need re-embedding

## Retrieval Strategy

Start with SQLite-friendly hybrid retrieval:

- high weight: title, tags, user comment, document summary
- medium weight: chunk content and heading path
- light boost: recency
- return chunks with document title, source URL/file name, and heading path

Embeddings should be used as a first-class retrieval path when available:

```text
keyword candidates + vector candidates -> merge -> rerank -> AI context
```

Do not make vector search the only retrieval path. Personal knowledge bases need
structured signals such as tags, dates, titles, and source metadata. However,
keyword retrieval must not gate vector retrieval: if embeddings are enabled,
vector candidates should be requested even when keyword search returns no
matches. Treat vectors as the primary semantic recall path and keyword matches as
precision boosts and fallback signals.

Time expressions in assistant questions should narrow retrieval before ranking.
Supported phrases include today, yesterday, the day before yesterday, this week,
last week, recent N days, ISO dates, and Chinese month/day expressions. All
filters apply to `links.imported_at`.

## AI Context Contract

Assistant, report, organize, and todo flows should receive cited snippets:

```md
[Source 1]
Title: Example Title
Path: Section > Subsection
Source: https://example.com
Content:
...
```

AI answers should preserve source references so the UI can link back to the
original item and highlighted chunk.

## Migration Plan

1. [x] Add `documents` and `document_chunks` tables.
2. [x] Write a migration/indexing path that converts existing
   `links.content_md` into `documents.markdown`.
3. [x] Move new import jobs to write canonical documents and chunks after
   extraction/summarization.
4. [x] Update assistant retrieval to read from `document_chunks` before falling
   back to legacy chunks and fields.
5. [x] Add a document/chunk inspection UI for debugging.
6. [x] Add manual actions: rechunk, reindex, and generate local inspection
   annotations.
7. [x] Add optional embedding adapters after keyword retrieval is stable.
8. [x] Add rerank adapters for keyword + embedding candidates.
9. [x] Add admin operations for bulk document reindexing and embedding backfill.
10. [x] Add UI configuration for real embedding providers.
11. [ ] Decide whether Markdown document history should be append-only or
    overwrite-in-place.

## Implemented State

The current working tree can already be used as a Markdown-first knowledge base:

- new tables are created by `initDocumentSchema`
- canonical Markdown is stored in `documents`
- heading-aware chunks are stored in `document_chunks`
- local inspection annotations are stored in `document_annotations`
- optional embeddings are stored in `document_embeddings`
- assistant retrieval prefers document chunks and preserves source/chunk context
- assistant retrieval applies a local reranker after document keyword/embedding
  candidates are merged
- assistant retrieval can infer date ranges from natural-language questions and
  applies them to document keyword search, vector search, legacy chunks, and
  field fallback
- background enrichment jobs refresh document indexes after link, file, and image
  processing
- `document.embed` jobs can asynchronously backfill embeddings
- document inspection UI shows canonical Markdown, chunks, annotations, and
  embedding coverage

Embedding is currently optional. Without embedding configuration, LinkBox still
works through SQLite-friendly keyword retrieval. With embedding enabled, the
pipeline should merge keyword candidates and vector candidates on every document
retrieval request, even when one side returns no candidates.

Supported embedding modes:

- local deterministic hash embedding: no external dependency, useful for testing
  and keeping the pipeline operational
- OpenAI-compatible `/embeddings`: configured through the admin settings UI or
  environment defaults such as `EMBEDDING_PROVIDER=openai-compatible`,
  `EMBEDDING_BASE_URL`, `EMBEDDING_API_KEY`, and `EMBEDDING_MODEL`

## Remaining Development Plan

### 1. Bulk Maintenance Operations

Goal: make the feature maintainable on existing databases.

Status: implemented. Admin system status reports document, chunk, embedding,
and consistency counts; settings routes expose reindex and embedding backfill
operations.

Tasks:

- [x] add an admin API to reindex all missing/outdated documents
- [x] add an admin API to enqueue `document.embed` for missing embeddings
- [x] expose counts for documents, chunks, embeddings, and failed embedding jobs
- [x] add tests around ownership, idempotency, and job de-duplication

Suggested files:

- `server/routes/settings.js`
- `server/utils/documentIndex.js`
- `server/utils/documentEmbeddings.js`
- `server/test/enrichmentJobs.test.mjs`
- `client/src/pages/SettingsPage.tsx`

### 2. Rerank Adapter

Goal: improve retrieval quality after keyword and embedding candidate merge.

Tasks:

- [x] define a rerank contract that accepts candidates and returns ordered candidate
  IDs with scores
- [x] implement a local heuristic reranker first
- [x] document the decision to defer an OpenAI-compatible LLM reranker until
  retrieval quality tests show clear gains over the local heuristic
- [x] keep reranking optional and bounded by a small candidate limit
- [x] add tests proving rerank changes candidate order without removing citations

Current behavior:

- local rerank is enabled by default for document candidates
- set `ASSISTANT_ENABLE_RERANK=0` to disable it
- scoring boosts title/heading matches, phrase matches, token coverage,
  dual keyword+embedding hits, and recency tie-breaks
- embedding recall is independent from keyword recall, so semantic vector
  matches are still considered when keyword search has no hits

Suggested files:

- `server/utils/assistantRetrieval.js`
- `server/utils/documentRerank.js`
- `server/test/assistantRetrieval.test.mjs`

### 3. Embedding Configuration UI

Goal: make real embedding providers configurable without editing environment
variables.

Status: implemented for local and OpenAI-compatible embedding settings.

Tasks:

- [x] add embedding provider fields to settings
- [x] keep embedding config separate from chat/vision model config
- [x] add a test endpoint for `/embeddings`
- [x] show embedding status and last error in system settings

Suggested files:

- `server/utils/aiConfig.js`
- `server/routes/settings.js`
- `client/src/api/client.ts`
- `client/src/pages/AISettingsPanel.tsx`
- `client/src/pages/settingsConfig.ts`

### 4. AI Annotations

Goal: upgrade local inspection annotations into useful knowledge metadata.

Tasks:

- add annotation types such as `summary`, `entities`, `todos`, `claims`, and
  `questions`
- use the configured LLM to generate annotation JSON
- keep local inspection summary as a no-network fallback
- show annotation type and model clearly in the inspection UI

Suggested files:

- `server/utils/documentInspector.js`
- `server/utils/aiConfig.js`
- `server/test/itemController.test.mjs`
- `client/src/components/DocumentInspectorModal.tsx`

### 5. Document Versioning

Goal: decide whether document updates should preserve history.

Current behavior overwrites the canonical document for `(item_id,
parser_version)`. That is simple and works for daily use. If LinkBox needs audit
or reproducible AI outputs, add a version table instead of overwriting.

Decision needed:

- keep overwrite-in-place for simplicity
- or add append-only `document_versions` for history and rollback

## Recommended Next Order

1. Bulk maintenance operations.
2. Rerank adapter.
3. Embedding configuration UI.
4. AI annotations.
5. Document versioning, only if history becomes necessary.

## Open Questions

- Whether to keep a compatibility copy of `links.content_md` long term.
- How much frontmatter should be stored in Markdown versus normalized columns.
- Whether Markdown versions should be append-only or overwritten with history.
- Which embedding backend should be the first production default.
- Whether rerank should use a local heuristic, an LLM, or both.
