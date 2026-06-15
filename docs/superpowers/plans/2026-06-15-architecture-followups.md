# Architecture Follow-Ups Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Deepen LinkBox's assistant retrieval, item presentation, and extraction post-processing modules without changing the product shape.

**Architecture:** Add one focused module per slice, then wire existing callers through the new module. Keep existing lower-level helpers as adapters until the new module owns the caller-facing behavior.

**Tech Stack:** Node.js ESM, Express route adapters, better-sqlite3, Node built-in test runner, React/Vite desktop app, Vite mobile app.

---

## File Structure

- Create `server/utils/assistantSourceRetrieval.js`: caller-facing assistant retrieval interface over canonical documents and legacy fallback.
- Create `server/test/assistantSourceRetrieval.test.mjs`: TDD coverage for canonical preference, legacy fallback, source shape, and scope behavior.
- Modify `server/utils/assistantTurn.js`: call the new retrieval interface instead of directly owning source selection.
- Create `server/utils/itemPresentation.js`: shared display model for stored items plus derived processing state.
- Create `server/test/itemPresentation.test.mjs`: TDD coverage for display type/status/action mapping.
- Modify `server/utils/itemRepository.js`: attach shared presentation for desktop item list/detail responses.
- Modify `server/utils/mobileFilePresenter.js`: reuse shared presentation while keeping mobile response compatibility.
- Create `server/utils/extractedContentPersistence.js`: shared persistence/index/summarize behavior after extraction.
- Create `server/test/extractedContentPersistence.test.mjs`: TDD coverage for markdown persistence, raw HTML, thumbnails, indexes, summary scheduling, and empty extraction.
- Modify `server/utils/enrichmentJobs.js`: use shared persistence for background link/file extraction.
- Modify `server/utils/linkAiActions.js`: use shared persistence for manual link extraction.
- Modify `docs/development.md`: update completed slices and test counts.
- Modify `docs/architecture-redesign.md`: update current progress and forward plan.

---

## Task 1: Canonical Assistant Retrieval Module

**Files:**
- Create: `server/utils/assistantSourceRetrieval.js`
- Create: `server/test/assistantSourceRetrieval.test.mjs`
- Modify: `server/utils/assistantTurn.js`
- Reference: `server/utils/assistantRetrieval.js`, `server/test/assistantRetrieval.test.mjs`, `server/test/assistantTurn.test.mjs`

- [ ] **Step 1: Write the failing canonical preference test**

Add `server/test/assistantSourceRetrieval.test.mjs` with a test database containing one canonical document chunk and one legacy chunk for the same query.

```js
test('retrieveAssistantSources prefers canonical document chunks over legacy chunks', () => withDb((db) => {
  seedOwnedItem(db, { id: 1, title: 'Canonical Note', contentMd: '# Canonical\n\nDurable queue facts' });
  seedDocumentChunk(db, {
    documentId: 1,
    itemId: 1,
    headingPath: 'Canonical Note > Queue',
    content: 'Durable queue facts from canonical document',
  });
  seedLegacyChunk(db, {
    linkId: 1,
    content: 'Durable queue facts from legacy chunk',
  });

  const sources = retrieveAssistantSources(db, {
    userId: 5,
    question: 'durable queue facts',
    limit: 4,
  });

  assert.equal(sources.length, 1);
  assert.equal(sources[0].sourceKind, 'document');
  assert.equal(sources[0].heading_path, 'Canonical Note > Queue');
  assert.match(sources[0].content, /canonical document/);
}));
```

- [ ] **Step 2: Run the new test to verify RED**

Run: `node --test server/test/assistantSourceRetrieval.test.mjs`

Expected: FAIL because `server/utils/assistantSourceRetrieval.js` does not exist or does not export `retrieveAssistantSources`.

- [ ] **Step 3: Implement the minimal retrieval module**

Create `server/utils/assistantSourceRetrieval.js`:

```js
import { retrieveSources } from './assistantRetrieval.js';

export function retrieveAssistantSources(db, options = {}) {
  const sources = retrieveSources({
    db,
    userId: options.userId,
    question: options.question,
    task: options.task || 'ask',
    scope: options.scope || {},
    maxSources: options.limit || options.maxSources,
    enableEmbeddings: options.enableEmbeddings,
    enableRerank: options.enableRerank,
    now: options.now,
  });

  if (options.includeLegacyFallback === false) {
    return sources.filter(source => source.document_id);
  }

  return sources;
}
```

- [ ] **Step 4: Run targeted retrieval tests**

Run: `node --test server/test/assistantSourceRetrieval.test.mjs server/test/assistantRetrieval.test.mjs`

Expected: all tests PASS.

- [ ] **Step 5: Add fallback and source-shape tests**

Add tests in `server/test/assistantSourceRetrieval.test.mjs`:

```js
test('retrieveAssistantSources falls back to legacy chunks when no canonical document matches', () => withDb((db) => {
  seedOwnedItem(db, { id: 2, title: 'Legacy Only' });
  seedLegacyChunk(db, {
    linkId: 2,
    content: 'Legacy-only retrieval content',
  });

  const sources = retrieveAssistantSources(db, {
    userId: 5,
    question: 'legacy-only retrieval',
    limit: 3,
  });

  assert.equal(sources.length, 1);
  assert.equal(sources[0].sourceKind, 'legacy');
  assert.equal(sources[0].link_id, 2);
}));

test('retrieveAssistantSources preserves stable source metadata', () => withDb((db) => {
  seedOwnedItem(db, { id: 3, title: 'Metadata Note', contentMd: '# Metadata\n\nStable source ids' });
  seedDocumentChunk(db, {
    documentId: 3,
    itemId: 3,
    headingPath: 'Metadata Note > Sources',
    content: 'Stable source ids and heading paths',
  });

  const sources = retrieveAssistantSources(db, {
    userId: 5,
    question: 'stable source ids',
    limit: 3,
  });

  assert.equal(sources[0].link_id, 3);
  assert.equal(sources[0].title, 'Metadata Note');
  assert.equal(sources[0].heading_path, 'Metadata Note > Sources');
  assert.equal(typeof sources[0].score, 'number');
}));
```

- [ ] **Step 6: Implement metadata normalization**

Update `server/utils/assistantSourceRetrieval.js` so every returned source has:

```js
{
  ...source,
  sourceKind: source.document_id ? 'document' : 'legacy',
  link_id: source.link_id || source.item_id,
  heading_path: source.heading_path || '',
  score: Number(source.score || 0),
}
```

- [ ] **Step 7: Wire assistant turn to the new retrieval interface**

Modify `server/utils/assistantTurn.js` to import `retrieveAssistantSources` and call it from the place that currently calls `retrieveSources` or equivalent source retrieval logic.

- [ ] **Step 8: Run assistant tests**

Run: `node --test server/test/assistantSourceRetrieval.test.mjs server/test/assistantRetrieval.test.mjs server/test/assistantTurn.test.mjs`

Expected: all tests PASS.

- [ ] **Step 9: Commit canonical retrieval slice**

```bash
git add server/utils/assistantSourceRetrieval.js server/test/assistantSourceRetrieval.test.mjs server/utils/assistantTurn.js
git commit -m "Deepen assistant source retrieval"
```

---

## Task 2: Shared Item Presentation Module

**Files:**
- Create: `server/utils/itemPresentation.js`
- Create: `server/test/itemPresentation.test.mjs`
- Modify: `server/utils/itemRepository.js`
- Modify: `server/utils/mobileFilePresenter.js`
- Reference: `server/test/itemRepository.test.mjs`, `server/test/mobileFilePresenter.test.mjs`

- [ ] **Step 1: Write failing presentation tests**

Create `server/test/itemPresentation.test.mjs`:

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import { presentItem } from '../utils/itemPresentation.js';

test('presentItem maps stored files to document display type', () => {
  const result = presentItem({
    type: 'file',
    title: 'Report.pdf',
    image_path: '/uploads/report.pdf',
    status: 'done',
    processing: { state: 'idle', canRetry: false },
  });

  assert.deepEqual(result.display, {
    type: 'document',
    typeLabel: 'Document',
    status: 'done',
    statusLabel: 'Done',
    canRetry: false,
    canAnalyze: true,
    primaryAssetUrl: '/uploads/report.pdf',
  });
});

test('presentItem prefers durable processing state over legacy status', () => {
  const result = presentItem({
    type: 'link',
    url: 'https://example.com',
    status: 'done',
    processing: { state: 'failed', canRetry: true, lastError: 'parser failed' },
  });

  assert.equal(result.display.status, 'failed');
  assert.equal(result.display.statusLabel, 'Failed');
  assert.equal(result.display.canRetry, true);
});
```

- [ ] **Step 2: Run presentation test to verify RED**

Run: `node --test server/test/itemPresentation.test.mjs`

Expected: FAIL because `itemPresentation.js` is missing.

- [ ] **Step 3: Implement `presentItem`**

Create `server/utils/itemPresentation.js`:

```js
const TYPE_LABELS = {
  link: 'Link',
  text: 'Text',
  image: 'Image',
  audio: 'Audio',
  document: 'Document',
  file: 'Document',
};

const STATUS_LABELS = {
  idle: 'Ready',
  done: 'Done',
  queued: 'Queued',
  running: 'Processing',
  processing: 'Processing',
  failed: 'Failed',
};

function displayType(item) {
  return item.type === 'file' ? 'document' : item.type || 'link';
}

function displayStatus(item) {
  const state = item.processing?.state;
  if (state && state !== 'idle') return state;
  return item.status || 'idle';
}

function primaryAssetUrl(item) {
  if (item.image_path) return item.image_path;
  if (item.thumbnail) return item.thumbnail;
  return '';
}

export function presentItem(item = {}) {
  const type = displayType(item);
  const status = displayStatus(item);
  return {
    ...item,
    display: {
      type,
      typeLabel: TYPE_LABELS[type] || type,
      status,
      statusLabel: STATUS_LABELS[status] || status,
      canRetry: Boolean(item.processing?.canRetry),
      canAnalyze: ['link', 'image', 'document', 'file'].includes(type),
      primaryAssetUrl: primaryAssetUrl(item),
    },
  };
}
```

- [ ] **Step 4: Run presentation tests**

Run: `node --test server/test/itemPresentation.test.mjs`

Expected: PASS.

- [ ] **Step 5: Wire repository responses**

Modify `server/utils/itemRepository.js`:

```js
import { presentItem } from './itemPresentation.js';
```

Wrap the results of `attachProcessingStatus`:

```js
const result = attachProcessingStatus(db, links.map(link => ({ ...link, tags: attachTags(db, link.id) })))
  .map(item => presentItem(item));
```

For single item helpers:

```js
return presentItem(attachProcessingStatus(db, { ...link, tags: attachTags(db, link.id) }));
```

- [ ] **Step 6: Wire mobile presenter to shared display**

Modify `server/utils/mobileFilePresenter.js` to call `presentItem(link)` at the start of `toMobileFile`.

Use `item.display.type`, `item.display.status`, `item.display.canRetry`, and `item.display.primaryAssetUrl` for derived mobile fields while preserving existing mobile response keys.

- [ ] **Step 7: Add mobile compatibility test**

Extend `server/test/mobileFilePresenter.test.mjs`:

```js
test('toMobileFile sources type and retry state from shared presentation', () => {
  const result = toMobileFile({
    id: 9,
    type: 'file',
    title: 'Plan.pdf',
    image_path: '/uploads/plan.pdf',
    status: 'done',
    processing: { state: 'failed', canRetry: true, lastError: 'parse failed' },
  });

  assert.equal(result.type, 'document');
  assert.equal(result.status, 'failed');
  assert.equal(result.can_retry, true);
  assert.equal(result.url, '/uploads/plan.pdf');
});
```

- [ ] **Step 8: Run item presentation tests**

Run: `node --test server/test/itemPresentation.test.mjs server/test/itemRepository.test.mjs server/test/mobileFilePresenter.test.mjs`

Expected: all tests PASS.

- [ ] **Step 9: Run desktop and mobile builds**

Run:

```bash
cd client && npm run build
cd ../mobile && npm run build
```

Expected: both builds PASS. The existing Vite CJS warning in mobile is acceptable.

- [ ] **Step 10: Commit item presentation slice**

```bash
git add server/utils/itemPresentation.js server/test/itemPresentation.test.mjs server/utils/itemRepository.js server/utils/mobileFilePresenter.js server/test/mobileFilePresenter.test.mjs
git commit -m "Unify item presentation"
```

---

## Task 3: Shared Extraction Persistence

**Files:**
- Create: `server/utils/extractedContentPersistence.js`
- Create: `server/test/extractedContentPersistence.test.mjs`
- Modify: `server/utils/enrichmentJobs.js`
- Modify: `server/utils/linkAiActions.js`
- Reference: `server/test/enrichmentJobs.test.mjs`, `server/test/linkAiActions.test.mjs`

- [ ] **Step 1: Write failing persistence tests**

Create `server/test/extractedContentPersistence.test.mjs`:

```js
test('persistExtractedContent stores markdown and schedules summary work', () => withDb((db) => {
  const indexed = [];
  const documents = [];
  const jobs = [];
  const queue = { enqueue: (type, options) => jobs.push({ type, options }) };

  persistExtractedContent(db, queue, {
    linkId: 1,
    markdown: '# Extracted\n\nBody',
    indexLink: linkId => indexed.push(linkId),
    indexDocument: (database, linkId) => {
      documents.push(linkId);
      return { documentId: 10 };
    },
  });

  const row = db.prepare('SELECT content_md, status FROM links WHERE id = 1').get();
  assert.equal(row.content_md, '# Extracted\n\nBody');
  assert.deepEqual(indexed, [1]);
  assert.deepEqual(documents, [1]);
  assert.deepEqual(jobs.map(job => job.type), ['document.embed', 'link.summarize']);
}));
```

- [ ] **Step 2: Run persistence test to verify RED**

Run: `node --test server/test/extractedContentPersistence.test.mjs`

Expected: FAIL because `extractedContentPersistence.js` is missing.

- [ ] **Step 3: Implement `persistExtractedContent`**

Create `server/utils/extractedContentPersistence.js`:

```js
import { indexLinkContent } from './chunkIndex.js';
import { indexDocumentForItem } from './documentIndex.js';
import { enqueueDocumentEmbedding } from './enrichmentJobs.js';

export function persistExtractedContent(db, queue, {
  linkId,
  markdown = '',
  rawHtml = '',
  thumbnail = null,
  summarize = true,
  summaryJobType = 'link.summarize',
  indexLink = indexLinkContent,
  indexDocument = indexDocumentForItem,
} = {}) {
  const cleanMarkdown = String(markdown || '');

  if (!cleanMarkdown.trim()) {
    db.prepare('UPDATE links SET status = ? WHERE id = ?').run('done', linkId);
    return { stored: false, document: null, summaryQueued: false };
  }

  db.prepare(`
    UPDATE links
    SET content_md = ?,
        html_note = CASE WHEN ? != '' THEN ? ELSE html_note END,
        thumbnail = COALESCE(?, thumbnail)
    WHERE id = ?
  `).run(cleanMarkdown, rawHtml, rawHtml, thumbnail, linkId);

  indexLink(linkId);
  const document = indexDocument(db, linkId);
  if (document?.documentId) enqueueDocumentEmbedding(db, queue, linkId);
  if (summarize) queue.enqueue(summaryJobType, { linkId });

  return {
    stored: true,
    document,
    summaryQueued: Boolean(summarize),
  };
}
```

- [ ] **Step 4: Add HTML, thumbnail, and empty extraction tests**

Add tests:

```js
test('persistExtractedContent stores raw html and thumbnail for file extraction', () => withDb((db) => {
  const queue = { enqueue() {} };
  persistExtractedContent(db, queue, {
    linkId: 1,
    markdown: '![slide](/uploads/slide.png)',
    rawHtml: '<h1>Original</h1>',
    thumbnail: '/uploads/slide.png',
    summarize: false,
    indexLink: () => {},
    indexDocument: () => ({ documentId: null }),
  });

  const row = db.prepare('SELECT html_note, thumbnail FROM links WHERE id = 1').get();
  assert.equal(row.html_note, '<h1>Original</h1>');
  assert.equal(row.thumbnail, '/uploads/slide.png');
}));

test('persistExtractedContent marks empty extraction done without summary job', () => withDb((db) => {
  const jobs = [];
  const result = persistExtractedContent(db, { enqueue: (...args) => jobs.push(args) }, {
    linkId: 1,
    markdown: '',
  });

  const row = db.prepare('SELECT status FROM links WHERE id = 1').get();
  assert.equal(row.status, 'done');
  assert.equal(result.stored, false);
  assert.deepEqual(jobs, []);
}));
```

- [ ] **Step 5: Run persistence tests**

Run: `node --test server/test/extractedContentPersistence.test.mjs`

Expected: PASS.

- [ ] **Step 6: Wire background extraction jobs**

Modify `server/utils/enrichmentJobs.js`:

- Import `persistExtractedContent`.
- In `link.extractMarkdown`, replace direct `content_md` update, `indexLinkContent`, `refreshDocument`, and `queue.enqueue('link.summarize')` with:

```js
persistExtractedContent(database, queue, {
  linkId,
  markdown: extracted.markdown,
  summaryJobType: 'link.summarize',
});
```

- In `file.extractMarkdown`, pass `rawHtml`, `thumbnail`, and `summaryJobType: 'file.summarize'`.

- [ ] **Step 7: Wire manual link extraction**

Modify `server/utils/linkAiActions.js` so `extractLinkContent` calls `persistExtractedContent` after `extractPageMarkdown`.

Pass `summarize: false` if the manual endpoint should preserve current behavior and avoid automatic summary scheduling; pass `summarize: true` only if existing tests already expect summary work.

- [ ] **Step 8: Run extraction-related tests**

Run: `node --test server/test/extractedContentPersistence.test.mjs server/test/enrichmentJobs.test.mjs server/test/linkAiActions.test.mjs`

Expected: all tests PASS.

- [ ] **Step 9: Commit extraction persistence slice**

```bash
git add server/utils/extractedContentPersistence.js server/test/extractedContentPersistence.test.mjs server/utils/enrichmentJobs.js server/utils/linkAiActions.js
git commit -m "Unify extracted content persistence"
```

---

## Task 4: Documentation And Final Verification

**Files:**
- Modify: `docs/development.md`
- Modify: `docs/architecture-redesign.md`

- [ ] **Step 1: Update docs**

In `docs/development.md`, add completed notes for:

- `server/utils/assistantSourceRetrieval.js`
- `server/utils/itemPresentation.js`
- `server/utils/extractedContentPersistence.js`

In `docs/architecture-redesign.md`, move canonical retrieval, presentation, and extraction persistence from forward plan into current completed work.

- [ ] **Step 2: Run full verification**

Run:

```bash
cd server && npm test
cd ../client && npm test && npm run build
cd ../mobile && npm run build
cd ..
node --test mobile/src/utils/markdownParser.test.mjs mobile/src/utils/mobileOrganizer.test.mjs
git diff --check
```

Expected:

- Server tests PASS.
- Client tests PASS.
- Client build PASS.
- Mobile build PASS.
- Mobile utility tests PASS, with the existing `MODULE_TYPELESS_PACKAGE_JSON` warning accepted.
- `git diff --check` PASS.

- [ ] **Step 3: Commit docs**

```bash
git add docs/development.md docs/architecture-redesign.md
git commit -m "Update architecture followup progress"
```

- [ ] **Step 4: Report status**

Run:

```bash
git status --short --branch
git log --oneline -6
```

Report the latest commits, verification commands, and any warnings.
