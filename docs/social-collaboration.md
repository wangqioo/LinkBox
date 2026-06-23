# Social Collaboration

Last updated: 2026-06-24

LinkBox includes a lightweight social layer for trusted users: friends,
private chats, group chats, shared materials, and group-scoped AI assistants.

## Data Model

| Table | Purpose |
| --- | --- |
| `friendships` | Friend requests and accepted friendships |
| `direct_messages` | One-to-one chat messages |
| `groups` | Group metadata, owner, and agent name |
| `group_members` | Group membership and member role |
| `group_messages` | Group text messages |
| `group_links` | Materials shared into a group, with per-group note |
| `links.scope` | Item visibility scope, usually `personal` or `chat` |

Personal library items use `scope = 'personal'`. Materials uploaded directly
inside private chats or group chats use `scope = 'chat'`. Chat-scoped materials
are not shown in the normal personal home feed, but remain accessible from the
chat that owns them.

## API Surface

All routes require JWT authentication.

| Method | Path | Purpose |
| --- | --- | --- |
| `GET` | `/api/social/friends` | List accepted, incoming, and outgoing friends |
| `POST` | `/api/social/friends` | Send or re-accept a friend request by username |
| `POST` | `/api/social/friends/:id/accept` | Accept an incoming request |
| `DELETE` | `/api/social/friends/:id` | Remove a friendship |
| `GET` | `/api/social/friends/:userId/messages` | Read direct chat messages |
| `POST` | `/api/social/friends/:userId/messages` | Send direct text message |
| `POST` | `/api/social/friends/:userId/materials` | Share an existing owned material to a direct chat |
| `POST` | `/api/social/friends/:userId/uploads` | Upload a new chat-scoped material to a direct chat |
| `PUT` | `/api/social/friends/:userId/materials/:linkId/comment` | Update comment on direct chat material |
| `DELETE` | `/api/social/friends/:userId/messages/:messageId` | Delete the caller's direct message |
| `GET` | `/api/social/groups` | List groups visible to the caller |
| `POST` | `/api/social/groups` | Create a group and invite accepted friends |
| `GET` | `/api/social/groups/:groupId` | Read group metadata and members |
| `POST` | `/api/social/groups/:groupId/members` | Invite an accepted friend |
| `GET` | `/api/social/groups/:groupId/messages` | Read group messages and material messages |
| `POST` | `/api/social/groups/:groupId/messages` | Send group text message |
| `GET` | `/api/social/groups/:groupId/materials` | Read materials shared into the group |
| `POST` | `/api/social/groups/:groupId/materials` | Share an existing owned material into the group |
| `POST` | `/api/social/groups/:groupId/uploads` | Upload a new chat-scoped material into the group |
| `PUT` | `/api/social/groups/:groupId/materials/:linkId/comment` | Update comment on group material |
| `DELETE` | `/api/social/groups/:groupId/messages/:messageId` | Delete a group message when permitted |

## Permissions

- Only accepted friends can exchange direct messages or direct materials.
- Only accepted friends can be invited to a group.
- Only group members can read or write group messages and group materials.
- Group owners/admins can invite members.
- Group owners can delete any group message; members can delete their own
  messages.
- Direct chat users can delete only their own direct messages.

## Message Rendering Contract

Message alignment must always be based on the current logged-in user:

- Current user's messages: right side, accent color.
- Other users' messages: left side, neutral color.

Do not infer ownership from group creator, group owner, or the first message in
a thread. The backend returns current-user metadata where the mobile client
needs it, and `mobile/src/utils/groupChatDisplay.js` centralizes the comparison.

Material messages should render with the same card language as personal feed
materials:

- file icon/type label
- image preview or image batch stack
- link/article preview when available
- comment preview
- three-dot overlay action menu
- open detail action

## Group Assistant Scope

Personal Assistant and group Assistant are intentionally isolated.

Personal Assistant:

- Reads `links` rows owned by the user with personal scope.
- Uses canonical documents, embeddings, and legacy chunks according to the
  normal retrieval pipeline.
- Does not read chat-only materials unless they have been explicitly promoted
  into the personal library by a future feature.

Group Assistant:

- Reads only the active group.
- Retrieves materials through `group_links -> links`.
- Includes chat-scoped group uploads.
- Includes `group_links.note` as "群资料说明".
- Includes `links.comment` as "留言".
- Includes `group_messages` text rows as virtual sources.
- Applies the same date/time scope to group text messages and group materials.
- Returns virtual group text sources with `link_id = null` so clients do not
  try to open them as file details.

The backend implementation lives mainly in:

- `server/routes/social.js`
- `server/utils/assistantRetrieval.js`
- `server/utils/assistantTurn.js`
- `server/db.js`

Key tests:

```bash
node --test \
  server/test/socialGroup.test.mjs \
  server/test/socialDirectMessages.test.mjs \
  server/test/assistantTurn.test.mjs
```

`socialDirectMessages.test.mjs` starts a local HTTP listener. In restricted
sandboxes it may need permission to bind `127.0.0.1`.

## Frontend Entry Points

Mobile:

- `mobile/src/views/Friends.vue`
- `mobile/src/components/ChatBox.vue`
- `mobile/src/utils/groupChatDisplay.js`
- `mobile/src/utils/socialConversations.js`

Desktop web:

- `client/src/pages/SocialPage.tsx`
- `client/src/components/AutoGrowTextarea.tsx`

## UX Rules

- Clicking a contact in the mobile Friends home opens the direct chat.
- Creating a group belongs under the top-right `+` flow.
- The chat bottom-left `+` has only upload file and send existing material.
- Group tools, group materials, and group Assistant belong in the top-right
  chat tools menu.
- Long text inputs auto-grow. Short identity/search/title/date inputs stay
  single-line.
- Text content should remain selectable for native copy.
