# Embedding Settings Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make document embedding configuration manageable from admin settings while keeping indexing and retrieval on the same provider/model.

**Architecture:** Add a separate embedding configuration contract from chat AI settings. Use the saved config for embedding backfill jobs and embedding retrieval, including async remote query embeddings for OpenAI-compatible providers.

**Tech Stack:** Express, better-sqlite3, React, TypeScript, Vite, Node test runner.

**Status 2026-06-25:** Completed. Embedding configuration, provider-consistent
indexing and retrieval, admin UI, and verification coverage are present.

---

### Task 1: Embedding Config API

**Files:**
- Create: `server/utils/embeddingConfig.js`
- Modify: `server/routes/settings.js`
- Test: `server/test/embeddingConfig.test.mjs`

- [x] Add tests for default local embedding config, secret sanitization, updates, and reserved generic settings.
- [x] Implement `getEmbeddingConfig({ includeSecret })`, `updateEmbeddingConfig(input)`, and `testEmbeddingConfig(input)`.
- [x] Store settings under `embedding:enabled`, `embedding:provider`, `embedding:base_url`, `embedding:model`, `embedding:api_key`.
- [x] Add admin routes `GET /api/settings/embeddings`, `PUT /api/settings/embeddings`, `POST /api/settings/embeddings/test`.
- [x] Update generic settings reservation so `embedding:*` cannot be written through `PUT /api/settings`.

### Task 2: Provider-Consistent Indexing And Retrieval

**Files:**
- Modify: `server/utils/documentEmbeddings.js`
- Modify: `server/utils/documentMaintenance.js`
- Modify: `server/utils/enrichmentJobs.js`
- Modify: `server/utils/assistantRetrieval.js`
- Test: `server/test/documentIndex.test.mjs`
- Test: `server/test/documentMaintenance.test.mjs`
- Test: `server/test/assistantRetrieval.test.mjs`

- [x] Add an async embedded search path that uses the same remote embedder/config to embed the query.
- [x] Keep sync `searchEmbeddedDocumentChunks` local-compatible.
- [x] Add `retrieveSourcesAsync` for remote embedding retrieval and keep existing `retrieveSources` for sync callers.
- [x] Make document maintenance stats and backfill provider/model-aware.
- [x] Make `document.embed` jobs use saved embedding config.
- [x] Add tests proving remote query vectors are used when provider is OpenAI-compatible.

### Task 3: Frontend Embedding Settings

**Files:**
- Modify: `client/src/api/client.ts`
- Modify: `client/src/pages/settingsConfig.ts`
- Create: `client/src/pages/EmbeddingSettingsPanel.tsx`
- Modify: `client/src/pages/SettingsPage.tsx`
- Modify: `client/src/pages/DocumentMaintenancePanel.tsx`

- [x] Add `EmbeddingConfig` API types and settings endpoints.
- [x] Add a separate panel for enabled/provider/base URL/model/API key/test connection.
- [x] Load/save embedding config independently from chat AI config.
- [x] Show configured provider/model in document maintenance.
- [x] Run client tests and build.

### Task 4: Verification

- [x] Run `cd server && npm test`.
- [x] Run `cd client && npm test`.
- [x] Run `cd client && npm run build`.
- [x] Run `git diff --check`.
