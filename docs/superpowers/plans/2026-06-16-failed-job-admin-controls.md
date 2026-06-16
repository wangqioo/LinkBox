# Failed Job Admin Controls Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Expose failed background jobs in admin settings and allow retrying one failed job without retrying every failed job.

**Architecture:** Keep the existing jobs table and runtime queue. Extend the settings system response with a bounded failed job list, then let the existing retry endpoint accept optional job IDs.

**Tech Stack:** Express, better-sqlite3, React, TypeScript, Vite, Node test runner.

---

### Task 1: Backend Failed Job API

**Files:**
- Modify: `server/routes/settings.js`
- Test: `server/test/settingsSystem.test.mjs`

- [ ] Add a failing server test that seeds two failed jobs, calls the settings system handler or route, and expects a bounded `queue.failedJobs` array with `id`, `type`, `link_id`, `attempts`, `max_attempts`, `last_error`, and `updated_at`.
- [ ] Add a failing server test that posts `{ ids: [failedJobId] }` to retry failed jobs and expects only that job to move to `queued`.
- [ ] Implement a local `listFailedJobs(limit = 20)` helper in `server/routes/settings.js`.
- [ ] Include `failedJobs` inside the `queue` object returned by `GET /api/settings/system`.
- [ ] Parse optional `ids` in `POST /api/settings/system/retry-failed-jobs` and pass `{ ids }` to `getRuntimeQueue().retryFailedJobs`.

### Task 2: Frontend Failed Job Controls

**Files:**
- Modify: `client/src/api/client.ts`
- Modify: `client/src/pages/SettingsPage.tsx`
- Modify: `client/src/pages/BackgroundJobsPanel.tsx`

- [ ] Add TypeScript interfaces for failed job summaries and allow `retryFailedJobs(ids?: number[])`.
- [ ] Add a failing focused test if an existing lightweight client test pattern is available; otherwise rely on TypeScript build.
- [ ] Add per-job retry state in `SettingsPage`.
- [ ] Pass an `onRetryFailedJob(id)` callback to `BackgroundJobsPanel`.
- [ ] Render a compact failed-job list in `BackgroundJobsPanel`, with one retry button per failed job and the existing global retry button retained.

### Task 3: Verification

**Files:**
- Existing test/build commands only.

- [ ] Run `cd server && npm test`.
- [ ] Run `cd client && npm test`.
- [ ] Run `cd client && npm run build`.
- [ ] Run `git diff --check`.
