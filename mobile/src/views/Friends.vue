<template>
  <div class="friends-page" @click="closeSheet">
    <template v-if="!activeFriend">
      <header class="friends-hdr">
        <button class="nav-btn" @click.stop="$router.back()" aria-label="返回">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.1" stroke-linecap="round" stroke-linejoin="round">
            <path d="M15 18l-6-6 6-6" />
          </svg>
        </button>
        <div class="friends-title">好友</div>
        <button class="nav-btn" aria-label="添加">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.1" stroke-linecap="round" stroke-linejoin="round">
            <path d="M12 5v14" />
            <path d="M5 12h14" />
          </svg>
        </button>
      </header>

      <div class="search-bar">
        <div class="search-inner">
          <svg width="15" height="15" viewBox="0 0 16 16" fill="none">
            <circle cx="7" cy="7" r="5.5" stroke="currentColor" stroke-width="1.5" />
            <path d="M11 11l3 3" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" />
          </svg>
          <input v-model.trim="keyword" placeholder="搜索好友或聊天记录" />
        </div>
      </div>

      <main class="conversation-list">
        <button
          v-for="friend in visibleFriends"
          :key="friend.id"
          class="conversation-row"
          :class="{ pinned: friend.pinned }"
          @click.stop="openChat(friend)"
          @contextmenu.prevent.stop="openSheet(friend)"
          @touchstart.passive="startLongPress(friend)"
          @touchmove.passive="cancelLongPress"
          @touchend.passive="cancelLongPress"
          @touchcancel.passive="cancelLongPress"
        >
          <div class="avatar" :class="friend.tone">{{ friend.initial }}</div>
          <div class="conversation-main">
            <div class="conversation-top">
              <span class="conversation-name">{{ friend.name }}</span>
              <span class="conversation-time">{{ friend.time }}</span>
            </div>
            <div class="conversation-bottom">
              <span v-if="friend.pinned" class="pin-chip">置顶</span>
              <span class="conversation-preview">{{ friend.last }}</span>
              <span v-if="friend.unread" class="unread">{{ friend.unread }}</span>
            </div>
          </div>
        </button>

        <div v-if="!visibleFriends.length" class="empty-state">没有找到相关好友</div>
      </main>
    </template>

    <template v-else>
      <header class="chat-hdr">
        <button class="nav-btn" @click.stop="activeFriend = null" aria-label="返回">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.1" stroke-linecap="round" stroke-linejoin="round">
            <path d="M15 18l-6-6 6-6" />
          </svg>
        </button>
        <div class="chat-title">{{ activeFriend.name }}</div>
        <button class="nav-btn" aria-label="更多">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.1" stroke-linecap="round" stroke-linejoin="round">
            <circle cx="5" cy="12" r="1" />
            <circle cx="12" cy="12" r="1" />
            <circle cx="19" cy="12" r="1" />
          </svg>
        </button>
      </header>

      <main class="chat-feed">
        <div class="chat-time">今天</div>
        <div class="bubble other">这里后面会接真实好友消息和文件分享。</div>
        <div class="bubble mine">可以把 LinkBox 里的文件、链接、图片分享给你。</div>
        <button class="share-file">
          <span class="share-icon">+</span>
          <span>
            <strong>分享 LinkBox 文件</strong>
            <em>从最近上传里选择文件或链接</em>
          </span>
        </button>
        <div v-for="msg in localMessages" :key="msg.id" class="bubble mine">{{ msg.text }}</div>
      </main>

      <footer class="chat-input">
        <button class="tool-btn">+</button>
        <input v-model="draft" placeholder="发送消息" @keyup.enter="sendLocal" />
        <button class="send-btn" :disabled="!draft.trim()" @click="sendLocal">发送</button>
      </footer>
    </template>

    <transition name="sheet-fade">
      <div v-if="sheetFriend" class="sheet-mask" @click="closeSheet">
        <div class="action-sheet" @click.stop>
          <div class="sheet-handle"></div>
          <div class="sheet-user">
            <div class="avatar small" :class="sheetFriend.tone">{{ sheetFriend.initial }}</div>
            <div>
              <div class="sheet-name">{{ sheetFriend.name }}</div>
              <div class="sheet-sub">{{ sheetFriend.last }}</div>
            </div>
          </div>
          <button class="sheet-action" @click="togglePin(sheetFriend)">
            {{ sheetFriend.pinned ? '取消置顶' : '置顶聊天' }}
          </button>
          <button class="sheet-action muted" @click="closeSheet">取消</button>
        </div>
      </div>
    </transition>
  </div>
</template>

<script setup>
import { computed, reactive, ref } from 'vue'

const PIN_KEY = 'linkbox_mobile_pinned_friends'
const savedPins = new Set(JSON.parse(localStorage.getItem(PIN_KEY) || '[]'))

const keyword = ref('')
const sheetFriend = ref(null)
const activeFriend = ref(null)
const draft = ref('')
const localMessages = ref([])
let longPressTimer = null

const friends = reactive([
  { id: 'devices', name: '我的设备', initial: '设', tone: 'tone-device', last: '跨设备同步与分享', time: '09:42', unread: 0, pinned: savedPins.has('devices') },
  { id: 'wang', name: '王工', initial: '王', tone: 'tone-work', last: '待分享调试文档', time: '昨天', unread: 2, pinned: savedPins.has('wang') },
  { id: 'project', name: '项目群', initial: '群', tone: 'tone-group', last: '资料和图片集中发这里', time: '周一', unread: 0, pinned: savedPins.has('project') },
  { id: 'assistant', name: '文件共享助手', initial: '助', tone: 'tone-helper', last: '从 LinkBox 选择文件后分享', time: '5/26', unread: 0, pinned: savedPins.has('assistant') },
])

const visibleFriends = computed(() => {
  const q = keyword.value.toLowerCase()
  return [...friends]
    .filter((f) => !q || f.name.toLowerCase().includes(q) || f.last.toLowerCase().includes(q))
    .sort((a, b) => Number(b.pinned) - Number(a.pinned))
})

function openChat(friend) {
  cancelLongPress()
  closeSheet()
  activeFriend.value = friend
  friend.unread = 0
}

function openSheet(friend) {
  cancelLongPress()
  sheetFriend.value = friend
}

function closeSheet() {
  sheetFriend.value = null
}

function togglePin(friend) {
  friend.pinned = !friend.pinned
  localStorage.setItem(PIN_KEY, JSON.stringify(friends.filter((f) => f.pinned).map((f) => f.id)))
  closeSheet()
}

function startLongPress(friend) {
  cancelLongPress()
  longPressTimer = window.setTimeout(() => openSheet(friend), 520)
}

function cancelLongPress() {
  if (!longPressTimer) return
  window.clearTimeout(longPressTimer)
  longPressTimer = null
}

function sendLocal() {
  const text = draft.value.trim()
  if (!text) return
  localMessages.value.push({ id: Date.now(), text })
  if (activeFriend.value) activeFriend.value.last = text
  draft.value = ''
}
</script>

<style scoped>
.friends-page {
  height: 100%;
  background: var(--bg);
  color: var(--text);
  display: flex;
  flex-direction: column;
  overflow: hidden;
}

.friends-hdr,
.chat-hdr {
  height: var(--header-h);
  flex-shrink: 0;
  display: flex;
  align-items: flex-end;
  gap: 12px;
  padding: 0 16px 12px;
  background: var(--bg-blur);
  backdrop-filter: blur(20px);
  -webkit-backdrop-filter: blur(20px);
  border-bottom: 1px solid var(--border);
}

.friends-title,
.chat-title {
  flex: 1;
  height: 36px;
  line-height: 36px;
  font-size: 18px;
  font-weight: 800;
  min-width: 0;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.nav-btn {
  width: 36px;
  height: 36px;
  border: 0;
  border-radius: 50%;
  background: var(--s2);
  color: var(--text2);
  display: flex;
  align-items: center;
  justify-content: center;
}

.search-bar {
  flex-shrink: 0;
  padding: 9px 14px;
  background: var(--bg);
  border-bottom: 1px solid var(--border);
}

.search-inner {
  height: 36px;
  border-radius: 10px;
  background: var(--s2);
  color: var(--text3);
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 0 12px;
}

.search-inner input {
  flex: 1;
  min-width: 0;
  border: 0;
  outline: 0;
  background: transparent;
  color: var(--text);
  font: inherit;
  font-size: 13px;
}

.conversation-list {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  background: var(--bg);
}

.conversation-row {
  width: 100%;
  min-height: 72px;
  border: 0;
  border-bottom: 1px solid var(--border);
  background: var(--s1);
  color: inherit;
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 10px 14px;
  text-align: left;
}

.conversation-row.pinned { background: var(--s2); }
.conversation-row:active { background: var(--s3); }

.avatar {
  width: 46px;
  height: 46px;
  flex: 0 0 46px;
  border-radius: 9px;
  display: flex;
  align-items: center;
  justify-content: center;
  color: #fff;
  font-size: 17px;
  font-weight: 800;
}

.avatar.small {
  width: 40px;
  height: 40px;
  flex-basis: 40px;
  border-radius: 9px;
  font-size: 15px;
}

.tone-device { background: #2f8cff; }
.tone-work { background: #17a66a; }
.tone-group { background: #f59a23; }
.tone-helper { background: #7c6df2; }

.conversation-main { flex: 1; min-width: 0; }
.conversation-top,
.conversation-bottom { display: flex; align-items: center; min-width: 0; }
.conversation-top { margin-bottom: 5px; }

.conversation-name {
  flex: 1;
  min-width: 0;
  font-size: 15px;
  font-weight: 700;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.conversation-time {
  flex: 0 0 auto;
  margin-left: 10px;
  font-size: 11px;
  color: var(--text3);
}

.conversation-preview {
  flex: 1;
  min-width: 0;
  font-size: 12px;
  color: var(--text3);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.pin-chip {
  flex: 0 0 auto;
  margin-right: 6px;
  padding: 1px 5px;
  border-radius: 4px;
  background: var(--accent-s);
  color: var(--accent);
  font-size: 10px;
  font-weight: 700;
}

.unread {
  flex: 0 0 auto;
  min-width: 18px;
  height: 18px;
  margin-left: 8px;
  padding: 0 5px;
  border-radius: 999px;
  background: var(--red);
  color: #fff;
  font-size: 10px;
  display: flex;
  align-items: center;
  justify-content: center;
}

.empty-state {
  padding: 34px 0;
  text-align: center;
  color: var(--text3);
  font-size: 13px;
}

.chat-feed {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  padding: 14px 16px 20px;
  display: flex;
  flex-direction: column;
  gap: 10px;
  background: var(--bg);
}

.chat-time {
  align-self: center;
  padding: 2px 8px;
  color: var(--text3);
  font-size: 11px;
}

.bubble {
  max-width: 76%;
  padding: 9px 12px;
  border-radius: 15px;
  font-size: 13px;
  line-height: 1.55;
}

.bubble.other {
  align-self: flex-start;
  background: var(--s2);
  color: var(--text2);
  border-bottom-left-radius: 5px;
}

.bubble.mine {
  align-self: flex-end;
  background: var(--accent);
  color: #fff;
  border-bottom-right-radius: 5px;
}

.share-file {
  align-self: flex-end;
  max-width: 76%;
  border: 1px solid var(--border2);
  border-radius: 14px;
  background: var(--s2);
  color: var(--text);
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 10px 12px;
  text-align: left;
}

.share-icon {
  width: 34px;
  height: 34px;
  border-radius: 10px;
  background: var(--accent-s);
  color: var(--accent);
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 20px;
}

.share-file strong,
.share-file em {
  display: block;
}

.share-file strong {
  font-size: 13px;
}

.share-file em {
  margin-top: 3px;
  color: var(--text3);
  font-size: 11px;
  font-style: normal;
}

.chat-input {
  flex-shrink: 0;
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 9px 12px 16px;
  background: var(--bg-blur);
  backdrop-filter: blur(20px);
  -webkit-backdrop-filter: blur(20px);
  border-top: 1px solid var(--border);
}

.chat-input input {
  flex: 1;
  min-width: 0;
  height: 38px;
  border: 0;
  border-radius: 12px;
  outline: 0;
  background: var(--s2);
  color: var(--text);
  font: inherit;
  font-size: 14px;
  padding: 0 12px;
}

.tool-btn,
.send-btn {
  height: 38px;
  border: 0;
  border-radius: 12px;
  background: var(--s2);
  color: var(--text2);
  font: inherit;
  font-weight: 700;
}

.tool-btn {
  width: 38px;
  font-size: 20px;
}

.send-btn {
  padding: 0 13px;
  background: var(--accent);
  color: #fff;
}

.send-btn:disabled {
  opacity: .36;
}

.sheet-mask {
  position: fixed;
  inset: 0;
  z-index: 80;
  background: rgba(0,0,0,.28);
  display: flex;
  align-items: flex-end;
}

.action-sheet {
  width: 100%;
  border-radius: 18px 18px 0 0;
  background: var(--bg);
  border-top: 1px solid var(--border);
  padding: 8px 14px 20px;
  box-shadow: 0 -16px 40px rgba(0,0,0,.18);
}

.sheet-handle {
  width: 38px;
  height: 4px;
  border-radius: 999px;
  background: var(--border2);
  margin: 0 auto 14px;
}

.sheet-user {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 2px 2px 12px;
  border-bottom: 1px solid var(--border);
}

.sheet-name { font-size: 15px; font-weight: 800; }
.sheet-sub {
  margin-top: 3px;
  font-size: 12px;
  color: var(--text3);
  max-width: 260px;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.sheet-action {
  width: 100%;
  height: 46px;
  margin-top: 10px;
  border: 0;
  border-radius: 12px;
  background: var(--s2);
  color: var(--text);
  font: inherit;
  font-size: 15px;
  font-weight: 700;
}

.sheet-action.muted { color: var(--text3); }

.sheet-fade-enter-active,
.sheet-fade-leave-active { transition: opacity .18s ease; }
.sheet-fade-enter-from,
.sheet-fade-leave-to { opacity: 0; }
</style>
