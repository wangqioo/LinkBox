# LinkBox Roadmap And Status

Last updated: 2026-06-25

This is the current planning index for LinkBox. Use it before starting new
feature or architecture work so older plans are not mistaken for active tasks.

## Product Shape

LinkBox is a local-first personal knowledge base with lightweight collaboration
and AI retrieval. It stores links, notes, images, audio, files, articles, and
Bilibili videos; background jobs enrich those items into canonical Markdown,
summaries, document chunks, embeddings, and source references. Personal and
group Assistants query separate retrieval scopes.

The project should remain a SQLite-backed modular monolith for now:

- one Express backend
- one SQLite database
- one React desktop/admin client
- one Vue mobile client

## Current Checkpoint

The latest committed baseline is:

```bash
main 52fa19a Fix social message timestamps
```

The working tree also contains follow-up development for Assistant source
inspection, failed-job recovery hints, item processing recovery hints,
Assistant JSON error helper migration, and the Smart Agent layer. See
`docs/development.md` for exact verification commands and current
working-tree notes.

## Done

- Durable SQLite-backed jobs for link/file/image enrichment and retry.
- Item processing status derived from jobs and returned to desktop/mobile
  clients.
- Shared item presentation, normalized item kinds, and mobile file presentation.
- Canonical Markdown documents, heading-aware chunks, optional embeddings, and
  local rerank.
- Admin document maintenance stats, reindexing, embedding backfill, and
  retrieval diagnostics.
- Assistant retrieval with canonical document preference and legacy fallback
  gate.
- Smart Agent planner, persisted run steps, multi-pass retrieval, evidence
  notebooks, citation verification, structured item understanding, explicit
  memory, and desktop diagnostics.
- Personal and group Assistant conversation history.
- Social collaboration: friends, direct chats, groups, group materials, scoped
  uploads, comments, and group Assistant isolation.
- Explicit migrations for jobs, documents, assistant conversations,
  social collaboration tables, `item_content`, `item_assets`, Assistant runs,
  message agent metadata, item understanding, and Assistant memory.
- Admin system health and bounded failed-job retry controls.
- Browser E2E, canonical-only E2E, and isolated server smoke gates.

## Active Architecture Debt

These are the highest-value next improvements. They are deliberately phrased as
small slices rather than rewrites.

1. **Document status cleanup**
   Keep this roadmap as the planning entry point. Move outdated plan details
   into historical context and keep active work in this file or issue-sized
   plans.

2. **Mobile view decomposition**
   `mobile/src/views/Home.vue`, `Friends.vue`, `FileDetail.vue`, and
   `mobile/src/components/ChatBox.vue` are still large feature views. Extract
   composables around existing workflows before adding more mobile social or
   assistant behavior.

3. **Social route deepening**
   `server/routes/social.js` now delegates shared membership, friendship,
   timestamp, message payload, and material payload logic to
   `server/utils/socialService.js`. Continue splitting direct-chat and
   group-chat handlers only when their route behavior changes.

4. **Route JSON error helper migration**
   Auth, tags, admin, settings, and Assistant JSON endpoints use the shared
   helper. Continue migrating larger routes only when touching them for behavior
   changes and after adding route-level tests.

5. **Schema ownership cleanup**
   `server/db.js` now owns database connection, pragmas, upload directory
   creation, and migration execution only. All table creation lives behind
   explicit migrations.

6. **Smart Agent quality loop**
   The Agent is observable and deterministic around planning, retrieval,
   evidence, verification, structured fallback, and explicit memory. Future
   work should improve quality with measured retrieval fixtures before adding
   heavier LLM-driven reasoning.

7. **Smart Agent productization**
   The first Smart Agent pass is implemented and validated, but follow-up work
   remains: commit/release hygiene, historical item-understanding backfill,
   memory management UI, mobile Agent diagnostics, an Assistant quality
   evaluation set, and optional LLM-assisted understanding. The active task
   queue lives in
   `docs/superpowers/plans/2026-06-25-smart-agent.md#deferred-follow-up-plan`.

## Decisions Needed

These need explicit decisions before implementation.

1. **Document history**
   Current canonical documents are overwritten for an item/parser version. Keep
   overwrite-in-place for simplicity unless audit, rollback, or reproducible AI
   outputs become product requirements.

2. **Legacy compatibility retirement**
   `links.content_md`, `links.image_path`, and legacy `link_chunks` still exist
   for compatibility. Retire them only after export/backup, mobile, desktop,
   search, and Assistant flows all read through canonical helpers and the
   canonical-only E2E gate stays green.

3. **Production embedding default**
   Local deterministic embeddings keep the pipeline operational. Choose a
   production OpenAI-compatible embedding provider only after documenting model,
   dimension, cost, and home-server performance tradeoffs.

4. **LLM rerank**
   Local rerank is implemented. Add OpenAI-compatible LLM rerank only if
   retrieval quality tests show clear gains over the local heuristic.

## Later

- Document versions and rollback UI.
- LLM-assisted annotations beyond deterministic entities, todos, claims, and
  topics, such as questions, contradictions, and richer project timelines.
- Historical structure backfill for existing items.
- User-facing memory review and deletion controls.
- Mobile Agent status and diagnostics.
- Assistant retrieval/answer quality fixture suite.
- Promotion flow for chat-scoped materials into the personal library.
- Legacy `link_chunks` write retirement after canonical-only confidence.
- More granular validation scripts for focused backend and browser subsets.

## Validation Gates

Use [validation.md](./validation.md) for the full matrix. The broad gate is:

```bash
cd server && npm test
cd server && npm run test:e2e
cd client && npm test
cd client && npm run build
cd client && npm run test:e2e
cd client && npm run test:e2e:canonical
cd mobile && npm test
cd mobile && npm run build
git diff --check
```
