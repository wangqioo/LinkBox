# LinkBox Architecture Redesign

Date: 2026-06-10

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
- Introduce a small `AppError` helper so route error handling is consistent.

### Phase 3: Frontend Link Feature

- Move link page state and actions into hooks.
- Create a reusable `ProcessingBanner` component.
- Use `processing.canRetry` and `processing.lastError` instead of hard-coded
  status checks.
- Align desktop and mobile item cards around the same status labels.

### Phase 4: AI And Assistant Quality

- Wrap AI providers behind a small interface.
- Split assistant retrieval into retriever, prompt builder, and response
  streamer.
- Return source chunks with stable item IDs and scores for debugging.
- Add admin-visible indexing and retrieval diagnostics.

### Phase 5: Operations

- Lock Node to an LTS line, preferably Node 22.
- Add health checks for SQLite, uploads, AI endpoint, `pdftotext`, LibreOffice,
  and job queue state.
- Convert boot-time schema changes into migration files.
- Keep Docker, systemd, and README values aligned.

## Four-Week Execution Plan

Week 1:

- Land processing status contract.
- Add per-item retry tests and frontend display.
- Add Node version guidance.

Week 2:

- Split item route responsibilities.
- Add repository and AppError helpers.
- Expand route/service tests around item ownership and retry behavior.

Week 3:

- Refactor desktop links feature into hooks and smaller components.
- Apply the same processing banner to mobile cards.
- Remove duplicated polling logic.

Week 4:

- Improve assistant retrieval boundaries.
- Add operational health checks.
- Write migration plan for item/content/assets tables.

## Success Criteria

- Saving links/files/images returns quickly and always leaves a recoverable job
  trail.
- Users can see exactly why an item is stuck and retry it from the item card.
- Routes are thin enough that new item actions can be tested without Express.
- Desktop and mobile clients display the same item states.
- The project can be installed and tested reliably on a documented Node LTS
  version.
