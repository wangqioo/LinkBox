# Agent Autopilot Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the first Agent Autopilot milestone so the RK3576 LinkBox node can run a bounded local scan, schedule safe missing work, retry recoverable failures, write a timeline, and show the result in the Local Agent workbench.

**Architecture:** Add a focused `localAgentAutopilot` utility that composes existing maturity, job queue, report, and suggestion modules. Extend the additive local Agent schema with timeline events, expose a manual run route, and extend the existing settings workbench UI.

**Tech Stack:** Node.js ESM, Express, better-sqlite3, existing SQLite job queue, React/Vite settings UI, Node test runner.

---

## File Map

- `server/utils/localAgentSchema.js`: add `agent_timeline_events`.
- `server/utils/localAgentAutopilot.js`: orchestrate scan, safe job enqueue, retry, report, timeline.
- `server/utils/localAgentFactory.js`: include autopilot and timeline in status.
- `server/routes/settings.js`: add manual autopilot run endpoint.
- `server/test/localAgentFactory.test.mjs`: cover schema and utility behavior.
- `server/test/settingsLocalAgent.test.mjs`: cover route behavior.
- `client/src/api/client.ts`: add autopilot/timeline types and API method.
- `client/src/pages/localAgentWorkbenchUtils.ts`: add display helpers.
- `client/src/pages/localAgentWorkbenchUtils.test.js`: cover display helpers.
- `client/src/pages/LocalAgentWorkbenchPanel.tsx`: render Autopilot card and timeline.
- `client/src/pages/SettingsPage.tsx`: call manual run endpoint.
- `docs/development.md`: document the milestone.
- `docs/taishanpi-deploy.md`: document RK3576 operational behavior.

## Tasks

1. Add failing backend tests for timeline schema and Autopilot behavior.
2. Implement `agent_timeline_events` and `localAgentAutopilot.js`.
3. Add failing route test for `POST /api/settings/local-agent/autopilot/run`.
4. Implement route and status payload extension.
5. Add failing client helper tests for Autopilot/timeline display.
6. Implement client types, API call, workbench controls, and timeline UI.
7. Update docs.
8. Run full local verification.
9. Commit and push to GitHub.
10. Deploy to RK3576/NanoPi-R76S with rollback backup and smoke verification.
