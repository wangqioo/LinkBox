# Markdown-First Knowledge Base Redesign Plan

Date: 2026-06-11

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

Start with SQLite-friendly hybrid keyword retrieval:

- high weight: title, tags, user comment, document summary
- medium weight: chunk content and heading path
- light boost: recency
- return chunks with document title, source URL/file name, and heading path

Later add optional embeddings:

```text
keyword candidates + vector candidates -> merge -> rerank -> AI context
```

Do not make vector search the only retrieval path. Personal knowledge bases need
structured signals such as tags, dates, titles, and source metadata.

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

1. Add `documents` and `document_chunks` tables.
2. Write a migration/indexing job that converts existing `links.content_md` into
   `documents.markdown`.
3. Move new import jobs to write documents first, then chunks.
4. Update assistant retrieval to read from chunks instead of directly from
   `links.content_md`.
5. Add a document/chunk inspection UI for debugging.
6. Add manual actions: reparse, rechunk, reindex, regenerate AI annotations.
7. Add optional embedding and rerank adapters after keyword retrieval is stable.

## Open Questions

- Whether to keep a compatibility copy of `links.content_md` during migration.
- How much frontmatter should be stored in Markdown versus normalized columns.
- Which chunk metadata should be visible in the UI.
- Whether Markdown versions should be append-only or overwritten with history.
- Which embedding backend should be the first optional adapter.
