# LinkBox Development Guide

Last updated: 2026-06-25

This document records the current development state so future work can resume
without rediscovering the architecture, commands, and validation steps.

## Current Checkpoint

The current architecture follow-up checkpoint is:

```bash
main 52fa19a Fix social message timestamps
```

This includes the earlier 2026-06-15 item intake pass, the follow-up
architecture slices for assistant retrieval, item presentation, extracted
content persistence, isolated server smoke coverage, admin health checks,
shared route JSON error shaping, explicit database migrations, the
2026-06-16/17 admin observability pass, and the 2026-06-17 processing/status
and migration-hardening pass. It also includes the 2026-06-21 Bilibili video
processing pass, normalized item kind pass, mobile detail/list behavior fixes,
the 2026-06-24 social collaboration/mobile chat polish pass, Assistant
conversation history, and social message timestamp fixes.

At this checkpoint:

- `server/routes/assistant.js` is a thin HTTP/SSE adapter. Source grouping,
  public source shaping, prompt construction, context trimming, task
  normalization, and citation cleanup live in `server/utils/assistantTurn.js`.
- Desktop and mobile upload flows share `server/utils/uploadedAsset.js` for
  decoded names, public/disk paths, size metadata, upload type classification,
  extraction support, HTML detection, and processing payloads.
- The desktop Markdown renderer delegates inline parsing, citation
  normalization, and table HTML sanitization to
  `client/src/components/markdownParser.ts`.
- Mobile assistant chat reuses a small Markdown/citation utility at
  `mobile/src/utils/markdownParser.js`, with tests covering unsafe HTML,
  citation normalization, image proxying, and table sanitization.
- Mobile Assistant answer rendering also uses
  `renderAssistantMarkdown` from `mobile/src/utils/markdownParser.js`, so
  headings, lists, inline code, bold text, and bounded citations are tested
  outside `ChatBox.vue`.
- Backend unit tests, desktop build, mobile build, and `git diff --check` all
  passed before the item intake pass started.
- Item acceptance and durable job scheduling live in
  `server/utils/itemIntake.js`. Desktop item routes and mobile upload/analyze
  flows delegate accept, import, retry, and reschedule behavior there.
- Assistant source retrieval has a caller-facing interface at
  `server/utils/assistantSourceRetrieval.js`. It normalizes canonical document
  sources and legacy fallback sources before assistant routes build prompts.
- Desktop item list/detail responses and mobile file responses reuse
  `server/utils/itemPresentation.js` for display type, status, retry
  affordance, action capability, and primary asset URL.
- Manual link extraction and background link/file extraction share
  `server/utils/extractedContentPersistence.js` for storing extracted content,
  preserving raw HTML/thumbnails, refreshing indexes, queueing embeddings, and
  scheduling summaries.
- A server-side E2E smoke entrypoint exists at
  `server/scripts/e2e-smoke.mjs` and is exposed as `npm run test:e2e`. It starts
  the real server with isolated database/uploads paths and covers auth, create,
  upload, list, update, export, and delete flows.
- Operational health checks live in `server/utils/systemHealth.js` and are
  exposed through the admin `GET /api/settings/system` response. They report
  SQLite, uploads, queue, AI endpoint, `pdftotext`, and LibreOffice status, with
  core dependency failures marked unhealthy and optional capability gaps marked
  degraded.
- Route JSON error shaping has a small shared helper at
  `server/utils/appError.js`. `itemController` uses it for expected status-code
  errors and unexpected 500 responses while preserving existing user-facing
  fallback messages.
- `server/scripts/e2e-smoke.mjs` now runs with a local mock OpenAI-compatible
  endpoint and covers admin system health, AI config, failed job retry, and
  assistant chat in addition to the item CRUD/export flow.
- Boot-time item-column upgrades now run through
  `server/utils/dbMigrations.js`, which records applied migrations in
  `schema_migrations` and is covered against legacy `links` tables.
- Admin system status now includes a bounded failed-job list. The settings page
  shows individual failed jobs and supports retrying one failed job or all
  failed jobs through `POST /api/settings/system/retry-failed-jobs`.
- Failed-job rows include user-facing stage labels and recovery hints so admins
  can tell whether to check document parsers, AI settings, vision settings,
  webpage access, or embedding configuration before retrying.
- Item processing status uses the same recovery-hint mapping as the failed-job
  admin list, so normal item cards can keep the raw error separate from the
  suggested recovery action.
- Embedding settings are stored separately from chat AI settings in
  `server/utils/embeddingConfig.js`. Document indexing, assistant retrieval,
  document maintenance, and background `document.embed` jobs use the same
  provider/model configuration.
- Assistant retrieval diagnostics are exposed at
  `POST /api/assistant/retrieval-diagnostics` and surfaced in the settings UI.
  The endpoint returns retrieval settings plus source/chunk metadata, scores,
  retrieval modes, snippets, and rerank information without calling the LLM.
- Browser E2E coverage now includes assistant retrieval diagnostics and
  background failed-job retry UI. The Playwright backend wrapper seeds a
  test-only failed job in its temporary database.
- A dedicated canonical-only browser E2E gate is available through
  `cd client && npm run test:e2e:canonical`. It runs assistant retrieval with
  `ASSISTANT_ENABLE_LEGACY_FALLBACK=0` on isolated ports and verifies the
  diagnostics UI can retrieve uploaded Markdown through canonical document
  chunks.
- Assistant chat responses now expose normalized source metadata so the normal
  chat UI can show the retrieval path without calling the diagnostics endpoint.
- Desktop and mobile Assistant citation panels now show compact source
  inspection chips for source kind, retrieval modes, heading path, scores,
  rerank mode, and chunk type. This makes normal chat answers debuggable without
  opening the admin-only diagnostics panel.
- Assistant chat history is persisted in `assistant_conversations` and
  `assistant_messages`. Personal and group conversations are separate, and
  saved history is used for UI restoration rather than prompt context.
- Assistant now runs through an observable Smart Agent layer. The backend
  planner classifies intent and retrieval tools, records `assistant_runs` and
  `assistant_run_steps`, retries retrieval with planner rewrite queries, builds
  an evidence notebook, verifies answer citations after generation, and returns
  compatible `agent` metadata from chat, stream, and retrieval diagnostics.
- Assistant messages include `agent_json` so restored history can show run and
  verification summaries. Explicit user memory is stored in
  `assistant_memories` only when the user asks LinkBox to remember a preference
  or stable context; it is loaded as low-priority prompt context and kept
  separate between personal and group scopes.
- Structured item understanding is stored in `item_entities`, `item_topics`,
  `item_todos`, and `item_claims`. `indexDocumentForItem` refreshes these rows,
  and Assistant retrieval uses them as an explainable fallback before whole-row
  legacy fallback.
- Historical structured understanding can be backfilled from the admin system
  maintenance panel. `item_understanding_runs` records processed
  content-bearing items, `GET /api/settings/system` reports coverage, and
  `POST /api/settings/system/backfill-understanding` performs bounded
  idempotent backfills.
- Assistant explicit memories can be reviewed and deleted from the desktop
  Assistant page memory panel. The backing `GET /api/assistant/memories` and
  `DELETE /api/assistant/memories/:id` endpoints preserve personal/group scope
  isolation.
- Mobile Assistant now preserves saved `agent` metadata, handles streaming
  `agent` events, and shows compact diagnostic chips for intent, tools,
  retrieval attempts, evidence, verification, and memory.
- Assistant quality has a fixed backend fixture suite at
  `server/test/assistantQuality.test.mjs`, covering canonical document hits,
  structured todo fallback, memory loading, and no-evidence insufficient
  support without depending on real LLM text.
- LLM-assisted higher-level understanding has an opt-in prototype boundary in
  `server/utils/llmUnderstandingAnnotations.js`. It builds a strict JSON prompt
  for questions, contradictions, timelines, and project summaries, validates
  the JSON, and stores generated output in `document_annotations` as
  `llm_understanding` with model, prompt version, and source hash.
- Desktop item cards use a reusable processing banner derived from the shared
  `processing` contract. Mobile home/day views use the same processing labels
  last-error text, and recovery hints through `mobileProcessingStatus`.
- Create and update item write paths return the same item presentation contract
  used by list/detail responses, including tags and processing metadata.
- The auth, tags, admin, and Assistant JSON endpoints now use the shared route
  JSON error helper for expected validation/not-found/conflict/permission,
  credential, and retrieval-access failures while preserving response messages.
- Jobs and canonical document tables are created through explicit migrations
  recorded in `schema_migrations`.
- Direct messages and social collaboration tables are created through
  migrations `007_direct_messages_schema` and
  `010_social_collaboration_schema`; `server/db.js` no longer duplicates those
  feature table definitions at startup.
- Base tables and legacy compatibility tables are also created through
  migrations `000_base_schema` and `011_settings_and_legacy_chunks_schema`.
  `server/db.js` now only opens SQLite, applies pragmas, creates required data
  directories, and runs `runMigrations(db)`.
- Smart Agent observability, message metadata, item understanding, and memory
  are created through migrations `012_assistant_runs_schema`,
  `013_assistant_message_agent_metadata`, `014_item_understanding_schema`, and
  `015_assistant_memory_schema`.
- Legacy `link_chunks` fallback can be disabled with
  `ASSISTANT_ENABLE_LEGACY_FALLBACK=0` while canonical `document_chunks`
  retrieval remains active.
- `item_content` is now created by migration `005_item_content_schema` and
  backfilled from legacy `links.content`, `links.content_md`, `links.summary`,
  and `links.html_note` rows that contain content.
- `item_assets` is now created by migration `006_item_assets_schema` and
  backfilled from owned legacy `/uploads/...` paths in `links.image_path` and
  `links.thumbnail`; remote thumbnails remain link metadata.
- `server/utils/itemContentStore.js` now exposes read helpers that prefer
  `item_content` and fall back to legacy `links` content columns. Item detail
  reads use those helpers while list reads keep the existing paginated shape.
- Create, extraction, summary, and learning-note write paths now dual-write
  canonical content into `item_content` while preserving legacy `links`
  compatibility columns.
- Create and extraction write paths now dual-write owned `/uploads/...` assets
  into `item_assets`; remote thumbnails remain link metadata only.
- Admin system status now includes a storage consistency report for missing
  canonical documents, missing `item_content` rows, and missing `item_assets`
  rows. The settings page surfaces counts and bounded samples before legacy
  storage paths are retired.
- The settings route now uses the shared route JSON error helper for expected
  admin permission and validation failures while preserving existing response
  messages and `ok: false` test-endpoint shapes.
- Link auto-processing is now an explicit allowlist. WeChat articles, Zhihu
  articles, and Bilibili videos can be auto-processed from shared text; generic
  URLs inside mixed text are saved as text notes instead of being fetched.
- Bilibili video rows are classified as `video`, fetch metadata/cover, prefer
  public subtitles, fall back to `yt-dlp` + `ffmpeg` + `WHISPER_SERVER_URL`
  audio transcription, run LLM punctuation restoration, persist the video
  transcript in `content_md`, generate summaries, and index the canonical
  document.
- Server, desktop, and mobile code now use normalized item kinds for user-facing
  categories: `article`, `video`, `document`, `link`, `image`, `audio`, and
  `text`. Backend list queries, admin user stats, Assistant scope filters,
  document chunk retrieval, and embedding retrieval share the same semantics.
- Desktop add tabs, filters, cards, and processing labels include video-specific
  presentation. Mobile cards, category pages, detail pages, search, and
  organizer hints use the same normalized kinds.
- Mobile detail pages expose video transcript/original content, allow long
  content sections to scroll inside fixed panels, preserve list scroll position
  when navigating back from detail, and scroll to newest content after page
  refresh.
- Social collaboration is available through `server/routes/social.js`,
  including friend requests, direct chats, group chats, group materials,
  chat-scoped uploads, material comments, and message deletion rules.
- Shared social collaboration reads and payload shaping live in
  `server/utils/socialService.js`, including accepted-friend checks,
  group-membership checks, timestamp normalization, message payloads, and
  material payloads.
- Group Assistant retrieval is isolated from personal Assistant retrieval.
  Group mode reads only the active group's shared materials, chat-scoped group
  uploads, group material notes, material comments, and group text messages.
- Mobile Friends/Groups UI is centered in `mobile/src/views/Friends.vue`.
  Contacts open direct chats, the top-right `+` owns friend/group creation,
  the chat bottom-left `+` only uploads files or sends existing materials, and
  group tools live in the top-right chat menu.
- Mobile and desktop long-text inputs use auto-growing textareas. Mobile uses
  `mobile/src/components/AutoGrowTextarea.vue`; desktop uses
  `client/src/components/AutoGrowTextarea.tsx`. Short inputs remain single-line.
- Mobile multi-image uploads are grouped as stacked cards. Home-feed batch
  comments update all images in the batch; detail carousel comments remain
  per-image.

## Recommended Runtime

Use Node.js 22 LTS for server work.

The project currently depends on `better-sqlite3@11.10.0`. Newer non-LTS Node
versions can fail because native module ABI support may lag behind Node
releases. If the system Node is newer than 22, run server tests through a Node 22
shim:

```bash
cd server
npm.cmd exec --yes --package node@22 -- node --test
```

On Windows PowerShell, prefer `npm.cmd` if script execution policy blocks
`npm.ps1`.

## Repository Map

```text
client/                 Desktop React app
mobile/                 Mobile web app
server/                 Express API and static frontend host
server/routes/          Thin route registration layer
server/utils/           Current domain/service modules
docs/                   Architecture, deployment, and development docs
```

Important backend modules:

```text
server/routes/links.js              Wires HTTP routes to the item controller
server/routes/assistant.js          Assistant HTTP/SSE adapter
server/routes/social.js             Friends, direct chats, groups, and group materials
server/utils/socialService.js       Social membership/friendship and payload helpers
server/utils/itemController.js      Item HTTP handlers
server/utils/itemRepository.js      Item lookup/list ownership helpers
server/utils/itemProcessingStatus.js Derived processing contract
server/utils/itemPresentation.js Shared item display contract
server/utils/itemKind.js          Source classification and normalized item kind helpers
server/utils/itemMaterial.js      Unified content, summary, cover, and asset reads
server/utils/itemEnrichmentPlan.js Type-aware background processing plan
server/utils/linkAutoProcess.js   Allowlisted shared-text URL extraction
server/utils/bilibiliVideoSource.js Bilibili URL parsing and metadata/subtitle source helpers
server/utils/videoTranscriptExtractor.js Bilibili subtitle/audio transcription pipeline
server/utils/uploadMiddleware.js    Multer upload setup and file filters
server/utils/uploadedAsset.js       Upload-derived asset normalization
server/utils/assistantSourceRetrieval.js Assistant retrieval interface
server/utils/assistantTurn.js       Assistant prompt/source/citation assembly
server/utils/assistantRetrieval.js  Personal and group Assistant source retrieval
server/utils/assistantAgent.js      Smart Agent planning, retrieval, evidence, and verification orchestration
server/utils/assistantMemory.js     Explicit personal/group Assistant memory
server/utils/assistantConversations.js Assistant conversation persistence
server/utils/itemUnderstanding.js   Deterministic entities, topics, todos, and claims
server/utils/documentMaintenance.js Admin document, embedding, and understanding maintenance
server/utils/llmUnderstandingAnnotations.js Opt-in rich understanding annotations
server/utils/itemIntake.js          Item acceptance, import, retry, and reschedule
server/utils/extractedContentPersistence.js Extraction post-processing path
server/utils/imageProxyService.js   Proxied image fetching and headers
server/utils/jobQueue.js            SQLite durable job queue
server/utils/systemHealth.js        Admin operational health checks
server/utils/appError.js            Shared route JSON error shaping
server/utils/dbMigrations.js        Explicit SQLite migration runner
server/utils/embeddingConfig.js     Document embedding provider/model settings
```

Important desktop frontend modules:

```text
client/src/pages/LinksPage.tsx          Links page UI composition
client/src/pages/useLinksData.ts        Query, polling, and local merge state
client/src/pages/useLinkActions.ts      Add/update/delete/retry actions
client/src/pages/useLinkExports.ts      JSON and Markdown export actions
client/src/pages/linksPageUtils.ts      Small pure helpers
client/src/context/ToastContext.tsx     Global toast provider
client/src/components/LinkCard.tsx      Item card composition
client/src/components/itemDisplay.ts    Desktop normalized item labels/icons
client/src/components/sourceKind.ts     Desktop allowlisted URL classification
client/src/components/ProcessingBanner.tsx Shared processing/failure banner
client/src/components/processingStatus.ts Processing display derivation helper
client/src/components/markdownParser.ts Markdown block/inline parser and sanitizer
client/src/components/MarkdownRenderer.tsx React adapter for parsed Markdown
client/src/components/AutoGrowTextarea.tsx Auto-growing long text input
client/src/pages/SocialPage.tsx        Desktop friends/groups page
client/src/pages/EmbeddingSettingsPanel.tsx Admin embedding configuration
client/src/pages/RetrievalDiagnosticsPanel.tsx Admin retrieval diagnostics
client/src/pages/BackgroundJobsPanel.tsx Admin queue and failed-job controls
```

Important mobile frontend modules:

```text
mobile/src/components/ChatBox.vue       Assistant chat flow adapter
mobile/src/components/AssistantAgentStatus.vue Compact Agent diagnostic chips
mobile/src/components/AssistantSourceList.vue Assistant citation/source panel
mobile/src/components/AutoGrowTextarea.vue Auto-growing long text input
mobile/src/components/ImageBatchCard.vue Mobile stacked image batch card
mobile/src/utils/markdownParser.js      Mobile Markdown/citation utility
mobile/src/utils/assistantDiagnostics.js Mobile Assistant diagnostic row formatting
mobile/src/utils/imageBatchGallery.js   Image batch grouping and gallery view models
mobile/src/utils/groupChatDisplay.js    Current-user message alignment helpers
mobile/src/utils/socialConversations.js Friends/groups conversation list helpers
mobile/src/utils/mobileOrganizer.js     Tested local organization helpers
mobile/src/utils/mobileItemDisplay.js   Mobile normalized item presentation
mobile/src/utils/mobileCategoryDisplay.js Mobile category labels/icons
mobile/src/utils/linkAutoProcess.js     Mobile shared-text allowlist extraction
mobile/src/utils/mobileProcessingStatus.js Mobile processing display helper
```

## Processing Status Contract

Clients should prefer `item.processing` over directly interpreting
`links.status`.

Example:

```json
{
  "status": "processing",
  "processing": {
    "state": "running",
    "stage": "file.extractMarkdown",
    "label": "Extracting file content",
    "canRetry": false,
    "failedJobId": null,
    "lastError": "",
    "updatedAt": "2026-06-10T00:00:00.000Z"
  }
}
```

Current states used by the desktop client:

| State | Meaning | User Action |
|-------|---------|-------------|
| `idle` | No active or failed job is attached | None |
| `queued` | A durable job is waiting to run | Wait |
| `running` / `processing` | A durable job is active | Wait |
| `failed` | A durable job failed | Retry when `canRetry` is true |

## Validation Commands

Run these before handing off broad architecture changes:

```bash
# Desktop tests and production build
cd client
npm test
npm run build

# Mobile focused utility tests and production build
cd ../mobile
npm run build

cd ..
node --test \
  mobile/src/utils/markdownParser.test.mjs \
  mobile/src/utils/mobileOrganizer.test.mjs \
  mobile/src/utils/imageBatchGallery.test.mjs \
  mobile/src/utils/groupChatDisplay.test.mjs \
  mobile/src/utils/socialConversations.test.mjs

# Server tests
cd server
npm test
npm run test:e2e

# Whitespace check
cd ..
git diff --check
```

Focused checks for the current social/mobile checkpoint:

```bash
node --test \
  server/test/socialGroup.test.mjs \
  server/test/assistantConversations.test.mjs \
  server/test/socialDirectMessages.test.mjs \
  server/test/assistantTurn.test.mjs

cd mobile
npm run build

cd ../client
npm run build
```

Expected counts at the 2026-06-24 social/mobile checkpoint:

- Server: run `npm test` for the current authoritative count.
- Desktop client: run `npm test` for the current authoritative count.
- Mobile utility focused tests: include `mobileProcessingStatus.test.mjs`,
  `imageBatchGallery.test.mjs`, `groupChatDisplay.test.mjs`, and
  `socialConversations.test.mjs`.
- Social backend focused tests: `socialGroup.test.mjs`,
  `socialDirectMessages.test.mjs`, `assistantConversations.test.mjs`, and
  `assistantTurn.test.mjs`.
- Server E2E smoke: `npm run test:e2e` passes with an isolated temporary
  database, uploads directory, and mock OpenAI-compatible endpoint.
- Desktop browser E2E: `cd client && npm run test:e2e` passes with isolated
  Playwright services.
- Focused desktop browser E2E for the latest slice:
  `cd client && npx playwright test e2e/assistant.spec.ts e2e/background-jobs.spec.ts --project=chromium`
  passes with 3 tests.

Known warning: direct Node execution of mobile ES modules reports
`MODULE_TYPELESS_PACKAGE_JSON` because `mobile/package.json` does not declare
`"type": "module"`. The warning is non-fatal; the mobile production build
passes.

## Browser E2E Tests

Install dependencies and the Chromium browser bundle:

```bash
cd client
npm install
npx playwright install chromium
```

The Chromium install is required on a fresh machine or after a Playwright
browser version update. If every browser E2E fails before page navigation with
`Executable doesn't exist` under `~/Library/Caches/ms-playwright`, rerun the
same install command and then rerun the suite.

Run the browser suite:

```bash
cd client
npm run test:e2e
```

At the 2026-06-25 checkpoint the full suite passes:

```text
13 passed
```

The Playwright config starts four isolated local services:

- mock OpenAI-compatible endpoint on `127.0.0.1:3320`
- backend API on `127.0.0.1:3310` with a temporary SQLite database and uploads directory
- Vite desktop app on `127.0.0.1:5174` with `/api` proxied to the test backend
- Vite mobile app on `127.0.0.1:5175/mobile/` with `/api` proxied to the test backend

The backend wrapper seeds a fixed admin user for admin-only tests, writes AI
settings to the mock endpoint, and seeds a failed background job for retry UI
coverage. Browser tests should keep test-only logic in `client/e2e`,
`client/playwright.config.ts`, or `server/scripts/playwright-*`; production
routes should not gain test-only endpoints.

Mobile image-batch E2E tests should follow the current feed interaction model:
the batch card is only the stacked gallery, and comment/delete actions are
opened from the row-level three-dot menu. Do not reintroduce an inline
`.batch-delete` button just to satisfy older tests.

## Isolated Smoke Test

Do not casually start the default server when testing architecture changes. The
server starts the durable queue and can recover or mutate jobs in the default
database.

Use a temporary database and uploads directory:

```powershell
$run = "C:\tmp\linkbox-smoke\$(Get-Date -Format yyyyMMdd-HHmmss)"
New-Item -ItemType Directory -Force -Path $run | Out-Null
New-Item -ItemType Directory -Force -Path "$run\uploads" | Out-Null

$env:PORT = "3199"
$env:DATA_DIR = $run
$env:DB_PATH = "$run\linkbox.db"
$env:UPLOADS_DIR = "$run\uploads"
$env:JWT_SECRET = "linkbox-smoke-secret"

cd C:\Users\100448405\LinkBox\server
npm.cmd exec --yes --package node@22 -- node index.js
```

Core smoke paths:

- Register a user through `POST /api/auth/register`.
- Create a tag through `POST /api/tags`.
- Create a text item through `POST /api/links/text`.
- Create a link item through `POST /api/links`.
- List items through `GET /api/links`.
- Update an item through `PUT /api/links/:id`.
- Export JSON through `GET /api/links/export/all`.
- Export Markdown summaries through `GET /api/links/export/summaries`.
- Delete an item through `DELETE /api/links/:id`.

Stop the smoke server after testing and verify the test port no longer responds.

## Documentation Links

- [roadmap.md](./roadmap.md): current planning status, active architecture
  debt, decisions needed, and broad validation gates.
- [validation.md](./validation.md): verification matrix by change type.
- [../CONTEXT.md](../CONTEXT.md): project vocabulary and architectural terms.
- [architecture-redesign.md](./architecture-redesign.md): target architecture,
  phases, success criteria, and historical architecture background.
- [deployment.md](./deployment.md): current home-server update commands,
  rollback steps, and verification checks.
- [social-collaboration.md](./social-collaboration.md): friends, direct chats,
  groups, group materials, and group Assistant scope rules.
- [markdown-knowledge-base-plan.md](./markdown-knowledge-base-plan.md):
  Markdown-first knowledge base redesign background and remaining decisions.
- [item-content-assets-migration-plan.md](./item-content-assets-migration-plan.md):
  staged plan for splitting overloaded `links` rows into item content and asset
  tables, plus legacy `link_chunks` retirement gates.
- [taishanpi-deploy.md](./taishanpi-deploy.md): deployment notes for Taishan Pi.
- [mobile-frontend.md](./mobile-frontend.md): mobile frontend screens, chat
  behavior, image batches, and validation commands.

## Closed 2026-06-17 Follow-Up Items

The previous backlog is closed for this checkpoint:

1. Full desktop browser E2E is the release gate and must be run after broad UI
   changes.
2. Assistant chat source metadata is available to explain retrieval paths in
   the normal chat flow.
3. Desktop processing UI is extracted into `ProcessingBanner`, with mobile
   status text aligned through `mobileProcessingStatus`.
4. Create/update item write paths return presented items with tags and
   processing metadata. Delete remains the existing `{ ok: true }` command
   response.
5. The auth, tags, admin, and Assistant JSON endpoints have been migrated to the
   shared JSON error helper for expected route errors.
6. Jobs and document schema initialization moved into explicit migrations.
7. The future item/content/assets migration plan is documented in
   [item-content-assets-migration-plan.md](./item-content-assets-migration-plan.md).
8. Legacy `link_chunks` fallback is narrowed behind
   `ASSISTANT_ENABLE_LEGACY_FALLBACK=0`; removal is deferred until the canonical
   retrieval gates in the migration plan are met.

## Next Development Plan

Recommended next work after this checkpoint:

1. Use [roadmap.md](./roadmap.md) as the planning entry point before starting a
   new feature slice.
2. Continue route JSON error helper migration opportunistically in larger route
   edits; avoid broad mechanical churn without behavior tests.
3. Decompose the largest mobile views through workflow-specific composables
   before adding more mobile social or Assistant behavior.
