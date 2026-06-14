# LinkBox Development Guide

Last updated: 2026-06-15

This document records the current development state so future work can resume
without rediscovering the architecture, commands, and validation steps.

## Current Checkpoint

The previous committed checkpoint was:

```bash
b890d85 Refactor LinkBox item architecture and feedback
```

The current working tree has advanced through a 2026-06-15 architecture
deepening pass. It is ready for review/commit after the user decides how to
integrate it.

At the previous committed checkpoint:

- The backend item route has been split into controller, repository, upload,
  image proxy, and processing status helpers.
- Item list/detail responses expose a derived `processing` object based on the
  durable jobs table.
- Failed per-item background jobs can be retried from the item card.
- Desktop link page state has been moved into focused hooks:
  `useLinksData`, `useLinkActions`, and `useLinkExports`.
- A global toast provider is available in the desktop client for user feedback.
- Backend tests, desktop build, mobile build, and an isolated HTTP smoke test
  have passed.

The 2026-06-15 pass adds:

- `server/routes/assistant.js` is now a thin HTTP/SSE adapter. Source grouping,
  public source shaping, prompt construction, context trimming, task
  normalization, and citation cleanup live in `server/utils/assistantTurn.js`.
- Desktop and mobile upload flows now share `server/utils/uploadedAsset.js` for
  decoded names, public/disk paths, size metadata, upload type classification,
  extraction support, HTML detection, and processing payloads.
- The desktop Markdown renderer delegates inline parsing, citation
  normalization, and table HTML sanitization to `client/src/components/markdownParser.ts`.
- Mobile assistant chat now reuses a small Markdown/citation utility at
  `mobile/src/utils/markdownParser.js`, with tests covering unsafe HTML,
  citation normalization, image proxying, and table sanitization.

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
server/utils/uploadMiddleware.js    Multer upload setup and file filters
server/utils/uploadedAsset.js       Upload-derived asset normalization
server/utils/assistantTurn.js       Assistant prompt/source/citation assembly
server/utils/imageProxyService.js   Proxied image fetching and headers
server/utils/jobQueue.js            SQLite durable job queue
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

# Whitespace check
cd ..
git diff --check
```

Expected counts at the 2026-06-15 checkpoint:

- Server: 123 passing tests.
- Desktop client: 4 passing tests.
- Mobile utility focused tests: 4 passing tests.

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

Recommended next work after the pause:

1. Deepen item intake and durable jobs. Move accept/retry/job-catalog behavior
   behind one module so desktop routes, mobile routes, admin retries, and
   processing status updates stop sharing raw queue details.
2. Collapse retrieval around canonical documents. Keep legacy `link_chunks`
   only as an adapter or retire it after canonical document coverage is
   reliable; move shared scoring/tokenization away from legacy chunk indexing.
3. Unify item presentation across desktop and mobile. Prepare one item display
   model for type labels, processing states, retry affordances, and action
   capability.
4. Unify extraction and post-extraction side effects. Make manual extract and
   background extract share one `extract -> persist -> index -> summarize`
   path where possible.
5. Add Playwright E2E coverage for login, add item, processing state, retry,
   export, and delete.
6. Apply the same toast and processing-status contract to settings, assistant,
   background jobs, and tag management.
7. Extract reusable processing banner components for desktop and mobile.
8. Add explicit database migrations instead of boot-time `ALTER TABLE` blocks.
9. Introduce a small application error helper for consistent route error
   handling.
10. Add operational health checks for SQLite, uploads, AI endpoint, queue state,
   `pdftotext`, and LibreOffice.
11. Configure Git author identity so future commits do not use the fallback
   `unknown <100448405@huaqin.com>` committer name.
