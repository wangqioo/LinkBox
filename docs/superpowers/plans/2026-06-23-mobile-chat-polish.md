# Mobile Chat Polish Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix mobile batch-image comments and detail viewing, make mobile text copyable, remove obsolete upload analysis controls, require explicit send, and complete group chat alignment, sharing, and AI access.

**Architecture:** Keep the existing Vue mobile app and Express routes. Add small pure helpers for batch comments and current-user message alignment, then wire them into `Home.vue`, `FileDetail.vue`, `Friends.vue`, `mobile/src/api/files.js`, and `server/routes/social.js`.

**Tech Stack:** Vue 3, Vue Router, Express, SQLite, Node test runner, Vite.

---

### Task 1: Batch Image Comment Rules

**Files:**
- Modify: `mobile/src/utils/imageBatchGallery.js`
- Test: `mobile/src/utils/imageBatchGallery.test.mjs`
- Modify: `mobile/src/views/Home.vue`
- Modify: `server/routes/mobileFiles.js`

- [ ] Add tests that batch rows expose a shared comment target and all image IDs in the batch.
- [ ] Add a backend endpoint `PUT /api/mobile/files/batch/:batchId/comment` that updates all images in the caller's batch.
- [ ] In `Home.vue`, make long-press/menu comment on an image batch call the batch endpoint and update all local images in that batch.
- [ ] Keep single image comments unchanged outside batch rows.

### Task 2: Batch Image Detail Carousel

**Files:**
- Modify: `mobile/src/router/index.js`
- Modify: `mobile/src/api/files.js`
- Modify: `mobile/src/views/FileDetail.vue`
- Test: `mobile/src/utils/imageBatchGallery.test.mjs`

- [ ] Add API helper to fetch files by `batch_id`.
- [ ] Pass `batchId` from batch cards to detail route query.
- [ ] In detail view, when `batchId` is present, load the batch and show a swipeable image carousel.
- [ ] Detail view comments stay per-image: editing a selected image comment updates only that image.

### Task 3: Copyable Text And Action Menu

**Files:**
- Modify: `mobile/src/views/Home.vue`
- Modify: `mobile/src/views/FileDetail.vue`
- Modify: `mobile/src/views/Friends.vue`
- Modify: `mobile/src/App.vue` or shared mobile CSS if needed

- [ ] Add selectable text styling for message bodies, comments, summaries, markdown bodies, filenames, links, and group messages.
- [ ] Replace card long-press direct-comment behavior with a bottom action menu containing `留言` and `删除`.
- [ ] Do not open the action menu when the long-press starts on selectable text.
- [ ] Remove left-swipe delete UI and image-card inline delete button.

### Task 4: Home Input And Settings Cleanup

**Files:**
- Modify: `mobile/src/views/Home.vue`
- Modify: `mobile/src/api/files.js`

- [ ] Remove the `analyzeNow` setting row and state.
- [ ] Upload files and links with `analyze_now=false` consistently.
- [ ] Change paste handling so pasted text is inserted into the input instead of auto-sent.
- [ ] Keep explicit send behavior for both plain text and allowlisted links.

### Task 5: Group Chat Current User And Material Messages

**Files:**
- Modify: `server/routes/social.js`
- Modify: `mobile/src/api/files.js`
- Modify: `mobile/src/views/Friends.vue`
- Test: `server/test/socialGroup.test.mjs`

- [ ] Make group message list return `current_user`.
- [ ] Use `current_user.id` for mine/other alignment and color.
- [ ] Add group material sharing UI that can select one of the user's existing files/links/images and share it to the active group.
- [ ] Render group material messages as cards in the group chat.

### Task 6: Group AI Assistant

**Files:**
- Modify: `mobile/src/components/ChatBox.vue`
- Modify: `mobile/src/views/Friends.vue`
- Modify: `mobile/src/api/files.js`

- [ ] Extend `ChatBox` to accept `groupId` and pass it through to `streamAssistant`.
- [ ] Add a group assistant panel/entry inside active group chat.
- [ ] Keep personal assistant behavior unchanged when no group is active.

### Task 7: Verification

**Files:**
- No production files.

- [ ] Run `cd mobile && npm run build`.
- [ ] Run focused mobile utility tests: `node --test mobile/src/utils/imageBatchGallery.test.mjs mobile/src/utils/mobileItemDisplay.test.mjs`.
- [ ] Run `cd server && npm test`.
- [ ] Run `git diff --check`.
