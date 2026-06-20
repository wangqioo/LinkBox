# Bilibili Video Processing

Last updated: 2026-06-21

This document describes the LinkBox Bilibili video flow and the related type
normalization work.

## Auto-Process Policy

LinkBox only auto-processes links from an explicit allowlist:

- WeChat articles: `mp.weixin.qq.com`, `weixin.qq.com`
- Zhihu articles: `zhihu.com/p/...`, `zhuanlan.zhihu.com/p/...`
- Bilibili videos: `bilibili.com/video/BV...`, `m.bilibili.com/video/BV...`, `b23.tv/...`

Share text can contain a title before the URL. The extractor finds one allowed
URL and ignores generic URLs. If a generic URL appears in a mixed text message,
LinkBox stores it as a text note instead of auto-processing it.

Shared modules:

- Server: `server/utils/linkAutoProcess.js`, `server/utils/itemKind.js`
- Desktop: `client/src/components/sourceKind.ts`
- Mobile: `mobile/src/utils/sourceKind.js`, `mobile/src/utils/linkAutoProcess.js`

## Processing Flow

For Bilibili video items, the pipeline is:

```text
accept link
  -> classify as video through itemKindForRow
  -> fetch Bilibili metadata and cover
  -> prefer public subtitles
  -> fallback to yt-dlp + ffmpeg audio extraction
  -> call WHISPER_SERVER_URL for transcription
  -> ask the configured LLM to restore Chinese punctuation
  -> persist markdown transcript in content_md
  -> generate summary
  -> index canonical document chunks and optional embeddings
```

Important modules:

- `server/utils/bilibiliVideoSource.js`
- `server/utils/extractors/bilibiliExtractor.js`
- `server/utils/videoTranscriptExtractor.js`
- `server/utils/itemEnrichmentPlan.js`
- `server/utils/extractedContentPersistence.js`

## Runtime Dependencies

Bilibili audio fallback requires:

- `yt-dlp`
- `ffmpeg`
- `WHISPER_SERVER_URL`

Optional cookies can be mounted through:

```text
BILIBILI_COOKIE_FILE=/data/cookies/bilibili.txt
```

If public subtitles are available, Whisper is not required for that video.

## Type Normalization

Historical database rows are still stored as raw `links.type` values, such as
`link` and `file`. User-facing code uses normalized item kinds:

| Normalized kind | Source |
| --- | --- |
| `video` | Bilibili video URLs |
| `article` | WeChat and Zhihu article URLs |
| `document` | Uploaded files, historically stored as `file` |
| `link` | Generic links |

The normalized kind is used consistently in:

- Desktop list cards, filters, add tabs, and admin user statistics
- Mobile cards, detail pages, category pages, search, and organizer hints
- Backend list/search queries
- Assistant retrieval scope filters
- Canonical document and embedding retrieval filters

Core modules:

- Server: `server/utils/itemKind.js`, `server/utils/itemPresentation.js`
- Desktop: `client/src/components/itemDisplay.ts`
- Mobile: `mobile/src/utils/mobileItemDisplay.js`, `mobile/src/utils/mobileCategoryDisplay.js`

## Verification

Useful targeted checks:

```bash
node --test \
  server/test/itemKind.test.mjs \
  server/test/bilibiliVideoSource.test.mjs \
  server/test/videoTranscriptExtractor.test.mjs \
  server/test/mobileFilesQuery.test.mjs \
  server/test/assistantRetrieval.test.mjs \
  server/test/adminUserStats.test.mjs

cd client && npm test && npm run build

cd mobile && \
  node --test src/utils/linkAutoProcess.test.mjs src/utils/mobileCategoryDisplay.test.mjs && \
  npm run build
```

Deployment smoke used for the Docker host:

```bash
curl -s -o /tmp/linkbox-root.html -w "root:%{http_code}\n" http://127.0.0.1:3100/
curl -s -o /tmp/linkbox-mobile.html -w "mobile:%{http_code}\n" http://127.0.0.1:3100/mobile/
```
