# LinkBox Development Guide

Last updated: 2026-06-21

This is the short current-state guide for continuing LinkBox development. Keep
historical plans in dedicated docs; keep this file focused on architecture,
runtime behavior, verification, and common failure modes.

## Current Architecture

LinkBox is split into three deployable surfaces:

- `client/`: React desktop management app.
- `mobile/`: Vue mobile file assistant.
- `server/`: Express API, SQLite persistence, background jobs, AI processing,
  and static hosting for both frontends.

The database still uses `links` as the compatibility item table. Newer code
normalizes behavior through service modules instead of spreading raw
`links.type` checks through routes and UI.

## Core Backend Boundaries

| Area | Primary modules |
| --- | --- |
| HTTP item routes | `server/utils/itemController.js`, `server/routes/links.js` |
| Mobile item routes | `server/routes/mobileFiles.js`, `server/utils/mobileFilePresenter.js` |
| Intake and scheduling | `server/utils/itemIntake.js`, `server/utils/itemEnrichmentPlan.js` |
| Background queue | `server/utils/jobQueue.js`, `server/utils/enrichmentJobs.js` |
| Type normalization | `server/utils/itemKind.js` |
| Presentation contract | `server/utils/itemPresentation.js`, `server/utils/itemProcessingStatus.js` |
| Content/material reads | `server/utils/itemMaterial.js`, `server/utils/itemContentStore.js`, `server/utils/itemAssetStore.js` |
| Link/article extraction | `server/utils/extractContent.js`, `server/utils/extractors/*` |
| Bilibili video | `server/utils/bilibiliVideoSource.js`, `server/utils/videoTranscriptExtractor.js` |
| Image analysis | `server/utils/imageVisionService.js` |
| Retrieval/indexing | `server/utils/documentIndex.js`, `server/utils/documentEmbeddings.js`, `server/utils/chunkIndex.js` |
| Assistant | `server/utils/assistantRetrieval.js`, `server/utils/assistantTurn.js` |
| Operational health | `server/utils/systemHealth.js`, `server/routes/settings.js` |

Routes should stay thin. New behavior should normally land in `server/utils/*`
with focused tests.

## Item Kinds

Raw database values are normalized before reaching user-facing behavior:

| Normalized kind | Source |
| --- | --- |
| `link` | Generic URL |
| `article` | WeChat and Zhihu articles |
| `video` | Bilibili video URLs |
| `document` | Uploaded files, including historical `file` rows |
| `image` | Uploaded images |
| `audio` | Uploaded audio |
| `text` | Text notes |

Use `itemKindForRow` and `sqlConditionForItemKind` instead of open-coded URL or
type checks. Desktop equivalents live in `client/src/components/itemDisplay.ts`
and mobile equivalents in `mobile/src/utils/mobileItemDisplay.js`.

## Auto-Processing Policy

Only these shared-link sources auto-process without confirmation:

- WeChat articles: `mp.weixin.qq.com`, `weixin.qq.com`
- Zhihu articles: `zhihu.com/p/...`, `zhuanlan.zhihu.com/p/...`
- Bilibili videos: `bilibili.com/video/BV...`, `m.bilibili.com/video/BV...`, `b23.tv/...`

Mixed text that contains a generic URL is saved as a text note. Shared
extraction helpers:

- Server: `server/utils/linkAutoProcess.js`
- Desktop: `client/src/components/sourceKind.ts`
- Mobile: `mobile/src/utils/linkAutoProcess.js`, `mobile/src/utils/sourceKind.js`

## Background Jobs

Jobs are persisted in SQLite and registered in `server/utils/enrichmentJobs.js`.
The queue:

- recovers `running` jobs to `queued` on server start,
- defaults to concurrency `3`,
- has a default per-job timeout of `180000ms`,
- records final failures in `jobs.last_error`,
- updates item processing status through `itemProcessingStatus`.

Important job types:

| Job | Purpose |
| --- | --- |
| `link.fetchMetadata` | Fetch title/description/thumbnail |
| `link.extractMarkdown` | Extract article/page Markdown |
| `link.summarize` | Summarize extracted link content |
| `image.describe` | Generate Chinese image description and index it |
| `file.extractMarkdown` | Convert uploaded file to Markdown |
| `file.summarize` | Summarize converted file content |
| `document.embed` | Refresh document embeddings when enabled |

If uploads appear stuck, inspect `jobs` first. A stale long-running job should
not block image jobs now, but failed jobs should still be retried through admin
settings or the queue helpers.

## AI Content Flow

Content is indexed in two layers:

- Legacy fallback: `link_chunks`, refreshed by `indexLinkContent`.
- Canonical documents: `documents` and `document_chunks`, refreshed by
  `indexDocumentForItem`.

Assistant retrieval prefers canonical document chunks and optional embeddings,
then falls back to legacy chunks if `ASSISTANT_ENABLE_LEGACY_FALLBACK` allows
it.

User comments are first-class content:

- Legacy chunks include `我的留言：...`.
- Canonical Markdown includes `## 我的留言`.
- Mobile comment saves refresh both legacy and canonical indexes.

Image analysis must produce Chinese output. `imageVisionService` uses all-Chinese
prompts and versioned cache keys such as `photo.zh-v2` so older English cached
descriptions are not reused.

## Mobile UX Notes

Current mobile behavior:

- Home refresh scrolls to newest content.
- Returning from detail restores the previous scroll position.
- Detail panels with long content scroll internally.
- Video detail shows the transcript/original text.
- Comments are edited from the home feed by long-pressing a card.
- Existing comments render below the card metadata and follow the item into AI
  retrieval.

Most mobile list logic is in `mobile/src/views/Home.vue`. Shared display helpers
are in `mobile/src/utils/mobileItemDisplay.js` and category helpers in
`mobile/src/utils/mobileCategoryDisplay.js`.

## Runtime Requirements

Use Node.js 20+ for production. Node.js 22 LTS is recommended for local server
tests involving `better-sqlite3`.

Optional system tools unlock specific features:

- `pdftotext`: PDF text extraction.
- `libreoffice`: old Office conversion.
- `ffmpeg`: Bilibili audio fallback.
- `yt-dlp`: Bilibili subtitle/audio extraction.
- Whisper-compatible service: Bilibili audio transcription fallback.

## Verification

Fast focused checks:

```bash
node --test \
  server/test/jobQueue.test.mjs \
  server/test/chunkIndex.test.mjs \
  server/test/documentIndex.test.mjs \
  server/test/imageVisionService.test.mjs \
  server/test/itemKind.test.mjs \
  server/test/bilibiliVideoSource.test.mjs \
  server/test/videoTranscriptExtractor.test.mjs

cd mobile
node --test src/utils/linkAutoProcess.test.mjs src/utils/mobileItemDisplay.test.mjs src/utils/mobileCategoryDisplay.test.mjs src/utils/mobileOrganizer.test.mjs
npm run build

cd ../client
npm test
npm run build

cd ..
git diff --check
```

Broader checks:

```bash
cd server
npm test
npm run test:e2e

cd ../client
npm run test:e2e
npm run test:e2e:canonical
```

Known local limitation: `server/test/mobileFilesRoute.test.mjs` starts an HTTP
listener and may fail with `listen EPERM` in restricted sandboxes. That failure
is environmental; run it in a normal local shell or CI when route-level coverage
is required.

Known warning: direct Node execution of mobile ES modules reports
`MODULE_TYPELESS_PACKAGE_JSON` because `mobile/package.json` does not declare
`"type": "module"`. The warning is non-fatal; Vite production builds pass.

## Deployment Notes

Docker is the normal deployment path:

```bash
docker compose up -d --build
```

Production data paths in the current compose setup:

- Database: `/data/linkbox.db`
- Uploads: `/data/uploads`
- Optional Bilibili cookies: `/data/cookies/bilibili.txt`

Home-server deployment currently keeps a git workspace at
`/home/wq/workspace/LinkBox` and a runtime compose directory at
`/home/wq/LinkBox`. Sync source from the workspace to the runtime directory
before rebuilding.

Post-deploy smoke:

```bash
curl -s -o /tmp/linkbox-root.html -w "root:%{http_code}\n" http://127.0.0.1:3100/
curl -s -o /tmp/linkbox-mobile.html -w "mobile:%{http_code}\n" http://127.0.0.1:3100/mobile/
```

## Related Docs

- [bilibili-video-processing.md](./bilibili-video-processing.md)
- [deployment.md](./deployment.md)
- [architecture-redesign.md](./architecture-redesign.md)
- [markdown-knowledge-base-plan.md](./markdown-knowledge-base-plan.md)
- [item-content-assets-migration-plan.md](./item-content-assets-migration-plan.md)
- [mobile-frontend.md](./mobile-frontend.md)
