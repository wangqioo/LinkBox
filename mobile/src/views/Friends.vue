<template>
  <div class="friends-page">
    <header class="friends-hdr">
      <button class="nav-btn" @click="$router.back()" aria-label="返回">
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.1" stroke-linecap="round" stroke-linejoin="round"><path d="M15 18l-6-6 6-6" /></svg>
      </button>
      <div class="friends-title">好友与群组</div>
      <button class="nav-btn" @click="reload" aria-label="刷新">
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.1" stroke-linecap="round" stroke-linejoin="round"><path d="M21 12a9 9 0 1 1-2.64-6.36"/><path d="M21 3v6h-6"/></svg>
      </button>
    </header>

    <main class="social-body">
      <div v-if="error" class="notice error">{{ error }}</div>
      <div v-if="toast" class="notice ok">{{ toast }}</div>

      <section class="panel add-panel">
        <div class="panel-title">加好友</div>
        <form class="inline-form" @submit.prevent="submitFriend">
          <input v-model.trim="friendName" placeholder="输入对方用户名" />
          <button :disabled="!friendName || busy">添加</button>
        </form>
      </section>

      <section class="panel">
        <div class="panel-head">
          <div>
            <div class="panel-title">好友</div>
            <div class="panel-sub">只展示真实好友关系，不再使用假会话。</div>
          </div>
          <span class="count">{{ acceptedFriends.length }}</span>
        </div>
        <div v-if="incomingFriends.length" class="request-list">
          <div v-for="friend in incomingFriends" :key="friend.id" class="request-row">
            <span>{{ friend.user?.username }}</span>
            <button @click="accept(friend.id)">通过</button>
          </div>
        </div>
        <div class="chip-list">
          <button v-for="friend in acceptedFriends" :key="friend.id" class="friend-chip" :class="{ selected: selectedMemberIds.includes(friend.user.id) }" @click="toggleMember(friend.user.id)">
            <span class="avatar">{{ initial(friend.user?.username) }}</span>
            <span>{{ friend.user?.username }}</span>
          </button>
        </div>
        <div v-if="outgoingFriends.length" class="pending">待通过：{{ outgoingFriends.map(f => f.user?.username).join('、') }}</div>
        <div v-if="!friends.length && !loading" class="empty">还没有好友，先通过用户名添加。</div>
      </section>

      <section class="panel">
        <div class="panel-title">建群聊</div>
        <form class="group-form" @submit.prevent="submitGroup">
          <input v-model.trim="groupName" placeholder="群名称" />
          <textarea v-model.trim="groupDescription" placeholder="群说明，可不填" />
          <div class="hint">点选上面的好友后创建群。群资料库与个人资料库隔离。</div>
          <button :disabled="!groupName || busy">创建群</button>
        </form>
      </section>

      <section class="panel groups-panel">
        <div class="panel-head">
          <div>
            <div class="panel-title">群聊</div>
            <div class="panel-sub">群消息和群资料助理都走真实接口。</div>
          </div>
          <span class="count">{{ groups.length }}</span>
        </div>
        <div class="group-list">
          <button v-for="group in groups" :key="group.id" class="group-row" :class="{ active: activeGroup?.id === group.id }" @click="openGroup(group)">
            <span class="avatar group">群</span>
            <span class="group-main">
              <strong>{{ group.name }}</strong>
              <em>{{ group.member_count || 1 }} 人 · {{ group.material_count || 0 }} 条资料</em>
            </span>
          </button>
        </div>
        <div v-if="!groups.length && !loading" class="empty">还没有群，创建一个开始聊天。</div>
      </section>

      <section v-if="activeGroup" class="panel chat-panel">
        <div class="chat-title-row">
          <div>
            <div class="panel-title">{{ activeGroup.name }}</div>
            <div class="panel-sub">{{ activeGroup.description || '这个群还没有说明' }}</div>
          </div>
          <button class="ghost" @click="activeGroup = null">收起</button>
        </div>
        <div class="messages">
          <div v-for="msg in messages" :key="msg.id" class="msg" :class="{ mine: msg.user_id === currentUserId }">
            <span class="msg-name">{{ msg.user?.username || msg.username }}</span>
            <span class="msg-body">{{ msg.body }}</span>
          </div>
          <div v-if="!messages.length" class="empty small">还没有群消息。</div>
        </div>
        <form class="chat-input" @submit.prevent="submitMessage">
          <input v-model.trim="messageText" placeholder="发一条群消息" />
          <button :disabled="!messageText || busy">发送</button>
        </form>
      </section>
    </main>
  </div>
</template>

<script setup>
import { computed, onMounted, ref } from 'vue'
import {
  acceptFriend,
  addFriend,
  createGroup,
  getFriends,
  getGroupMessages,
  getGroups,
  sendGroupMessage,
} from '../api/files'

const loading = ref(false)
const busy = ref(false)
const error = ref('')
const toast = ref('')
const friends = ref([])
const groups = ref([])
const activeGroup = ref(null)
const messages = ref([])
const friendName = ref('')
const groupName = ref('')
const groupDescription = ref('')
const selectedMemberIds = ref([])
const messageText = ref('')
const currentUserId = ref(null)

const acceptedFriends = computed(() => friends.value.filter(f => f.status === 'accepted'))
const incomingFriends = computed(() => friends.value.filter(f => f.status === 'pending' && f.direction === 'incoming'))
const outgoingFriends = computed(() => friends.value.filter(f => f.status === 'pending' && f.direction === 'outgoing'))

function initial(name = '') {
  return String(name || '?').slice(0, 1).toUpperCase()
}

function notify(text) {
  toast.value = text
  window.setTimeout(() => { if (toast.value === text) toast.value = '' }, 1800)
}

async function reload() {
  loading.value = true
  error.value = ''
  try {
    const [friendRows, groupRows] = await Promise.all([getFriends(), getGroups()])
    friends.value = friendRows
    groups.value = groupRows
    if (activeGroup.value) {
      const fresh = groupRows.find(g => g.id === activeGroup.value.id)
      if (fresh) await openGroup(fresh)
    }
  } catch (e) {
    error.value = e?.response?.data?.error || e.message || '加载好友和群组失败'
  } finally {
    loading.value = false
  }
}

async function submitFriend() {
  if (!friendName.value || busy.value) return
  busy.value = true
  error.value = ''
  try {
    const result = await addFriend(friendName.value)
    friendName.value = ''
    notify(result.status === 'accepted' ? '已成为好友' : '好友请求已发送')
    await reload()
  } catch (e) {
    error.value = e?.response?.data?.error || e.message || '添加好友失败'
  } finally {
    busy.value = false
  }
}

async function accept(id) {
  busy.value = true
  error.value = ''
  try {
    await acceptFriend(id)
    notify('已通过好友请求')
    await reload()
  } catch (e) {
    error.value = e?.response?.data?.error || e.message || '通过好友失败'
  } finally {
    busy.value = false
  }
}

function toggleMember(id) {
  selectedMemberIds.value = selectedMemberIds.value.includes(id)
    ? selectedMemberIds.value.filter(item => item !== id)
    : [...selectedMemberIds.value, id]
}

async function submitGroup() {
  if (!groupName.value || busy.value) return
  busy.value = true
  error.value = ''
  try {
    const result = await createGroup({
      name: groupName.value,
      description: groupDescription.value,
      agent_name: '群资料助理',
      member_ids: selectedMemberIds.value,
    })
    groupName.value = ''
    groupDescription.value = ''
    selectedMemberIds.value = []
    await reload()
    const group = groups.value.find(g => g.id === result.id)
    if (group) await openGroup(group)
    notify('群聊已创建')
  } catch (e) {
    error.value = e?.response?.data?.error || e.message || '创建群失败'
  } finally {
    busy.value = false
  }
}

async function openGroup(group) {
  activeGroup.value = group
  error.value = ''
  try {
    messages.value = await getGroupMessages(group.id)
    const mine = messages.value.find(m => m.user?.id === m.user_id)
    if (mine) currentUserId.value = mine.user_id
  } catch (e) {
    error.value = e?.response?.data?.error || e.message || '加载群消息失败'
  }
}

async function submitMessage() {
  if (!activeGroup.value || !messageText.value || busy.value) return
  busy.value = true
  error.value = ''
  try {
    const msg = await sendGroupMessage(activeGroup.value.id, messageText.value)
    currentUserId.value = msg.user_id
    messages.value.push(msg)
    messageText.value = ''
    await reload()
  } catch (e) {
    error.value = e?.response?.data?.error || e.message || '发送消息失败'
  } finally {
    busy.value = false
  }
}

onMounted(reload)
</script>

<style scoped>
.friends-page { height: 100%; background: var(--bg); color: var(--text); display: flex; flex-direction: column; overflow: hidden; }
.friends-hdr { height: var(--header-h); flex-shrink: 0; display: flex; align-items: flex-end; gap: 12px; padding: 0 16px 12px; background: var(--bg-blur); backdrop-filter: blur(20px); -webkit-backdrop-filter: blur(20px); border-bottom: 1px solid var(--border); }
.friends-title { flex: 1; height: 36px; line-height: 36px; font-size: 18px; font-weight: 800; min-width: 0; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.nav-btn { width: 36px; height: 36px; border: 0; border-radius: 50%; background: var(--s2); color: var(--text2); display: flex; align-items: center; justify-content: center; }
.social-body { flex: 1; min-height: 0; overflow-y: auto; padding: 12px 14px 24px; display: flex; flex-direction: column; gap: 12px; }
.panel { border: 1px solid var(--border2); border-radius: 18px; background: var(--s2); padding: 13px; }
.panel-head, .chat-title-row { display: flex; align-items: flex-start; justify-content: space-between; gap: 10px; }
.panel-title { font-size: 15px; font-weight: 800; }
.panel-sub, .hint, .pending { margin-top: 4px; color: var(--text3); font-size: 11px; line-height: 1.5; }
.count { min-width: 26px; height: 24px; border-radius: 999px; background: var(--accent-s); color: var(--accent); display: flex; align-items: center; justify-content: center; font-size: 12px; font-weight: 800; }
.notice { border-radius: 12px; padding: 9px 11px; font-size: 12px; line-height: 1.45; }
.notice.error { background: rgba(255,110,122,.13); color: var(--red); }
.notice.ok { background: var(--teal-s); color: var(--teal); }
.inline-form, .chat-input { display: flex; gap: 8px; }
.group-form { display: flex; flex-direction: column; gap: 9px; margin-top: 10px; }
input, textarea { width: 100%; min-width: 0; border: 0; outline: 0; border-radius: 12px; background: var(--s1); color: var(--text); font: inherit; font-size: 13px; padding: 10px 11px; }
textarea { min-height: 68px; resize: none; line-height: 1.45; }
button { border: 0; font: inherit; }
.inline-form button, .group-form button, .chat-input button, .request-row button { flex: 0 0 auto; border-radius: 12px; background: var(--accent); color: #fff; font-weight: 800; font-size: 13px; padding: 0 13px; }
.group-form button { height: 40px; }
button:disabled { opacity: .42; }
.chip-list { display: flex; flex-wrap: wrap; gap: 8px; margin-top: 12px; }
.friend-chip { display: flex; align-items: center; gap: 7px; border-radius: 999px; padding: 6px 9px 6px 6px; background: var(--s1); color: var(--text); border: 1px solid transparent; }
.friend-chip.selected { border-color: var(--accent); background: var(--accent-s); }
.avatar { width: 28px; height: 28px; border-radius: 9px; background: var(--accent); color: #fff; display: inline-flex; align-items: center; justify-content: center; font-size: 13px; font-weight: 900; }
.avatar.group { background: var(--orange); }
.request-list { display: flex; flex-direction: column; gap: 7px; margin-top: 12px; }
.request-row { display: flex; align-items: center; justify-content: space-between; gap: 10px; padding: 8px 9px; border-radius: 12px; background: var(--s1); font-size: 13px; }
.group-list { display: flex; flex-direction: column; gap: 8px; margin-top: 12px; }
.group-row { width: 100%; display: flex; align-items: center; gap: 10px; padding: 9px; border-radius: 14px; background: var(--s1); color: var(--text); text-align: left; border: 1px solid transparent; }
.group-row.active { border-color: var(--accent); background: var(--accent-s); }
.group-main { min-width: 0; display: flex; flex-direction: column; gap: 3px; }
.group-main strong { font-size: 14px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.group-main em { color: var(--text3); font-size: 11px; font-style: normal; }
.empty { padding: 18px 0 8px; text-align: center; color: var(--text3); font-size: 12px; }
.empty.small { padding: 12px 0; }
.chat-panel { display: flex; flex-direction: column; gap: 12px; }
.ghost { background: var(--s1); color: var(--text2); border-radius: 999px; padding: 6px 10px; font-size: 12px; font-weight: 800; }
.messages { max-height: 310px; overflow-y: auto; display: flex; flex-direction: column; gap: 9px; padding: 2px; }
.msg { align-self: flex-start; max-width: 82%; display: flex; flex-direction: column; gap: 3px; }
.msg.mine { align-self: flex-end; }
.msg-name { color: var(--text3); font-size: 10px; padding: 0 3px; }
.msg-body { border-radius: 15px; border-bottom-left-radius: 5px; background: var(--s1); color: var(--text); padding: 9px 11px; font-size: 13px; line-height: 1.5; white-space: pre-wrap; word-break: break-word; }
.msg.mine .msg-body { border-bottom-left-radius: 15px; border-bottom-right-radius: 5px; background: var(--accent); color: #fff; }
.chat-input input { height: 39px; }
.chat-input button { height: 39px; }
</style>
