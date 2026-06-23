export function initial(name = '') {
  return String(name || '?').slice(0, 1).toUpperCase()
}

export function incomingFriendRequests(friends = []) {
  return friends.filter(friend => friend.status === 'pending' && friend.direction === 'incoming')
}

export function outgoingFriendRequests(friends = []) {
  return friends.filter(friend => friend.status === 'pending' && friend.direction === 'outgoing')
}

export function acceptedFriendRows(friends = []) {
  return friends.filter(friend => friend.status === 'accepted')
}

export function hasPendingRequests(friends = []) {
  return incomingFriendRequests(friends).length > 0
}

export function buildConversationList({ friends = [], groups = [] } = {}) {
  const incoming = incomingFriendRequests(friends)
  const outgoing = outgoingFriendRequests(friends)
  const rows = []

  if (incoming.length || outgoing.length) {
    rows.push({
      id: 'friend-requests',
      type: 'requests',
      title: '好友请求',
      subtitle: `${incoming.length} 个待处理，${outgoing.length} 个已发送`,
      badge: incoming.length,
    })
  }

  for (const friend of acceptedFriendRows(friends)) {
    const username = friend.user?.username || '好友'
    rows.push({
      id: `friend:${friend.id}`,
      type: 'friend',
      title: username,
      subtitle: '好友',
      avatarText: initial(username),
      friend,
    })
  }

  for (const group of groups) {
    rows.push({
      id: `group:${group.id}`,
      type: 'group',
      title: group.name || '未命名群聊',
      subtitle: `${group.member_count || 1} 人 · ${group.material_count || 0} 条资料`,
      avatarText: '群',
      group,
    })
  }

  return rows
}

export function createEmptyComposerState() {
  return {
    mode: null,
    friendName: '',
    groupName: '',
    groupDescription: '',
    selectedMemberIds: [],
  }
}
