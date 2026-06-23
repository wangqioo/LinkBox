# Mobile Frontend

Last updated: 2026-06-24

The mobile frontend lives in `mobile/`. It is a Vue 3 + Vite app served by the
Express backend at `/mobile/` in production and by Vite during development.

## Run

Start the backend:

```bash
cd server
npm run dev
```

Start the mobile UI:

```bash
cd mobile
npm run dev
```

Development URL:

```text
http://localhost:5173
```

Production URL when served by the backend:

```text
http://localhost:3100/mobile/
```

The current home-server public URL is:

```text
http://150.158.146.192:6057/mobile/
```

## Main Screens

| Screen | File | Purpose |
| --- | --- | --- |
| Home | `mobile/src/views/Home.vue` | Main personal feed, upload, text-to-self, menus, comments |
| File detail | `mobile/src/views/FileDetail.vue` | Detail view, image batch carousel, per-image comments, article/video/document content |
| Friends and groups | `mobile/src/views/Friends.vue` | Contact list, private chats, group chats, group tools, chat material cards |
| Assistant | `mobile/src/components/ChatBox.vue` | Personal or group-scoped AI assistant |
| Categories | `mobile/src/views/Category.vue`, `DayFiles.vue` | Filtered mobile file views |

## Personal Feed Behavior

- The bottom input accepts plain text or allowlisted shared links.
- Input and paste never auto-send. Users must press send.
- WeChat, Zhihu, and Bilibili allowlisted URLs are extracted from shared text.
- Generic URLs inside mixed text are saved as text notes instead of fetched.
- Long text inputs auto-grow up to a bounded height.
- Text, filenames, summaries, comments, and message bodies are selectable for
  native copy.
- File, link, image, and batch cards use a three-dot overlay menu for actions.
- Left-swipe delete is not used; delete lives in the action sheet.

## Image Batches

Multi-image uploads share a generated `batch_id` and ordered `batch_index`.
The home feed groups same-batch images into one stacked photo card through
`mobile/src/utils/imageBatchGallery.js`.

Comment rules:

- Commenting from the home feed batch menu updates every image in that batch.
- Opening detail from a batch shows all images in a swipeable carousel.
- Detail comments are per-image. Editing one image in detail does not rewrite
  the rest of the batch.

Related API helpers live in `mobile/src/api/files.js`:

- `updateBatchComment(batchId, comment)`
- `getImageBatch(batchId)`

## Friends, Private Chats, And Groups

`Friends.vue` owns the mobile social UI:

- Contact list shows accepted friends, pending friend requests, and groups.
- Tapping a contact opens a direct private chat.
- The top-right `+` creates groups or adds friends.
- Private and group chats can send text, upload files, upload multi-image
  batches, and send existing personal materials.
- Sent text messages render as adaptive-width bubbles.
- Material messages reuse the personal feed card format, including image
  batches, link previews, comments, and the same three-dot overlay action menu.
- Message direction is based on the current logged-in user returned by the API,
  not on who created the group.
- Text input uses `Enter` to send and `Shift+Enter` for a newline.

The bottom-left chat `+` is intentionally small:

- Upload file.
- Send existing material.

Other group tools live in the top-right menu.

## Group Assistant

The same `ChatBox.vue` component powers personal and group assistants. When a
`groupId` prop is passed, `streamAssistant` sends that group id to the backend.

Group assistant behavior:

- It only retrieves content from the current group.
- It can use group-shared links/files/images, group-uploaded chat materials,
  group material notes, material comments, and group text messages.
- It does not read the user's personal-only library or other groups.
- Group text-message sources are displayed as references but are not opened as
  file details.

## Assistant History

`ChatBox.vue` keeps Assistant history in backend conversations:

- The history bar can start a new conversation, open an existing conversation,
  or delete the active conversation.
- Personal Assistant conversations are stored separately from group Assistant
  conversations.
- The first question becomes the default conversation title.
- Saved messages include user turns, assistant turns, errors, and citation
  sources.
- Loading a conversation restores the visible messages and source cards.
- Saved history is not currently injected into the next prompt; retrieval still
  depends on the current question and selected personal/group scope.

## Auto-Growing Textareas

Mobile long-text inputs use `mobile/src/components/AutoGrowTextarea.vue`.

Current usages:

- Home feed send box.
- Home feed comment sheet.
- File detail image comment.
- Private/group chat send box.
- Group description.
- Chat material comment sheet.
- Personal/group Assistant input.

Short inputs such as username, password, search, group name, dates, and file
titles remain single-line fields.

## Validation

Run before shipping mobile UI changes:

```bash
cd mobile
npm run build

cd ..
node --test \
  mobile/src/utils/imageBatchGallery.test.mjs \
  mobile/src/utils/groupChatDisplay.test.mjs \
  mobile/src/utils/socialConversations.test.mjs

git diff --check
```

Known non-fatal warning: direct Node execution of mobile ES modules can print
`MODULE_TYPELESS_PACKAGE_JSON` because `mobile/package.json` does not declare
`"type": "module"`. Vite production builds are unaffected.
