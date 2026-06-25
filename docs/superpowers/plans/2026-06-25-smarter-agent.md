# Smarter Agent Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make LinkBox Assistant feel smarter by adding retrieval confidence, corrective retrieval, and visible sub-question reasoning while preserving the current chat API.

**Architecture:** Keep the existing planner, retrieval, evidence, verification, memory, and diagnostics layers. Add a focused confidence module, then let the agent use low-confidence retrieval as a trigger for corrective queries. Add sub-question planning as metadata first so it improves retrieval diagnostics without forcing a large prompt rewrite.

**Tech Stack:** Node.js ESM, Express, better-sqlite3, existing Assistant modules, Node test runner, React/Vue diagnostics surfaces as needed.

**Status 2026-06-25:** Completed for the first smarter-agent slice. The agent
now scores retrieval confidence, continues after low-confidence retrieval,
records confidence diagnostics, and exposes sub-question planning metadata.

---

### Task 1: Retrieval Confidence Gate

**Files:**
- Create: `server/utils/assistantRetrievalConfidence.js`
- Test: `server/test/assistantRetrievalConfidence.test.mjs`
- Modify: `server/utils/assistantAgent.js`
- Test: `server/test/assistantAgent.test.mjs`

- [x] Add confidence scoring for source count, snippets, retrieval modes, scores, and query coverage.
- [x] Attach confidence to retrieval/evidence diagnostics.
- [x] Mark evidence verification `partial` when sources exist but confidence is low.

### Task 2: Corrective Retrieval Branch

**Files:**
- Modify: `server/utils/assistantAgentPlanner.js`
- Modify: `server/utils/assistantAgent.js`
- Test: `server/test/assistantAgentPlanner.test.mjs`
- Test: `server/test/assistantAgent.test.mjs`

- [x] Add bounded corrective queries for low-confidence retrieval.
- [x] Retry with corrective queries when the first non-empty retrieval is weak.
- [x] Record corrective attempts in run steps.

### Task 3: Sub-Question Reasoning Metadata

**Files:**
- Modify: `server/utils/assistantAgentPlanner.js`
- Modify: `server/utils/assistantEvidence.js`
- Modify: `client/src/pages/RetrievalDiagnosticsPanel.tsx`
- Modify: `mobile/src/utils/assistantDiagnostics.js`
- Test: existing focused tests where useful.

- [x] Add simple sub-question generation for broad project/status questions.
- [x] Record per-sub-question evidence summaries in diagnostics.
- [x] Surface sub-questions compactly in desktop/mobile diagnostics.

### Task 4: Quality Fixtures

**Files:**
- Modify: `server/test/assistantQuality.test.mjs`
- Modify: `docs/development.md`
- Modify: `docs/roadmap.md`

- [x] Add fixture proving low-confidence evidence does not look fully supported.
- [x] Add fixture proving corrective retrieval can recover a missed answer.
- [x] Add fixture proving broad project questions expose sub-question diagnostics.
- [x] Update docs with the smarter agent behavior and validation commands.
