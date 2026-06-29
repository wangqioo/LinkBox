# Local Agent Workbench Stage 2 Design

## Context

LinkBox already has the first Local Agent Knowledge Factory milestone. The
admin settings workbench can show item maturity coverage, generate a report,
create topic suggestions, accept or reject suggestions, and list active rules.

The next optimization should make the workbench operational instead of merely
informational. An admin should be able to open the panel and answer:

- What is blocked right now?
- What should I do next?
- What changed after I accepted a suggestion or generated a report?

This stage stays inside the admin Local Agent surface. It does not change the
Assistant chat turn pipeline, mobile UI, social routes, or broad Smart Agent
quality fixtures.

## Goals

1. Surface the local factory's current blockers: queued/running/failed jobs,
   recent failed job examples, pending suggestions, low-maturity items, and
   active rules.
2. Generate a deterministic `nextActions` list that tells the admin what to do
   next, ordered by severity and immediate usefulness.
3. Make reports, suggestions, and rules more explainable by including the
   snapshots and source context needed to understand their effect.
4. Keep the UI dense, admin-like, and consistent with the existing settings
   page.

## Non-Goals

- No mobile frontend changes in this stage.
- No new LLM call path for Local Agent suggestions.
- No Assistant retrieval or answer-generation behavior changes.
- No broad route refactor outside the existing Local Agent settings endpoints.
- No schema rewrite. Existing local factory tables remain the persistence
  boundary.

## Approach Options

### Recommended: Enrich The Existing Status Endpoint

Extend `GET /api/settings/local-agent` and the status returned by Local Agent
commands with jobs, recent runs, richer suggestions, richer rules, and
deterministic next actions.

Pros:

- Preserves the current frontend data flow.
- Avoids another settings endpoint for the same panel.
- Easy to test with existing `localAgentFactory` and settings route tests.

Cons:

- The status payload becomes larger, so helpers must keep it well shaped.

### Alternative: Add Separate Drilldown Endpoints

Keep the current status endpoint small and add endpoints such as
`/local-agent/jobs`, `/local-agent/runs`, and `/local-agent/actions`.

Pros:

- More granular API boundaries.

Cons:

- More client state and loading paths for one admin panel.
- Premature for the current amount of data.

### Alternative: Treat Workbench As A Report-Only Surface

Make `generateLocalAgentReport` produce all guidance and keep the panel mostly
static until a report is generated.

Pros:

- Simple persistence model.

Cons:

- The admin would not see current blockers until manually generating a report.
- Less useful for day-to-day operational checks.

## Backend Design

`server/utils/localAgentFactory.js` remains the main Local Agent read/write
service.

`getLocalAgentStatus(db, { userId })` should return the existing fields plus:

- `jobs`: queue counts and bounded recent failed examples.
- `nextActions`: deterministic action cards derived from coverage, jobs,
  suggestions, and rules.
- `runs`: recent `agent_runs` summaries for local factory activity.

Suggested shape:

```js
{
  coverage,
  jobs: {
    counts: { queued, running, done, failed },
    failed: [
      { id, type, itemId, itemTitle, lastError, updatedAt }
    ]
  },
  nextActions: [
    {
      kind: 'retry_failed_jobs',
      severity: 'high',
      title: '重试失败任务',
      detail: '3 个任务失败，先处理最近失败的资料加工。',
      action: 'retry_jobs'
    }
  ],
  latestReport,
  runs: [
    { id, runType, status, summary, startedAt, completedAt }
  ],
  suggestions,
  rules
}
```

Action generation should stay deterministic:

- Failed jobs create a high-severity retry action.
- Pending suggestions create a medium-severity review action.
- Raw or converted items create a medium-severity processing/backfill action.
- No latest report creates a low-severity report action.
- No active rules but accepted suggestions or high-confidence suggestions
  create a rule-learning action.
- If the library has no items, return a single empty-library action.

Suggestions should include enough item context to review without opening the
database manually:

- `itemTitle`
- `itemType`
- parsed `proposal`
- parsed `evidence`
- confidence

Rules should include readable action and source context:

- parsed `condition`
- parsed `action`
- `sourceSuggestion`
- `sourceItemTitle`

Reports should store the same operational snapshot used to produce the panel:

- coverage totals and maturity states
- job counts
- pending suggestions
- active rule count
- generated next action count

## Frontend Design

`client/src/pages/LocalAgentWorkbenchPanel.tsx` should stay a focused settings
panel, but the layout changes from one-column status blocks to an operational
dashboard:

1. Header with refresh, generate report, and generate suggestions controls.
2. Four compact metrics:
   - 可调用资料
   - 待确认
   - 失败任务
   - 活跃规则
3. `下一步行动` list:
   - severity indicator
   - action title
   - detail text
   - optional small action hint
4. Maturity distribution grid and progress bar.
5. Recent report and recent runs.
6. Pending suggestions with item title, confidence, evidence summary, accept
   and reject buttons.
7. Active rules with source and action summary.

The design should remain restrained:

- No decorative cards inside cards.
- No marketing copy.
- No oversized hero typography.
- Use existing `btn-primary` and `btn-secondary` classes.
- Use lucide icons for actions where useful.
- Keep labels short so the settings page works on narrow widths.

Formatting helpers belong in `localAgentWorkbenchUtils.ts`:

- next action severity labels and sort weights
- suggestion title and evidence summary
- rule action summary
- job count summaries

## Error Handling

The existing settings route error handling remains in place. Local Agent command
responses should keep returning a refreshed `status` payload so the panel
reflects changes after report generation, suggestion generation, or suggestion
resolution.

If optional tables such as `jobs`, `item_topics`, or document tables are absent
in isolated tests, helpers should return empty counts rather than throwing.

## Testing

Backend unit coverage:

- `server/test/localAgentFactory.test.mjs`
  - status includes `jobs`, `nextActions`, and `runs`;
  - failed jobs produce high-severity retry actions;
  - pending suggestions include item context;
  - accepted suggestions create rules with source context.

Route coverage:

- `server/test/settingsLocalAgent.test.mjs`
  - `GET /api/settings/local-agent` exposes the enriched status shape;
  - command endpoints still return refreshed enriched status.

Frontend utility coverage:

- `client/src/pages/localAgentWorkbenchUtils.test.js`
  - formats severity labels;
  - summarizes suggestion evidence;
  - summarizes rule actions.

Verification commands:

```bash
cd server && npm test
cd client && npm test
cd client && npm run build
git diff --check
```

## Later Stages

After this stage, continue with separate specs and implementation plans for:

1. Smart Agent quality loop with real failure fixtures.
2. Mobile large-view decomposition.
3. Social route deepening when changing direct or group chat behavior.
4. Opportunistic route JSON error helper migration.
