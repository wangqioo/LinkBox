# Failed Job Admin Controls Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Expose failed background jobs in admin settings and allow retrying one failed job without retrying every failed job.

**Architecture:** Keep the existing jobs table and runtime queue. Extend the settings system response with a bounded failed job list, then let the existing retry endpoint accept optional job IDs.

**Tech Stack:** Express, better-sqlite3, React, TypeScript, Vite, Node test runner.

**Status 2026-06-25:** Completed. Backend failed-job summaries, selected retry,
frontend per-job controls, and verification coverage are present.

---

### Task 1: Backend Failed Job API

**Files:**
- Modify: `server/routes/settings.js`
- Test: `server/test/settingsSystem.test.mjs`

- [x] Add a failing server test that seeds two failed jobs, calls the settings system handler or route, and expects a bounded `queue.failedJobs` array with `id`, `type`, `link_id`, `attempts`, `max_attempts`, `last_error`, and `updated_at`.
- [x] Add a failing server test that posts `{ ids: [failedJobId] }` to retry failed jobs and expects only that job to move to `queued`.
- [x] Implement a local `listFailedJobs(limit = 20)` helper in `server/routes/settings.js`.
- [x] Include `failedJobs` inside the `queue` object returned by `GET /api/settings/system`.
- [x] Parse optional `ids` in `POST /api/settings/system/retry-failed-jobs` and pass `{ ids }` to `getRuntimeQueue().retryFailedJobs`.

### Task 2: Frontend Failed Job Controls

**Files:**
- Modify: `client/src/api/client.ts`
- Modify: `client/src/pages/SettingsPage.tsx`
- Modify: `client/src/pages/BackgroundJobsPanel.tsx`

- [x] Add TypeScript interfaces for failed job summaries and allow `retryFailedJobs(ids?: number[])`.
- [x] Add a failing focused test if an existing lightweight client test pattern is available; otherwise rely on TypeScript build.
- [x] Add per-job retry state in `SettingsPage`.
- [x] Pass an `onRetryFailedJob(id)` callback to `BackgroundJobsPanel`.
- [x] Render a compact failed-job list in `BackgroundJobsPanel`, with one retry button per failed job and the existing global retry button retained.

### Task 3: Verification

**Files:**
- Existing test/build commands only.

- [x] Run `cd server && npm test`.
- [x] Run `cd client && npm test`.
- [x] Run `cd client && npm run build`.
- [x] Run `git diff --check`.
