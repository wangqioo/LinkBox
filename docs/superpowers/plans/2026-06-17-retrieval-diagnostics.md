# Retrieval Diagnostics Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a diagnostic path that shows why the assistant retrieved specific sources without calling the LLM.

**Architecture:** Reuse the assistant retrieval pipeline and expose a compact diagnostics contract with source kind, retrieval modes, scores, heading paths, and chunk snippets. Add a small frontend panel that runs diagnostics for a typed query.

**Tech Stack:** Express, better-sqlite3, React, TypeScript, Vite, Node test runner.

**Status 2026-06-25:** Completed. Backend diagnostics, the authenticated
endpoint, API types, settings-page UI, and verification coverage are present.

---

### Task 1: Backend Diagnostics Contract

**Files:**
- Modify: `server/utils/assistantSourceRetrieval.js`
- Modify: `server/routes/assistant.js`
- Test: `server/test/assistantSourceRetrieval.test.mjs`

- [x] Add tests for a diagnostics builder that preserves `sourceKind`, `source_index`, `score`, `combined_score`, `embedding_score`, `retrieval_modes`, `rerank_mode`, `rerank_score`, `document_id`, `chunk_id`, `heading_path`, and `chunk_type`.
- [x] Add `buildRetrievalDiagnostics({ question, task, scope, sources, settings })`.
- [x] Add `POST /api/assistant/retrieval-diagnostics` behind existing auth.
- [x] Make the endpoint use saved embedding config and `retrieveAssistantSourcesAsync`.
- [x] Return `{ query, task, scope, settings, sources }` and no LLM answer.

### Task 2: Frontend Diagnostics Panel

**Files:**
- Modify: `client/src/api/client.ts`
- Create: `client/src/pages/RetrievalDiagnosticsPanel.tsx`
- Modify: `client/src/pages/SettingsPage.tsx`

- [x] Add TypeScript types for retrieval diagnostics.
- [x] Add `api.getRetrievalDiagnostics({ question, task, scope })`.
- [x] Create a compact settings-page panel with a query input, task selector, run button, and source/chunk rows.
- [x] Show retrieval mode, source kind, score, heading path, and chunk snippet.
- [x] Keep UI read-only and admin settings-only for this slice.

### Task 3: Verification

- [x] Run `cd server && npm test`.
- [x] Run `cd client && npm test`.
- [x] Run `cd client && npm run build`.
- [x] Run `git diff --check`.
