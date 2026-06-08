# LinkBox Deep Optimization Design

Date: 2026-06-09

## Goal

Make LinkBox more reliable, maintainable, and deployable without changing the
product direction. LinkBox should stay a private knowledge box that collects
links, text, images, audio, and files, then enriches them with local or
OpenAI-compatible AI.

The first implementation round focuses on the reliability base: durable
background work plus the minimum architecture and tests needed to make that
work safe.

## Current Friction

- Background processing uses an in-memory queue. If the server restarts after a
  link, image, or file is saved, queued enrichment work can be lost.
- `server/routes/links.js` mixes HTTP routing, database writes, file upload
  handling, task orchestration, and enrichment logic.
- `server/utils/fileToMarkdown.js` and several frontend files are large enough
  that small changes require reading too much unrelated code.
- Automated tests are almost absent. The most important flows are currently
  protected by manual checks only.
- Runtime configuration is split across README, Docker Compose, systemd docs,
  and code defaults. The actual server default port is 3100, while the README
  quick start still says 3000.

## Optimization Tracks

### 1. Reliability Base

Replace the process-only background queue with a durable SQLite-backed job
queue.

The queue will store:

- job type
- target link id
- JSON payload
- status: `queued`, `running`, `done`, `failed`
- attempt count
- next run time
- last error
- created, updated, and completed timestamps

Jobs should survive process restarts. On startup, jobs left in `running` should
be returned to `queued` unless they exceeded the retry limit. Failed jobs should
keep enough error detail for the UI or admin status endpoint to show what
happened.

Initial job types:

- `link.fetchMetadata`
- `link.extractMarkdown`
- `link.summarize`
- `image.describe`
- `file.extractMarkdown`
- `file.summarize`

This keeps the HTTP request path fast: save the item, enqueue durable work, and
return the saved item immediately.

### 2. Architecture And Tests

Introduce a small job module behind the queue interface:

- queue storage and leasing
- job registration
- worker loop
- retry policy
- operational stats

Move enrichment work out of `routes/links.js` into job handlers. The route file
should remain responsible for authentication, validation, upload acceptance,
CRUD responses, and enqueueing jobs.

Add focused tests for:

- chunk splitting and indexing
- job queue persistence and retry transitions
- AI config validation and provider switching
- link/file/image enqueue behavior

The first test target is backend logic. Frontend tests can wait until the
runtime paths are stable.

### 3. Assistant Quality

After durable indexing is in place, improve assistant retrieval without adding a
new service dependency.

Planned improvements:

- better Chinese token handling
- clearer weighting for title, summary, comment, recency, and content chunks
- source references that point back to the original item and chunk
- admin-visible indexing status

Vector search is explicitly out of scope for the first round. It can be added
later as a second retrieval adapter if keyword retrieval becomes the bottleneck.

### 4. Product And Operations

Unify runtime documentation and status reporting:

- make README, Docker Compose, systemd docs, and server defaults agree on port,
  paths, and AI endpoint expectations
- expose queue health in the existing admin system endpoint
- show failed or retryable processing state in the UI
- add a manual retry action for failed processing jobs

TaishanPi/RK3576 constraints remain first-class: low concurrency, local AI
latency, and restart recovery matter more than high throughput.

## First Implementation Round

The first round will implement:

1. SQLite-backed durable jobs table and queue module.
2. Worker loop with leasing, retry, and startup recovery.
3. Link/image/file enrichment jobs moved behind job handlers.
4. Admin system status extended with queue stats.
5. Backend tests for queue state transitions and core indexing/config logic.
6. README/runtime docs corrected for the actual default port and deployment
   model.

The first round will not:

- add vector search
- redesign the UI
- replace SQLite
- replace the RKLLM adapter
- change authentication storage
- split every large frontend component

## Data Flow

Saving a link:

1. Route validates input and inserts a `links` row with `status = processing`.
2. Route enqueues `link.fetchMetadata`.
3. Metadata job updates title, description, and thumbnail, then enqueues
   `link.extractMarkdown`.
4. Extract job writes `content_md`, indexes chunks, then enqueues
   `link.summarize`.
5. Summarize job writes `summary` and marks the link `done`.
6. If a non-fatal AI step fails, the item can still be marked done with the
   error stored on the job.

Uploading a file:

1. Route accepts upload and inserts a `file` item.
2. Supported file types enqueue `file.extractMarkdown`.
3. Extract job stores Markdown, optional HTML, thumbnail, and chunks.
4. Summarize job writes AI summary when possible.

Uploading an image:

1. Route accepts upload and inserts an `image` item.
2. Image description job creates Markdown and summary, then indexes the item.

## Error Handling

Transient failures should retry with backoff. Permanent validation failures
should fail once with a clear error.

Examples:

- network timeout while fetching metadata: retry
- local AI endpoint unavailable: retry
- unsupported file extension: no job
- file parser command missing: fail with actionable error
- item deleted before job runs: mark job done or canceled without recreating the
  item

The route response should not block on enrichment failures. Item status and job
status should carry the truth.

## Testing Strategy

Use backend tests first because the highest risk is runtime state, not layout.

The tests should use temporary SQLite files and temporary upload directories.
They should avoid calling real external URLs or AI endpoints. Job handlers that
need fetch, extraction, or AI calls should receive adapters so tests can provide
deterministic fakes.

Required checks before claiming completion:

- backend test suite passes
- frontend build passes
- server starts far enough to initialize the database and routes
- documentation reflects the verified default port

## Review Notes

This design intentionally starts with durable queue reliability. It gives the
later architecture, assistant, product, and operations improvements a stable
base. It also keeps the first implementation round small enough to verify
instead of mixing unrelated frontend redesign, vector search, and deployment
changes in one pass.
