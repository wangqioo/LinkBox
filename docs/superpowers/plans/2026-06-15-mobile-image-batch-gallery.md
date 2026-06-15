# Mobile Image Batch Gallery Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Preserve multi-image mobile uploads as durable batches and render each batch as a stacked swipeable gallery card in the mobile feed.

**Architecture:** Store `batch_id` and `batch_index` on image rows in `links`. Mobile upload generates one client batch id for selected image groups and passes batch metadata through the existing upload endpoint. Mobile feed groups image rows by `batch_id` into virtual gallery items and renders them with a focused gallery component.

**Tech Stack:** Express, SQLite migrations, Vue 3 Composition API, Vite, Node test runner.

---

## File Structure

- Modify `server/utils/dbMigrations.js`: add migration `002_links_batch_columns`.
- Modify `server/test/dbMigrations.test.mjs`: assert batch columns are added and migrations remain idempotent.
- Modify `server/utils/linkCreateService.js`: persist optional `batchId` and `batchIndex` for image items.
- Modify `server/test/linkCreateService.test.mjs`: assert image item batch metadata is saved.
- Modify `server/routes/mobileFiles.js`: accept mobile upload `batch_id` and `batch_index` only for image uploads.
- Modify `server/utils/mobileFilePresenter.js`: expose `batch_id` and `batch_index` to mobile clients.
- Create `mobile/src/utils/imageBatchGallery.js`: pure helper to group feed rows into image gallery view models.
- Create `mobile/src/utils/imageBatchGallery.test.mjs`: test grouping, ordering, mixed uploads, and single-image fallback.
- Create `mobile/src/components/ImageBatchCard.vue`: stacked swipeable image gallery card.
- Modify `mobile/src/api/files.js`: allow optional upload metadata.
- Modify `mobile/src/views/Home.vue`: generate batch metadata on multi-image selection, use grouping helper, render gallery cards, delete active image.

## Task 1: Backend Batch Persistence

**Files:**
- Modify: `server/utils/dbMigrations.js`
- Modify: `server/test/dbMigrations.test.mjs`
- Modify: `server/utils/linkCreateService.js`
- Modify: `server/test/linkCreateService.test.mjs`
- Modify: `server/routes/mobileFiles.js`
- Modify: `server/utils/mobileFilePresenter.js`

- [x] **Step 1: Write failing migration and image persistence tests**

Add this assertion to `server/test/dbMigrations.test.mjs` after `status` in the expected column list:

```js
    'batch_id',
    'batch_index',
```

Change the expected migration result in the first test:

```js
  assert.equal(result.applied, 2);
  assert.deepEqual(result.names, ['001_links_item_columns', '002_links_batch_columns']);
```

Change the idempotence assertion:

```js
  assert.equal(first.applied, 2);
  assert.equal(db.prepare('SELECT COUNT(*) AS count FROM schema_migrations').get().count, 2);
```

In `server/test/linkCreateService.test.mjs`, add `batchId` and `batchIndex` to the `createImageItem` call:

```js
    batchId: 'batch-abc',
    batchIndex: 1,
```

Add these assertions after the existing image path assertions:

```js
  assert.equal(result.link.batch_id, 'batch-abc');
  assert.equal(result.link.batch_index, 1);
```

- [x] **Step 2: Run backend tests and verify they fail**

Run:

```bash
cd /Users/wq/LinkBox/server
npm test -- test/dbMigrations.test.mjs test/linkCreateService.test.mjs
```

Expected: FAIL because `batch_id` and `batch_index` are missing.

- [x] **Step 3: Implement migration and persistence**

In `server/utils/dbMigrations.js`, append this migration:

```js
  {
    name: '002_links_batch_columns',
    up(db) {
      addColumnIfMissing(db, 'links', 'batch_id', "TEXT DEFAULT ''");
      addColumnIfMissing(db, 'links', 'batch_index', 'INTEGER DEFAULT 0');
      db.exec('CREATE INDEX IF NOT EXISTS idx_links_batch ON links(user_id, batch_id, batch_index)');
    },
  },
```

In `server/utils/linkCreateService.js`, extend `createImageItem` options:

```js
  batchId = '',
  batchIndex = 0,
```

Replace the image insert with:

```js
  const result = db.prepare(`
    INSERT INTO links (user_id, type, url, title, image_path, thumbnail, comment, imported_at, status, batch_id, batch_index)
    VALUES (?, 'image', '', ?, ?, ?, ?, ?, 'processing', ?, ?)
  `).run(userId, title || originalName, imagePath, imagePath, comment || '', importedAt, batchId || '', Number(batchIndex) || 0);
```

In `server/routes/mobileFiles.js`, before calling `acceptImageItem`, parse:

```js
      const batchId = String(req.body?.batch_id || '').trim().slice(0, 80);
      const batchIndex = Number(req.body?.batch_index || 0);
```

Pass into `acceptImageItem`:

```js
        batchId,
        batchIndex: Number.isFinite(batchIndex) ? batchIndex : 0,
```

In `server/utils/mobileFilePresenter.js`, include:

```js
    batch_id: item.batch_id || '',
    batch_index: Number(item.batch_index || 0),
```

- [x] **Step 4: Run backend tests and verify they pass**

Run:

```bash
cd /Users/wq/LinkBox/server
npm test -- test/dbMigrations.test.mjs test/linkCreateService.test.mjs test/mobileFilePresenter.test.mjs
```

Expected: PASS.

- [x] **Step 5: Commit backend batch persistence**

```bash
cd /Users/wq/LinkBox
git add server/utils/dbMigrations.js server/test/dbMigrations.test.mjs server/utils/linkCreateService.js server/test/linkCreateService.test.mjs server/routes/mobileFiles.js server/utils/mobileFilePresenter.js
git commit -m "feat: persist mobile image upload batches"
```

## Task 2: Mobile Grouping Logic

**Files:**
- Create: `mobile/src/utils/imageBatchGallery.js`
- Create: `mobile/src/utils/imageBatchGallery.test.mjs`

- [x] **Step 1: Write failing grouping tests**

Create `mobile/src/utils/imageBatchGallery.test.mjs`:

```js
import test from 'node:test'
import assert from 'node:assert/strict'
import { groupImageBatches } from './imageBatchGallery.js'

test('groupImageBatches groups same-batch images into one gallery item ordered by batch_index', () => {
  const rows = [
    { id: '3', type: 'image', batch_id: 'b1', batch_index: 2, original_filename: 'c.jpg' },
    { id: '1', type: 'image', batch_id: 'b1', batch_index: 0, original_filename: 'a.jpg' },
    { id: '2', type: 'image', batch_id: 'b1', batch_index: 1, original_filename: 'b.jpg' },
  ]

  const result = groupImageBatches(rows)

  assert.equal(result.length, 1)
  assert.equal(result[0].kind, 'image-batch')
  assert.equal(result[0].id, 'batch:b1')
  assert.deepEqual(result[0].images.map(image => image.id), ['1', '2', '3'])
  assert.equal(result[0].activeIndex, 0)
})

test('groupImageBatches leaves single images and non-images as normal items', () => {
  const rows = [
    { id: '10', type: 'image', batch_id: 'solo', batch_index: 0 },
    { id: '11', type: 'file', batch_id: 'solo', batch_index: 1 },
    { id: '12', type: 'image', batch_id: '', batch_index: 0 },
  ]

  const result = groupImageBatches(rows)

  assert.deepEqual(result.map(item => item.kind), ['item', 'item', 'item'])
  assert.deepEqual(result.map(item => item.file.id), ['10', '11', '12'])
})

test('groupImageBatches places a gallery at the newest row position for that batch', () => {
  const rows = [
    { id: '20', type: 'text', original_filename: 'note' },
    { id: '22', type: 'image', batch_id: 'b2', batch_index: 1 },
    { id: '21', type: 'image', batch_id: 'b2', batch_index: 0 },
    { id: '19', type: 'link', original_filename: 'link' },
  ]

  const result = groupImageBatches(rows)

  assert.deepEqual(result.map(item => item.kind), ['item', 'image-batch', 'item'])
  assert.equal(result[1].id, 'batch:b2')
})
```

- [x] **Step 2: Run grouping tests and verify they fail**

Run:

```bash
cd /Users/wq/LinkBox/mobile
node --test src/utils/imageBatchGallery.test.mjs
```

Expected: FAIL because `imageBatchGallery.js` does not exist.

- [x] **Step 3: Implement grouping helper**

Create `mobile/src/utils/imageBatchGallery.js`:

```js
export function groupImageBatches(files = []) {
  const batchCounts = new Map()
  for (const file of files) {
    if (file?.type !== 'image' || !file.batch_id) continue
    batchCounts.set(file.batch_id, (batchCounts.get(file.batch_id) || 0) + 1)
  }

  const emitted = new Set()
  return files.flatMap(file => {
    if (file?.type !== 'image' || !file.batch_id || batchCounts.get(file.batch_id) < 2) {
      return [{ kind: 'item', id: `item:${file.id}`, file }]
    }
    if (emitted.has(file.batch_id)) return []
    emitted.add(file.batch_id)
    const images = files
      .filter(candidate => candidate?.type === 'image' && candidate.batch_id === file.batch_id)
      .sort((a, b) => Number(a.batch_index || 0) - Number(b.batch_index || 0) || Number(a.id) - Number(b.id))

    return [{
      kind: 'image-batch',
      id: `batch:${file.batch_id}`,
      batchId: file.batch_id,
      activeIndex: 0,
      images,
      created_at: images[0]?.created_at || file.created_at,
    }]
  })
}
```

- [x] **Step 4: Run grouping tests and verify they pass**

Run:

```bash
cd /Users/wq/LinkBox/mobile
node --test src/utils/imageBatchGallery.test.mjs
```

Expected: PASS.

- [x] **Step 5: Commit grouping helper**

```bash
cd /Users/wq/LinkBox
git add mobile/src/utils/imageBatchGallery.js mobile/src/utils/imageBatchGallery.test.mjs
git commit -m "feat: group mobile image batches"
```

## Task 3: Mobile Upload Metadata

**Files:**
- Modify: `mobile/src/api/files.js`
- Modify: `mobile/src/views/Home.vue`

- [x] **Step 1: Update upload API to accept metadata**

In `mobile/src/api/files.js`, replace `uploadFile` with:

```js
export async function uploadFile(file, analyzeNow = false, metadata = {}) {
  const form = new FormData()
  form.append('file', file)
  form.append('analyze_now', analyzeNow ? 'true' : 'false')
  if (metadata.batchId) form.append('batch_id', metadata.batchId)
  if (metadata.batchIndex !== undefined) form.append('batch_index', String(metadata.batchIndex))
  const { data } = await api.post('/mobile/files/upload', form)
  return data
}
```

- [x] **Step 2: Generate batch metadata in Home file selection**

In `mobile/src/views/Home.vue`, add helpers near the existing constants:

```js
function isImageUpload(file) {
  return file?.type?.startsWith('image/')
}

function createImageBatchId() {
  return `imgbatch-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`
}
```

Replace `handleFileSelect` with:

```js
async function handleFileSelect(e) {
  const list = [...e.target.files]
  e.target.value = ''
  const imageFiles = list.filter(isImageUpload)
  const batchId = imageFiles.length > 1 ? createImageBatchId() : ''
  let imageIndex = 0
  for (const f of list) {
    const metadata = batchId && isImageUpload(f)
      ? { batchId, batchIndex: imageIndex++ }
      : {}
    await doUpload(f, null, metadata)
  }
}
```

Replace the paste upload branch with:

```js
      if (f) {
        handledFile = true
        await doUpload(f, null, {})
      }
```

Replace `doUpload` signature and upload call:

```js
async function doUpload(file, url, metadata = {}) {
```

```js
    if (file) await uploadFile(file, analyzeNow.value, metadata)
```

- [x] **Step 3: Build mobile app**

Run:

```bash
cd /Users/wq/LinkBox/mobile
npm run build
```

Expected: PASS.

- [x] **Step 4: Commit upload metadata**

```bash
cd /Users/wq/LinkBox
git add mobile/src/api/files.js mobile/src/views/Home.vue
git commit -m "feat: tag mobile multi-image uploads"
```

## Task 4: Gallery Card Rendering

**Files:**
- Create: `mobile/src/components/ImageBatchCard.vue`
- Modify: `mobile/src/views/Home.vue`

- [x] **Step 1: Create gallery component**

Create `mobile/src/components/ImageBatchCard.vue`:

```vue
<template>
  <div
    class="image-batch-card"
    @touchstart.passive="onTouchStart"
    @touchmove.passive="onTouchMove"
    @touchend.passive="onTouchEnd"
    @click="$emit('open', activeImage)"
  >
    <div class="stack-layer layer-two"></div>
    <div class="stack-layer layer-one"></div>
    <div class="image-stage" :class="bgClass">
      <img :src="downloadUrl(activeImage.id)" class="batch-image" loading="lazy" @error="event => event.target.style.display = 'none'" />
      <div class="batch-count">{{ activeIndex + 1 }} / {{ images.length }}</div>
    </div>
    <div class="batch-footer">
      <span class="batch-title">{{ activeImage.original_filename }}</span>
      <span class="status-dot" :class="activeImage.status"></span>
    </div>
    <div class="batch-dots" aria-hidden="true">
      <span v-for="(_, index) in images" :key="index" :class="{ active: index === activeIndex }"></span>
    </div>
  </div>
</template>

<script setup>
import { computed, ref } from 'vue'
import { downloadUrl } from '../api/files'

const props = defineProps({
  images: { type: Array, required: true },
})
defineEmits(['open'])

const activeIndex = ref(0)
const activeImage = computed(() => props.images[activeIndex.value] || props.images[0] || {})
const bgClass = computed(() => ['img-bg-a', 'img-bg-b', 'img-bg-c'][String(activeImage.value.id || '0').charCodeAt(0) % 3])

let startX = 0
let startY = 0
function onTouchStart(event) {
  startX = event.touches[0].clientX
  startY = event.touches[0].clientY
}
function onTouchMove() {}
function onTouchEnd(event) {
  const dx = event.changedTouches[0].clientX - startX
  const dy = event.changedTouches[0].clientY - startY
  if (Math.abs(dx) <= Math.abs(dy) + 8 || Math.abs(dx) < 34) return
  if (dx < 0) activeIndex.value = Math.min(props.images.length - 1, activeIndex.value + 1)
  else activeIndex.value = Math.max(0, activeIndex.value - 1)
}
</script>

<style scoped>
.image-batch-card {
  position: relative;
  width: 205px;
  border-radius: 15px;
  color: var(--text);
  isolation: isolate;
}
.stack-layer {
  position: absolute;
  inset: 7px 6px 18px;
  border: 1px solid var(--border);
  border-radius: 15px;
  background: var(--s2);
  z-index: -1;
}
.layer-one { transform: translate(7px, -5px) rotate(2deg); opacity: .72; }
.layer-two { transform: translate(13px, -9px) rotate(4deg); opacity: .38; }
.image-stage {
  position: relative;
  height: 132px;
  border: 1px solid var(--border);
  border-radius: 15px 15px 10px 10px;
  overflow: hidden;
  background: var(--s2);
}
.batch-image {
  width: 100%;
  height: 100%;
  object-fit: cover;
  display: block;
}
.batch-count {
  position: absolute;
  right: 8px;
  top: 8px;
  min-width: 38px;
  height: 22px;
  border-radius: 11px;
  background: rgba(0,0,0,.52);
  color: #fff;
  font-size: 11px;
  font-weight: 700;
  display: flex;
  align-items: center;
  justify-content: center;
}
.batch-footer {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 6px 10px 4px;
  border: 1px solid var(--border);
  border-top: none;
  border-radius: 0 0 15px 15px;
  background: var(--s2);
}
.batch-title {
  flex: 1;
  min-width: 0;
  color: var(--text3);
  font-size: 11px;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.batch-dots {
  display: flex;
  justify-content: center;
  gap: 4px;
  padding-top: 5px;
}
.batch-dots span {
  width: 4px;
  height: 4px;
  border-radius: 50%;
  background: var(--text3);
  opacity: .35;
}
.batch-dots span.active {
  width: 12px;
  border-radius: 4px;
  background: var(--accent);
  opacity: 1;
}
.img-bg-a { background: linear-gradient(135deg, rgba(139,114,255,.25), rgba(94,234,181,.15)); }
.img-bg-b { background: linear-gradient(135deg, rgba(255,170,92,.2), rgba(255,110,122,.15)); }
.img-bg-c { background: linear-gradient(135deg, rgba(100,170,255,.2), rgba(94,234,181,.12)); }
</style>
```

- [x] **Step 2: Render grouped gallery items in Home**

In `mobile/src/views/Home.vue`, import:

```js
import ImageBatchCard from '../components/ImageBatchCard.vue'
import { groupImageBatches } from '../utils/imageBatchGallery'
```

Change `dateGroups` so `files:` uses grouped feed items:

```js
    files: groupImageBatches(map[date].sort((a, b) => Number(a.id) - Number(b.id))),
```

In the template, change the row key:

```vue
            :key="f.id"
```

continues to work because grouped items have ids. Replace item references inside the row by branching first:

```vue
              <ImageBatchCard
                v-if="f.kind === 'image-batch'"
                :images="f.images"
                :style="{ transform: `translateX(${swipe[f.id] || 0}px)` }"
                @open="handleCardClick"
              />
```

Then wrap all existing item branches with `v-else-if="f.file.type === 'image'"`, `f.file.type === 'link'`, and so on, replacing existing `f` field reads in those branches with `f.file`.

Change time display:

```vue
            <div class="fm-time">{{ timeStr(f.created_at || f.file?.created_at) }}</div>
```

Change delete button target:

```vue
                @click.stop="confirmDelete(f.kind === 'image-batch' ? f.images[0] : f.file)"
```

- [x] **Step 3: Adjust helpers for grouped item shape**

In `Home.vue`, add:

```js
function rowFile(row) {
  return row.kind === 'image-batch' ? row.images[0] : row.file
}
```

Use `rowFile(f)` for delete and any generic field access that cannot be grouped.

- [x] **Step 4: Build mobile app**

Run:

```bash
cd /Users/wq/LinkBox/mobile
npm run build
```

Expected: PASS.

- [x] **Step 5: Commit gallery rendering**

```bash
cd /Users/wq/LinkBox
git add mobile/src/components/ImageBatchCard.vue mobile/src/views/Home.vue
git commit -m "feat: render mobile image batch galleries"
```

## Task 5: Verification And Deployment

**Files:**
- Verify all changed files.

- [x] **Step 1: Run targeted tests**

```bash
cd /Users/wq/LinkBox/server
npm test -- test/dbMigrations.test.mjs test/linkCreateService.test.mjs test/mobileFilePresenter.test.mjs
cd /Users/wq/LinkBox/mobile
node --test src/utils/imageBatchGallery.test.mjs
npm run build
```

Expected: all commands PASS.

- [x] **Step 2: Run backend full tests**

```bash
cd /Users/wq/LinkBox/server
npm test
```

Expected: all tests PASS.

- [x] **Step 3: Commit any verification cleanup**

If verification required cleanup, commit it:

```bash
cd /Users/wq/LinkBox
git status --short
git add <changed-files>
git commit -m "test: verify mobile image batch gallery"
```

If there are no changes, skip this step.

- [x] **Step 4: Push and deploy**

```bash
cd /Users/wq/LinkBox
git push origin main
```

Then deploy to `/home/wq/LinkBox` using the existing Docker Compose deployment runbook and verify:

```bash
curl -fsS -o /dev/null -w 'public_root=%{http_code}\n' http://150.158.146.192:6057/
curl -fsS -o /dev/null -w 'public_mobile=%{http_code}\n' http://150.158.146.192:6057/mobile/
```

Expected: both return `200`.
