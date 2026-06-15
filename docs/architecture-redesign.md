# LinkBox Architecture Redesign

Date: 2026-06-15

## Current Status

Implementation has reached the committed checkpoint
`HEAD Add admin system health checks`.

Completed:

- Per-item processing status is derived from durable jobs and returned by item
  list/detail APIs.
- Failed jobs can be retried from the item card when retry metadata is present.
- `routes/links.js` has been reduced to route wiring and delegates to
  controller/service helpers.
- Upload middleware, image proxy logic, item repository access, and processing
  status derivation are split into focused modules.
- Desktop `LinksPage` is now mostly UI orchestration; data loading, actions,
  exports, and helper logic live in separate hooks/modules.
- A desktop toast provider gives user feedback for add, upload, edit, retry,
  delete, import, and export flows.
- Backend unit tests, desktop build, mobile build, `git diff --check`, and an
  isolated HTTP smoke test passed before pausing feature work.
- Item intake and durable job scheduling have a dedicated module at
  `utils/itemIntake.js`. Desktop item routes and mobile upload/analyze flows now
  delegate accept, import, retry, and reschedule behavior there.
- Assistant retrieval has a caller-facing interface at
  `utils/assistantSourceRetrieval.js`, with canonical document source
  normalization and legacy fallback kept behind one module.
- Desktop item list/detail and mobile file responses share
  `utils/itemPresentation.js` for display type, status, retry affordance, action
  capability, and primary asset URL.
- Background extraction and manual link extraction share
  `utils/extractedContentPersistence.js` for extracted Markdown, raw HTML,
  thumbnails, legacy chunks, canonical documents, embeddings, and summary jobs.
- A server-side E2E smoke script starts the real app against isolated
  database/uploads paths and covers auth, create, upload, list, update, export,
  and delete flows.
- Admin operational health checks are centralized in `utils/systemHealth.js` and
  surfaced through `GET /api/settings/system`, covering SQLite, uploads, queue,
  AI endpoint, `pdftotext`, and LibreOffice.

Developer handoff details are in `docs/development.md`.

## Goal

LinkBox should become a reliable personal knowledge system that feels fast even
when crawling pages, parsing files, and calling local AI are slow. The system
should stay a modular monolith for now: one Express server, one SQLite database,
one desktop web app, and one mobile web app.

The priority is not a technology rewrite. The priority is clearer boundaries,
observable background work, stable API contracts, and frontend flows that make
failures easy to recover from.

## Product Principles

- Saving content must be instant. Expensive enrichment work happens in durable
  jobs after the item is accepted.
- Every item should show a truthful processing state: what is running, what
  failed, and what the user can do next.
- Desktop and mobile clients should share the same API meanings for item type,
  processing status, AI state, and source references.
- Local deployment on low-power devices remains a first-class target. Prefer
  simple SQLite-backed reliability over new infrastructure.

## Target Backend Shape

```text
server/
  app/
    createApp.js
    errors.js
    middleware.js
  db/
    connection.js
    schema.js
    migrations/
  modules/
    auth/
    items/
      itemController.js
      itemService.js
      itemRepository.js
      itemProcessingStatus.js
      uploadMiddleware.js
      uploadedAsset.js
      itemIntake.js
    jobs/
      jobQueue.js
      jobRepository.js
      enrichmentHandlers.js
    ai/
      aiConfig.js
      aiProvider.js
      summarizer.js
    files/
      fileToMarkdown.js
      officeXmlUtils.js
      spreadsheetXmlUtils.js
    assistant/
      retriever.js
      assistantTurn.js
      assistantService.js
    admin/
    tags/
  routes/
    index.js
```

This can be reached gradually. Existing `server/utils/*` modules do not need to
move immediately; new boundaries should be introduced around them first.

## Target Frontend Shape

```text
client/src/
  api/
  features/
    links/
      components/
      hooks/
      types.ts
    settings/
    assistant/
    admin/
  components/
  context/

mobile/src/
  api/
  features/
  views/
```

The desktop client should move business actions out of large pages into hooks
such as `useLinksQuery`, `useLinkActions`, and `useProcessingPoller`. The mobile
client should reuse the same API status contract rather than deriving different
states.

## API Contract Direction

Every item returned from list/detail endpoints should include a derived
`processing` object:

```json
{
  "status": "processing",
  "processing": {
    "state": "running",
    "stage": "file.extractMarkdown",
    "label": "Extracting file content",
    "canRetry": false,
    "failedJobId": null,
    "lastError": "",
    "updatedAt": "2026-06-10T00:00:00.000Z"
  }
}
```

The legacy `links.status` column remains for compatibility, but clients should
prefer `processing.state` once it is available.

## Data Model Direction

Short term:

- Keep `links` as the item table.
- Derive item processing state from `jobs`.
- Add indexes and migration helpers before adding more columns.

Medium term:

- Rename the domain from link to item in code, while keeping database table
  compatibility until a migration is ready.
- Split large optional blobs into `item_content` and uploaded assets into
  `item_assets`.
- Track job `stage`, `progress`, and `retryable` explicitly if derived status is
  not enough.

## Implementation Phases

### Phase 1: Reliability And Status Contract

- Add an item processing status service that derives user-facing state from
  item rows and durable jobs.
- Include the processing object in item list and detail responses.
- Make per-item retry use the same service and queue methods.
- Keep manual extract/summarize endpoints, but treat them as explicit actions
  separate from automatic enrichment.
- Verify with backend tests plus desktop and mobile builds.

### Phase 2: Backend Module Boundaries

- Extract `routes/links.js` into item controller helpers.
- Move upload middleware and image proxy logic out of the route file.
- Introduce repository functions for item lookup, list, and ownership checks.
- Centralize upload-derived asset normalization so desktop and mobile upload
  adapters do not rebuild file paths, decoded names, and extraction metadata.
- Move assistant turn assembly out of `routes/assistant.js`.
- Deepen item intake and durable jobs into one module that owns accept/retry,
  import, reschedule, initial status, and queue adapter usage.
- Deepen assistant source retrieval into one module that hides canonical
  document lookup, legacy fallback, source IDs, and source shape from routes.
- Deepen item presentation into one module that desktop and mobile adapters can
  share.
- Deepen extraction post-processing into one module used by both background and
  manual extraction flows.

Remaining Phase 2 focus:

- Consolidate item write/tag/response shaping so create/update/delete paths
  return the same item presentation shape as list/detail where intended.
- Introduce a small `AppError` helper so route error handling is consistent.

### Phase 3: Frontend Link Feature

- Move link page state and actions into hooks.
- Create a reusable `ProcessingBanner` component.
- Use `processing.canRetry` and `processing.lastError` instead of hard-coded
  status checks.
- Align desktop and mobile item cards around the same status labels.

### Phase 4: AI And Assistant Quality

- Wrap AI providers behind a small interface.
- Split assistant retrieval into retriever, assistant turn builder, and response
  streamer. The assistant turn builder now exists; retrieval and streaming can
  be deepened further.
- Return source chunks with stable item IDs and scores for debugging.
- Add admin-visible indexing and retrieval diagnostics.

### Phase 5: Operations

- Lock Node to an LTS line, preferably Node 22.
- Health checks for SQLite, uploads, AI endpoint, `pdftotext`, LibreOffice, and
  job queue state now exist behind the admin system-status endpoint.
- Convert boot-time schema changes into migration files.
- Keep Docker, systemd, and README values aligned.

## Forward Plan

Next slice:

- Add Playwright browser E2E coverage on top of the server-side E2E smoke for
  login, add item, processing state, retry, export, and delete.

Still needed before a broader release:

- Expand server-side E2E coverage for failed job retry and assistant chat with a
  mock AI endpoint.
- Add a frontend/admin UI surface for degraded health checks and failed jobs.
- Write migration plan for item/content/assets tables.
- Convert boot-time schema changes into explicit migrations.
- Retire or narrow legacy `link_chunks` after canonical document retrieval has
  enough production confidence.

## Success Criteria

- Saving links/files/images returns quickly and always leaves a recoverable job
  trail.
- Users can see exactly why an item is stuck and retry it from the item card.
- Routes are thin enough that new item actions can be tested without Express.
- Desktop and mobile clients display the same item states.
- The project can be installed and tested reliably on a documented Node LTS
  version.
