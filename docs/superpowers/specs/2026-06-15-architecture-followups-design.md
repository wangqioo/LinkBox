# Architecture Follow-Ups Design

Date: 2026-06-15

## Context

LinkBox has reached two local architecture checkpoints:

- `7fa0a03 Deepen assistant and asset architecture`
- `990115f Deepen item intake and durable jobs`

The next work should continue deepening core modules without changing the
product shape. The target is still a modular monolith with Express, SQLite, the
desktop React app, and the mobile web app.

## Scope

This design covers three implementation slices:

1. Canonical retrieval for assistant answers.
2. Shared item presentation for desktop and mobile surfaces.
3. Shared extraction and post-extraction side effects.

E2E coverage and operations cleanup are explicitly follow-up work after these
three slices stabilize.

## Non-Goals

- No database table rename from `links` to `items`.
- No new infrastructure for jobs or search.
- No replacement of SQLite.
- No frontend redesign.
- No removal of legacy `link_chunks` until canonical document coverage is
  verified by tests.

## Slice 1: Canonical Retrieval

### Problem

Assistant retrieval currently mixes canonical document chunks, legacy chunks,
embedding candidates, rerank behavior, fallback behavior, and source limiting in
one area. Callers should not need to understand which backing store produced a
source.

### Design

Introduce a retrieval module that exposes one interface for assistant source
selection:

```js
retrieveAssistantSources(db, {
  userId,
  question,
  scope,
  limit,
  includeLegacyFallback = true,
})
```

The module owns:

- Canonical document chunk lookup.
- Embedding candidate merge.
- Rerank application.
- Time/scope filtering.
- Source limiting and stable source IDs.
- Legacy `link_chunks` fallback when canonical documents have no useful hits.

Existing lower-level helpers can remain in place, but assistant callers should
go through this interface.

### Tests

- Prefer canonical document chunks over legacy chunks when both exist.
- Fall back to legacy chunks only when canonical documents return no useful
  candidates.
- Preserve stable item IDs, source IDs, heading paths, and scores.
- Keep time/scope filtering behavior intact.

## Slice 2: Shared Item Presentation

### Problem

Desktop and mobile each derive display type, status, retry affordance, labels,
and action capability differently. This increases the chance that a file or job
state means one thing on desktop and another on mobile.

### Design

Introduce a backend presentation module:

```js
presentItem(row, {
  surface = 'desktop',
})
```

The module returns a stable display object layered on top of the stored item:

```json
{
  "display": {
    "type": "document",
    "typeLabel": "Document",
    "status": "queued",
    "statusLabel": "Queued",
    "canRetry": false,
    "canAnalyze": true,
    "primaryAssetUrl": "/uploads/file.pdf"
  }
}
```

Desktop list/detail and mobile file presentation should reuse the same
classification rules. Mobile can still reshape field names for compatibility,
but it should not re-derive the meanings.

### Tests

- Map stored `file` items to document display consistently.
- Prefer durable `processing.state` over legacy `links.status`.
- Expose retry capability only when processing says retry is available.
- Preserve mobile compatibility fields while sourcing values from the shared
  presentation module.

## Slice 3: Extraction Pipeline

### Problem

Manual extraction and background extraction do not fully share a post-extraction
path. Persisting markdown, indexing chunks, refreshing canonical documents,
enqueueing embeddings, and scheduling summaries should be one behavior behind
one module.

### Design

Introduce an extraction result module:

```js
persistExtractedContent(db, queue, {
  linkId,
  markdown,
  rawHtml,
  thumbnail,
  summarize = true,
})
```

The module owns:

- Persisting `content_md`, `html_note`, and thumbnails.
- Refreshing legacy chunk index while it still exists.
- Refreshing canonical documents.
- Enqueueing document embeddings when a canonical document exists.
- Enqueueing summarization when requested.
- Marking the item `done` when no markdown is available and no summary job is
  needed.

Manual link extraction and background link/file extraction should call this
module after their extractor returns content.

### Tests

- Background link extraction persists markdown, refreshes both indexes, and
  schedules summarization.
- Manual link extraction uses the same persistence/index path.
- File extraction preserves HTML notes and thumbnails.
- Empty extraction marks the item done without scheduling summary work.

## Deferred Slice: E2E Coverage

After the three core slices pass unit tests, add Playwright coverage for:

- Login.
- Add text/link/file item.
- Observe processing state.
- Retry a failed job.
- Export.
- Delete.

The E2E suite should use an isolated database and uploads directory.

## Deferred Slice: Operations Cleanup

After core behavior stabilizes, add:

- A small `AppError` helper for route error responses.
- Explicit migration files for schema changes.
- Health checks for SQLite, uploads, queue state, AI endpoint, `pdftotext`, and
  LibreOffice.

## Acceptance Criteria

- Each core slice lands in a separate commit.
- Each slice has failing tests before production code changes.
- `npm test` in `server` passes after every backend slice.
- Desktop and mobile builds pass after presentation changes.
- `docs/development.md` and `docs/architecture-redesign.md` reflect completed
  slices and next expectations.
