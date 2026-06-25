# LinkBox Validation Matrix

Last updated: 2026-06-25

Use this matrix to choose verification commands by change type. Broad changes
should run the full gate.

## Full Gate

Run before declaring a broad feature, schema, retrieval, or UI workflow change
complete:

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

## Backend Routes

Use for route adapters, controllers, auth, admin, settings, Assistant JSON
endpoints, mobile file endpoints, or social endpoints:

```bash
cd server && npm test
cd server && npm run test:e2e
git diff --check
```

Also run focused route tests first when available, for example:

```bash
node --test server/test/assistantRoutes.test.mjs
node --test server/test/settingsSystem.test.mjs
node --test server/test/socialGroup.test.mjs server/test/socialDirectMessages.test.mjs
```

## Durable Jobs And Processing

Use for job queue, enrichment, retry, processing status, or recovery hints:

```bash
node --test \
  server/test/jobQueue.test.mjs \
  server/test/enrichmentJobs.test.mjs \
  server/test/itemProcessingStatus.test.mjs \
  server/test/itemEnrichmentPlan.test.mjs

cd server && npm test
cd client && npm test
cd mobile && npm test
git diff --check
```

## Retrieval, Documents, And Embeddings

Use for canonical documents, chunking, embeddings, rerank, Assistant retrieval,
diagnostics, or legacy fallback gates:

```bash
node --test \
  server/test/documentIndex.test.mjs \
  server/test/documentEmbeddings.test.mjs \
  server/test/documentMaintenance.test.mjs \
  server/test/assistantRetrieval.test.mjs \
  server/test/assistantSourceRetrieval.test.mjs \
  server/test/assistantRetrievalDiagnosticsRoute.test.mjs

cd client && npm run test:e2e:canonical
cd server && npm test
git diff --check
```

## Desktop UI

Use for React pages, shared desktop components, API client types, or Playwright
covered desktop workflows:

```bash
cd client && npm test
cd client && npm run build
cd client && npm run test:e2e
git diff --check
```

## Mobile UI

Use for Vue views, mobile utilities, chat UI, image batches, mobile categories,
or mobile detail behavior:

```bash
cd mobile && npm test
cd mobile && npm run build
cd client && npm run test:e2e
git diff --check
```

The client E2E suite includes mobile-width and mobile-app projects.

## Schema And Migrations

Use for database schema, migration runner, backfills, canonical storage, or
compatibility retirement:

```bash
node --test \
  server/test/dbMigrations.test.mjs \
  server/test/itemContentStore.test.mjs \
  server/test/documentMaintenance.test.mjs

cd server && npm test
cd server && npm run test:e2e
cd client && npm run test:e2e
git diff --check
```

## Documentation Only

Use for README, planning docs, ADRs, validation docs, and deployment docs:

```bash
git diff --check
```

For docs with relative Markdown links, run from the repo root:

```bash
node <<'NODE'
const fs = require('fs');
const path = require('path');
const files = ['README.md', ...fs.readdirSync('docs').filter(f => f.endsWith('.md')).map(f => `docs/${f}`)];
let missing = [];
for (const file of files) {
  const text = fs.readFileSync(file, 'utf8');
  for (const match of text.matchAll(/\[[^\]]+\]\(([^)#][^)]+\.md)\)/g)) {
    const target = match[1];
    const resolved = path.normalize(path.join(path.dirname(file), target));
    if (!fs.existsSync(resolved)) missing.push(`${file} -> ${target}`);
  }
}
if (missing.length) {
  console.error(missing.join('\\n'));
  process.exit(1);
}
console.log('markdown links ok');
NODE
```
