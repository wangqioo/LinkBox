# Smart Agent Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Upgrade LinkBox Assistant from one-shot RAG into a layered Smart Agent with planning, evidence, observable runs, retrieval refinement, verification, structured knowledge, and memory.

**Architecture:** Keep SQLite and the current retrieval modules. Add an agent layer above retrieval that plans the turn, executes retrieval tools, builds an evidence notebook, verifies answer support, and records run steps for diagnostics. Each layer must be useful independently and keep the existing chat API compatible.

**Tech Stack:** Node.js, Express, better-sqlite3, existing Assistant retrieval/document/embedding modules, React diagnostics UI, Node test runner, Playwright.

---

### Layer 1: Observable Agent Core

Status: completed. Planner, evidence notebook, persisted assistant runs, route
diagnostics, and compatible `agent` API metadata are implemented and covered by
focused backend tests.

**Files:**
- Create: `server/utils/assistantAgentPlanner.js`
- Create: `server/utils/assistantEvidence.js`
- Create: `server/utils/assistantAgent.js`
- Modify: `server/utils/dbMigrations.js`
- Modify: `server/routes/assistant.js`
- Test: `server/test/assistantAgentPlanner.test.mjs`
- Test: `server/test/assistantEvidence.test.mjs`
- Test: `server/test/assistantAgent.test.mjs`
- Test: `server/test/dbMigrations.test.mjs`
- Test: `server/test/assistantRoutes.test.mjs`

**Behavior:**
- Classify each turn into an intent.
- Produce a retrieval plan with named tools and reasons.
- Build an evidence notebook from retrieved sources.
- Return existing `answer` / `sources` fields plus optional `agent` diagnostics metadata.
- Persist `assistant_runs` and `assistant_run_steps`.

### Layer 2: Multi-Pass Retrieval

Status: completed. The agent executes planner rewrite queries after an empty
first pass, records each retrieval attempt in `assistant_run_steps`, and routes
HTTP retrieval through the per-attempt query.

**Files:**
- Modify: `server/utils/assistantAgentPlanner.js`
- Modify: `server/utils/assistantAgent.js`
- Test: `server/test/assistantAgent.test.mjs`
- Test: `server/test/assistantRetrieval.test.mjs`

**Behavior:**
- Rewrite short or vague queries once.
- Run keyword/vector/recent/group retrieval according to plan.
- Merge evidence and keep retrieval reasons visible.

### Layer 3: Answer Verification

Status: completed. `assistantVerifier` checks retrieval support and answer
citations, the route verifies final answers after generation, persisted runs get
an `answer_verification` step, and assistant messages retain verification
summaries in `agent_json`.

**Files:**
- Create: `server/utils/assistantVerifier.js`
- Modify: `server/utils/assistantAgent.js`
- Test: `server/test/assistantVerifier.test.mjs`
- Test: `server/test/assistantAgent.test.mjs`

**Behavior:**
- Detect empty evidence.
- Detect citations outside source range.
- Produce a support status: `supported`, `partial`, or `insufficient`.
- Attach verification metadata to diagnostics and saved assistant messages.

### Layer 4: Structured Knowledge

Status: completed. Deterministic item understanding extracts entities, topics,
todos, and claims into dedicated tables. Document indexing refreshes these
structures, and Assistant retrieval can use structured knowledge as an
explainable fallback.

**Files:**
- Create: `server/utils/itemUnderstanding.js`
- Modify: `server/utils/dbMigrations.js`
- Modify: enrichment jobs where appropriate.
- Test: `server/test/itemUnderstanding.test.mjs`
- Test: `server/test/dbMigrations.test.mjs`

**Behavior:**
- Add `item_entities`, `item_topics`, `item_todos`, and `item_claims`.
- Extract deterministic first-pass structures from titles, summaries, comments, and markdown.
- Let Agent retrieval include structured knowledge rows as evidence.

### Layer 5: Memory

Status: completed. Explicit user memory is stored in `assistant_memories`,
isolated by personal/group scope, surfaced in diagnostics, and passed into the
prompt as low-priority context.

**Files:**
- Create: `server/utils/assistantMemory.js`
- Modify: `server/utils/dbMigrations.js`
- Modify: `server/utils/assistantAgent.js`
- Test: `server/test/assistantMemory.test.mjs`
- Test: `server/test/assistantAgent.test.mjs`

**Behavior:**
- Add `assistant_memories`.
- Store explicit user preferences and recurring project context.
- Use memory as low-priority context with clear diagnostics.

### Layer 6: UI Diagnostics

Status: completed. Desktop chat shows compact Agent status chips, and the admin
retrieval diagnostics panel shows planner, tools, memory, evidence, support,
issues, and run steps.

**Files:**
- Modify: `client/src/pages/AssistantPage.tsx`
- Modify: `client/src/pages/RetrievalDiagnosticsPanel.tsx`
- Modify: `mobile/src/components/ChatBox.vue`
- Test: `client/e2e/assistant.spec.ts`
- Test: `mobile/src/utils/*` where helpers are added.

**Behavior:**
- Show plan, tools, evidence, and verification state.
- Keep compact citation chips for normal chat.
- Keep admin diagnostics detailed.

---

## Validation Gates

Run after each completed layer:

```bash
cd server && npm test
cd server && npm run test:e2e
cd client && npm test
cd client && npm run build
cd client && npm run test:e2e
cd client && npm run test:e2e:canonical
cd mobile && npm test
cd mobile && npm run build
git diff --check
```

---

## Productization Follow-Up Plan

Status: completed for this checkpoint. These items were implemented after the
initial Smart Agent pass to turn the architecture into an operable product
surface with maintenance, UI control, mobile parity, quality gates, and a
bounded LLM-assisted understanding prototype.

### Follow-Up 1: Commit And Release Hygiene

Status: completed. The initial Smart Agent working tree was committed locally
as `19502f9 Add smart assistant agent architecture`.

**Goal:** Turn the current verified working tree into a reviewable change set.

**Tasks:**
- Review `git status --short` and separate unrelated pre-existing changes from
  the Smart Agent work where practical.
- Create a concise changelog entry covering Agent runs, verification,
  structured knowledge, memory, and diagnostics UI.
- Re-run the full validation gate before commit.

**Done when:**
- The branch has a clean commit or PR-sized set of commits.
- The final verification commands are recorded in the commit/PR notes.

### Follow-Up 2: Historical Item Understanding Backfill

Status: completed. `item_understanding_runs` tracks processed content-bearing
items, document maintenance stats report structured understanding coverage, and
`POST /api/settings/system/backfill-understanding` performs bounded idempotent
backfills from the admin maintenance UI.

**Goal:** Populate `item_entities`, `item_topics`, `item_todos`, and
`item_claims` for existing items, not only newly indexed or reindexed items.

**Tasks:**
- Add a bounded maintenance helper that scans existing `links` rows and calls
  `upsertItemUnderstanding`.
- Expose an admin action or maintenance script for one-shot backfill.
- Report counts for scanned items and generated structures.
- Add tests for idempotency and partial reruns.

**Validation:**
```bash
node --test server/test/itemUnderstanding.test.mjs server/test/documentMaintenance.test.mjs
cd server && npm test
git diff --check
```

### Follow-Up 3: Assistant Memory Management UI

Status: completed. Assistant memory list/delete endpoints are scoped by
personal or group context, and the desktop Assistant page has a lightweight
memory panel for review, refresh, and deletion.

**Goal:** Let users inspect and control explicit memories.

**Tasks:**
- Add API endpoints to list and delete `assistant_memories`, scoped by personal
  or group context.
- Add desktop settings or Assistant-side UI for memory review and deletion.
- Add group-aware memory management where group Assistant is used.
- Keep automatic capture restricted to explicit memory phrases.

**Validation:**
```bash
node --test server/test/assistantMemory.test.mjs server/test/assistantRoutes.test.mjs
cd client && npm test
cd client && npm run build
cd client && npm run test:e2e
git diff --check
```

### Follow-Up 4: Mobile Agent Diagnostics

Status: completed. Mobile Assistant history preserves `agent` metadata, the
SSE client handles `agent` events, and `ChatBox.vue` renders compact diagnostic
chips for intent, tools, retrieval attempts, evidence, verification, and memory.

**Goal:** Bring a compact version of Agent status to mobile chat without making
the mobile UI dense.

**Tasks:**
- Extend mobile Assistant message normalization to preserve `agent` metadata.
- Add a small collapsed Agent status row to `mobile/src/components/ChatBox.vue`.
- Reuse existing mobile source inspection helpers for retrieval/evidence
  details instead of duplicating formatting logic.

**Validation:**
```bash
cd mobile && npm test
cd mobile && npm run build
cd client && npm run test:e2e
git diff --check
```

### Follow-Up 5: Assistant Quality Evaluation Set

Status: completed. `server/test/assistantQuality.test.mjs` exercises a fixed
quality corpus covering canonical document evidence, structured todo fallback,
explicit memory loading, and no-evidence insufficient support.

**Goal:** Measure whether planner/retrieval/memory changes improve answer
quality instead of only checking behavior mechanically.

**Tasks:**
- Add a small fixture corpus with representative personal, group, document,
  todo, memory, and no-evidence cases.
- Add expected retrieval source ids, evidence status, and verification status
  for each query.
- Keep LLM answer text assertions minimal; evaluate citations and source
  support first.
- Run the fixture suite before adding LLM rerank or richer reasoning.

**Validation:**
```bash
node --test server/test/assistantQuality*.test.mjs
cd server && npm test
git diff --check
```

### Follow-Up 6: Richer LLM-Assisted Understanding

Status: completed as an opt-in prototype boundary.
`server/utils/llmUnderstandingAnnotations.js` builds a strict JSON prompt,
validates generated rich-understanding JSON, and stores questions,
contradictions, timelines, project summaries, prompt version, model, and source
hash in `document_annotations` with type `llm_understanding`.

**Goal:** Add higher-level knowledge only after deterministic understanding and
quality fixtures are stable.

**Tasks:**
- Prototype LLM-assisted questions, contradictions, timelines, and project
  summaries as opt-in annotations.
- Store model, prompt version, source hashes, and generated content separately
  from deterministic `item_*` tables.
- Add rollback/rebuild paths before enabling background generation.

**Validation:**
```bash
node --test server/test/llmUnderstandingAnnotations.test.mjs
cd server && npm test
cd client && npm run test:e2e:canonical
git diff --check
```
