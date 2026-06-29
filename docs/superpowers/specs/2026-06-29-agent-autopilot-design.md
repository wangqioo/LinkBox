# Agent Autopilot Design

## Goal

Turn the RK3576 LinkBox node from a passive Agent workbench into a small
autopilot that can periodically inspect the library, enqueue safe missing
processing work, retry recoverable failures, generate a report, and leave a
visible timeline of what it did.

## Product Shape

Autopilot is deliberately conservative. It may schedule low-risk background
work and retry failed background jobs, but it must not delete items, rewrite
user-authored text, accept rules, or make irreversible classification changes.
Suggestions still require user confirmation.

The admin Local Agent workbench becomes the operational cockpit:

- current autopilot mode and last run summary
- one-click "run now"
- timeline of recent actions
- maturity coverage, report, suggestions, and rules as before

## Backend Architecture

Add `server/utils/localAgentAutopilot.js` as the orchestration layer. It uses
existing modules instead of creating a parallel job system:

- `getMaturityCoverage` to inspect item maturity
- `createTopicSuggestions` for rule candidates
- `generateLocalAgentReport` for the report
- `queue.enqueue`, `queue.retryFailedJobs`, and `queue.drain` for work

Add `agent_timeline_events` through `initLocalAgentSchema`. Each event records
the user, event type, title, detail, metadata JSON, related item, and time. The
table is additive and safe for existing deployments.

Autopilot exposes:

- `runLocalAgentAutopilot(db, { userId, queue, mode, limits })`
- `getLocalAgentAutopilotStatus(db, { userId })`
- `listLocalAgentTimeline(db, { userId, limit })`

The first version schedules these safe actions:

- retry a bounded number of failed jobs when enabled
- enqueue `link.summarize` for content-bearing link/article/text items without
  a summary
- enqueue `file.summarize` for document rows with Markdown but no summary
- enqueue `image.describe` for image rows that have an owned upload path but no
  content/summary
- enqueue `document.embed` for ready content rows missing canonical embeddings
  when embedding maintenance can be delegated to the existing queue
- generate topic suggestions
- generate an autopilot report

Before enqueueing, it checks whether the same item already has a queued or
running job of that type.

## API

Extend settings routes:

- `GET /api/settings/local-agent` includes `autopilot` and `timeline`.
- `POST /api/settings/local-agent/autopilot/run` runs one bounded scan now and
  returns the refreshed status.

Automatic periodic scheduling can be enabled later through a boot-time timer.
This milestone creates the idempotent run primitive and manual cockpit action
first, because it is easier to test and safer to deploy to the small box.

## Frontend

Extend `LocalAgentWorkbenchPanel`:

- add an Autopilot card with last run status, queued action count, retry count,
  and "run now" button
- add a recent timeline list
- keep existing maturity/report/suggestions/rules sections

The UI should stay dense and operational, not marketing-like.

## Testing

Backend tests cover:

- schema creates timeline table
- autopilot enqueues only missing safe jobs
- autopilot avoids duplicate queued/running jobs
- autopilot retries failed jobs when requested
- autopilot records timeline and report
- route requires admin and returns refreshed status

Client tests cover display helpers for timeline labels and autopilot summary
text. Full verification remains server tests, client tests/build, mobile
tests/build, and deployment smoke on RK3576 for Agent-related changes.

## Deployment

Because this changes Local Agent behavior, deployment to the RK3576/NanoPi-R76S
node is required after GitHub push. The deployment must preserve
`/var/lib/linkbox`, back up `/opt/linkbox`, verify local and public routes, and
validate the changed local Agent API.
