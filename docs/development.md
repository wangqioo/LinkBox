# LinkBox Development Guide

Last updated: 2026-06-15

This document records the current development state so future work can resume
without rediscovering the architecture, commands, and validation steps.

## Current Checkpoint

The current architecture follow-up checkpoint is:

```bash
HEAD Add shared app error helper
```

This includes the earlier 2026-06-15 item intake pass and the follow-up
architecture slices for assistant retrieval, item presentation, and extracted
content persistence, isolated server smoke coverage, admin health checks, and
shared route JSON error shaping.

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
server/utils/itemController.js      Item HTTP handlers
server/utils/itemRepository.js      Item lookup/list ownership helpers
server/utils/itemProcessingStatus.js Derived processing contract
server/utils/itemPresentation.js Shared item display contract
server/utils/uploadMiddleware.js    Multer upload setup and file filters
server/utils/uploadedAsset.js       Upload-derived asset normalization
server/utils/assistantSourceRetrieval.js Assistant retrieval interface
server/utils/assistantTurn.js       Assistant prompt/source/citation assembly
server/utils/itemIntake.js          Item acceptance, import, retry, and reschedule
server/utils/extractedContentPersistence.js Extraction post-processing path
server/utils/imageProxyService.js   Proxied image fetching and headers
server/utils/jobQueue.js            SQLite durable job queue
server/utils/systemHealth.js        Admin operational health checks
server/utils/appError.js            Shared route JSON error shaping
```

Important desktop frontend modules:

```text
client/src/pages/LinksPage.tsx          Links page UI composition
client/src/pages/useLinksData.ts        Query, polling, and local merge state
client/src/pages/useLinkActions.ts      Add/update/delete/retry actions
client/src/pages/useLinkExports.ts      JSON and Markdown export actions
client/src/pages/linksPageUtils.ts      Small pure helpers
client/src/context/ToastContext.tsx     Global toast provider
client/src/components/LinkCard.tsx      Item card and processing UI
client/src/components/markdownParser.ts Markdown block/inline parser and sanitizer
client/src/components/MarkdownRenderer.tsx React adapter for parsed Markdown
```

Important mobile frontend modules:

```text
mobile/src/components/ChatBox.vue       Assistant chat UI adapter
mobile/src/utils/markdownParser.js      Mobile Markdown/citation utility
mobile/src/utils/mobileOrganizer.js     Tested local organization helpers
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
node --test mobile/src/utils/markdownParser.test.mjs mobile/src/utils/mobileOrganizer.test.mjs

# Server tests
cd server
npm test
npm run test:e2e

# Whitespace check
cd ..
git diff --check
```

Expected counts at the 2026-06-15 architecture follow-up checkpoint:

- Server: 150 passing tests.
- Desktop client: 4 passing tests.
- Mobile utility focused tests: 4 passing tests.
- Server E2E smoke: `npm run test:e2e` passes with an isolated temporary
  database and uploads directory.

Known warning: direct Node execution of mobile ES modules reports
`MODULE_TYPELESS_PACKAGE_JSON` because `mobile/package.json` does not declare
`"type": "module"`. The warning is non-fatal; the mobile production build
passes.

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

- [architecture-redesign.md](./architecture-redesign.md): target architecture,
  phases, and success criteria.
- [deployment.md](./deployment.md): deployment targets, update commands,
  rollback steps, and verification checks for the home server and RK3576.
- [markdown-knowledge-base-plan.md](./markdown-knowledge-base-plan.md):
  Markdown-first knowledge base redesign plan for future AI retrieval work.
- [taishanpi-deploy.md](./taishanpi-deploy.md): deployment notes for Taishan Pi.
- [mobile-frontend.md](./mobile-frontend.md): mobile frontend notes.

## Follow-Up Backlog

Recommended next work after this checkpoint:

1. Add Playwright browser E2E coverage on top of the server-side E2E smoke for
   login, add text/link/file item, processing state, retry, export, and delete.
2. Expand E2E coverage for failed job retry and assistant chat with a mock AI
   endpoint.
3. Add a UI surface for the new admin health checks, including degraded
   capability warnings and failed-job counts.
4. Add explicit database migrations instead of boot-time `ALTER TABLE` blocks.
5. Continue migrating remaining route modules to the shared application error
   helper where it reduces repeated response shaping.
6. Extract reusable processing banner components for desktop and mobile.
7. Move shared scoring/tokenization away from the legacy chunk index before
   retiring `link_chunks`.
8. Write the migration plan for future item/content/assets tables.
