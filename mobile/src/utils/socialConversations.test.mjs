import test from 'node:test'
import assert from 'node:assert/strict'
import {
  buildConversationList,
  createEmptyComposerState,
  hasPendingRequests,
} from './socialConversations.js'

test('buildConversationList places pending friend requests before chats', () => {
  const friends = [
    { id: 1, status: 'accepted', user: { id: 11, username: 'alice' } },
    { id: 2, status: 'pending', direction: 'incoming', user: { id: 12, username: 'bob' } },
    { id: 3, status: 'pending', direction: 'outgoing', user: { id: 13, username: 'cora' } },
  ]
  const groups = [
    { id: 7, name: '产品群', member_count: 3, material_count: 4 },
  ]

  assert.deepEqual(buildConversationList({ friends, groups }), [
    {
      id: 'friend-requests',
      type: 'requests',
      title: '好友请求',
      subtitle: '1 个待处理，1 个已发送',
      badge: 1,
    },
    {
      id: 'friend:1',
      type: 'friend',
      title: 'alice',
      subtitle: '好友',
      avatarText: 'A',
      friend: friends[0],
    },
    {
      id: 'group:7',
      type: 'group',
      title: '产品群',
      subtitle: '3 人 · 4 条资料',
      avatarText: '群',
      group: groups[0],
    },
  ])
})

test('hasPendingRequests only counts incoming pending friend rows', () => {
  assert.equal(hasPendingRequests([
    { status: 'pending', direction: 'outgoing' },
    { status: 'accepted', direction: 'incoming' },
  ]), false)
  assert.equal(hasPendingRequests([
    { status: 'pending', direction: 'incoming' },
  ]), true)
})

test('createEmptyComposerState returns closed sheets with empty fields', () => {
  assert.deepEqual(createEmptyComposerState(), {
    mode: null,
    friendName: '',
    groupName: '',
    groupDescription: '',
    selectedMemberIds: [],
  })
})
