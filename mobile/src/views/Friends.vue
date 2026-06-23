<template>
  <div class="friends-page">
    <header class="friends-hdr">
      <button class="nav-btn" @click="activeChat ? closeChat() : $router.back()" aria-label="返回">
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.1" stroke-linecap="round" stroke-linejoin="round"><path d="M15 18l-6-6 6-6" /></svg>
      </button>
      <div class="friends-title">
        <strong>{{ activeChat ? activeChat.title : '好友与群聊' }}</strong>
        <span>{{ activeChat ? chatSubtitle : homeSubtitle }}</span>
      </div>
      <button v-if="!activeChat" class="nav-btn" @click="openSheet('create')" aria-label="添加">
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.1" stroke-linecap="round" stroke-linejoin="round"><path d="M12 5v14"/><path d="M5 12h14"/></svg>
      </button>
      <button v-else class="nav-btn" @click="openSheet('groupTools')" aria-label="聊天工具">
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.1" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="1"/><circle cx="19" cy="12" r="1"/><circle cx="5" cy="12" r="1"/></svg>
      </button>
    </header>

    <main v-if="!activeChat" class="social-body">
      <div v-if="error" class="notice error">{{ error }}</div>
      <div v-if="toast" class="notice ok">{{ toast }}</div>

      <div class="quick-row">
        <button class="quick-action" @click="openSheet('addFriend')">
          <span class="quick-icon">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.1" stroke-linecap="round" stroke-linejoin="round"><path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M19 8v6"/><path d="M22 11h-6"/></svg>
          </span>
          <span>加好友</span>
        </button>
        <button class="quick-action primary" @click="openSheet('createGroup')">
          <span class="quick-icon">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.1" stroke-linecap="round" stroke-linejoin="round"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg>
          </span>
          <span>建群聊</span>
        </button>
      </div>

      <section class="section" v-if="conversationRows.length">
        <div class="section-title">消息与联系人</div>
        <button
          v-for="row in conversationRows"
          :key="row.id"
          class="conversation-row"
          :class="row.type"
          @click="openConversation(row)"
        >
          <span class="avatar" :class="{ group: row.type === 'group', request: row.type === 'requests' }">
            {{ row.avatarText || '请' }}
          </span>
          <span class="conversation-main">
            <strong>{{ row.title }}</strong>
            <em>{{ row.subtitle }}</em>
          </span>
          <span v-if="row.badge" class="badge">{{ row.badge }}</span>
          <svg class="chev" width="16" height="16" viewBox="0 0 16 16" fill="none"><path d="M6 4l4 4-4 4" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"/></svg>
        </button>
      </section>

      <section v-if="!conversationRows.length && !loading" class="empty-state">
        <div class="empty-mark">
          <svg width="30" height="30" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg>
        </div>
        <strong>还没有好友或群聊</strong>
        <span>先添加好友，再创建一个群聊。</span>
      </section>
    </main>

    <main v-else class="chat-view">
      <div v-if="error" class="notice error">{{ error }}</div>
      <div v-if="toast" class="notice ok">{{ toast }}</div>

      <div class="messages" ref="messagesEl">
        <div v-for="msg in displayMessages" :key="msg.id" class="msg" :class="{ mine: isMineMessage(msg, currentUser), 'image-batch-row': msg.kind === 'image-batch' }">
          <span class="msg-name">{{ msg.user?.username || msg.username || '成员' }}</span>
          <div class="msg-card-wrap fm-row-inner">
            <template v-if="msg.message_type === 'material'">
              <ImageBatchCard
                v-if="msg.kind === 'image-batch'"
                :images="msg.images"
                @open="openBatchMaterial(msg, $event)"
                @active-change="rememberBatchActive(msg, $event)"
              />

              <div
                v-else-if="messageFile(msg)?.type === 'image'"
                class="fm-img-card"
                @click="openMaterialDetail(materialMessageLinkId(msg))"
              >
                <div class="fm-img-inner" :class="imgBgClass(messageFile(msg))">
                  <img :src="downloadUrl(messageFile(msg).id)" class="img-thumb" loading="lazy" @error="event => { event.target.style.display = 'none' }" />
                  <span class="fm-img-status-dot" :class="messageFile(msg)?.status"></span>
                </div>
              </div>

              <div
                v-else-if="isLinkLikeType(messageFileType(msg))"
                class="fm-link-card"
                @click="openMaterialDetail(materialMessageLinkId(msg))"
              >
                <div class="fm-link-preview" :class="linkBgClass(messageFile(msg))">
                  <img v-if="messageFile(msg)?.og_image" :src="imgUrl(messageFile(msg).og_image)" class="link-og-img" loading="lazy" @error="event => { event.target.style.display = 'none' }" />
                  <template v-else>
                    <img v-if="messageFile(msg)?.favicon_url" :src="messageFile(msg).favicon_url" class="link-fav-big" loading="lazy" @error="event => { event.target.style.display = 'none' }" />
                    <span v-else class="fallback-ico">{{ messageFileType(msg) === 'video' ? '🎬' : '🔗' }}</span>
                  </template>
                </div>
                <div class="fm-link-info">
                  <div class="fm-link-title">{{ messageFile(msg)?.original_filename || msg.material?.title || msg.body }}</div>
                  <div class="fm-link-url">
                    <img v-if="messageFile(msg)?.favicon_url" :src="messageFile(msg).favicon_url" class="link-fav-sm" @error="event => { event.target.style.display = 'none' }" />
                    {{ linkHost(messageFile(msg)?.url || msg.material?.url || msg.material?.title || msg.body) }}
                  </div>
                  <FileHints v-if="messageFile(msg)" :file="messageFile(msg)" in-card />
                  <div v-if="commentPreviewText(messageFile(msg)?.comment)" class="fm-comment-preview">
                    {{ commentPreviewText(messageFile(msg)?.comment) }}
                  </div>
                </div>
              </div>

              <div
                v-else-if="messageFileType(msg) === 'text'"
                class="fm-text-bubble"
                @click="openMaterialDetail(materialMessageLinkId(msg))"
              >
                <div class="text-bubble-content">{{ messageFile(msg)?.content || messageFile(msg)?.summary || msg.material?.title || msg.body }}</div>
                <FileHints v-if="messageFile(msg)" :file="messageFile(msg)" bubble />
                <div v-if="commentPreviewText(messageFile(msg)?.comment)" class="fm-comment-preview bubble">
                  {{ commentPreviewText(messageFile(msg)?.comment) }}
                </div>
              </div>

              <div
                v-else
                class="fm-file-card"
                @click="openMaterialDetail(materialMessageLinkId(msg))"
              >
                <div class="fm-file-ico" :style="{ background: fileIconBg(messageFileType(msg)) }">
                  {{ fileIcon(messageFileType(msg)) }}
                </div>
                <div class="fm-file-body">
                  <div class="fm-file-name">{{ messageFile(msg)?.original_filename || msg.material?.title || msg.body }}</div>
                  <div class="fm-file-meta">
                    <span>{{ fileLabel(messageFileType(msg)) }}</span>
                    <span v-if="messageFile(msg)?.file_size"> · {{ fmtSize(messageFile(msg).file_size) }}</span>
                    <span class="status-dot" :class="messageFile(msg)?.status"></span>
                  </div>
                  <FileHints v-if="messageFile(msg)" :file="messageFile(msg)" in-card />
                  <div v-if="commentPreviewText(messageFile(msg)?.comment)" class="fm-comment-preview">
                    {{ commentPreviewText(messageFile(msg)?.comment) }}
                  </div>
                </div>
                <button class="fm-file-open" @click.stop="openMaterialDetail(materialMessageLinkId(msg))">↗</button>
              </div>
            </template>
            <div v-else class="msg-card text-card">
              <div class="text-message-content">{{ msg.body }}</div>
            </div>
            <button class="row-more-btn" @click.stop="openMessageActions(msg)" aria-label="更多操作">
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round">
                <circle cx="12" cy="12" r="1"/>
                <circle cx="19" cy="12" r="1"/>
                <circle cx="5" cy="12" r="1"/>
              </svg>
            </button>
          </div>
          <span class="msg-time">{{ timeStr(msg.created_at) }}</span>
        </div>
        <div v-if="!messages.length && !loading" class="empty-state compact">
          <strong>{{ activeChat.type === 'group' ? '还没有群消息' : '还没有聊天消息' }}</strong>
          <span>{{ activeChat.type === 'group' ? '发第一条消息，或从 + 发送资料。' : '发第一条消息开始聊天。' }}</span>
        </div>
      </div>

      <form class="chat-input" @submit.prevent="submitMessage">
        <button type="button" class="tool-btn" @click="openSheet('quickTools')" aria-label="发送资料">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 5v14"/><path d="M5 12h14"/></svg>
        </button>
        <AutoGrowTextarea
          v-model="messageText"
          class="chat-message-input"
          :placeholder="activeChat.type === 'group' ? '发一条群消息' : '发一条消息'"
          :max-height="120"
          @keydown.enter.exact.prevent="submitMessage"
        />
        <button class="send-btn" :disabled="!messageText || busy" aria-label="发送">
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><line x1="12" y1="19" x2="12" y2="5"/><polyline points="5 12 12 5 19 12"/></svg>
        </button>
      </form>
    </main>

    <input ref="chatFileInputRef" type="file" multiple class="hidden-input" @change="handleChatFileSelect" />

    <transition name="sheet">
      <div v-if="sheetMode" class="modal-mask" @click.self="closeSheet">
        <div class="bottom-sheet" :class="{ tall: tallSheet }">
          <div class="sheet-handle"></div>

          <template v-if="sheetMode === 'create'">
            <div class="sheet-title">新操作</div>
            <div class="sheet-actions-list">
              <button class="sheet-action" @click="openSheet('addFriend')">
                <strong>添加好友</strong>
                <span>通过用户名发送好友请求</span>
              </button>
              <button class="sheet-action" @click="openSheet('createGroup')">
                <strong>创建群聊</strong>
                <span>选择好友，一起共享资料和消息</span>
              </button>
            </div>
          </template>

          <template v-else-if="sheetMode === 'addFriend'">
            <div class="sheet-title">添加好友</div>
            <form class="sheet-form" @submit.prevent="submitFriend">
              <input v-model.trim="composer.friendName" placeholder="输入对方用户名" />
              <button class="wide-primary" :disabled="!composer.friendName || busy">发送请求</button>
            </form>
          </template>

          <template v-else-if="sheetMode === 'createGroup'">
            <div class="sheet-title">创建群聊</div>
            <form class="sheet-form" @submit.prevent="submitGroup">
              <input v-model.trim="composer.groupName" placeholder="群名称" />
              <AutoGrowTextarea v-model.trim="composer.groupDescription" placeholder="群说明，可不填" :min-rows="2" />
              <div class="member-picks">
                <button
                  v-for="friend in acceptedFriends"
                  :key="friend.id"
                  type="button"
                  class="member-chip"
                  :class="{ selected: composer.selectedMemberIds.includes(friend.user.id) }"
                  @click="toggleMember(friend.user.id)"
                >
                  <span class="mini-avatar">{{ initial(friend.user?.username) }}</span>
                  <span>{{ friend.user?.username }}</span>
                </button>
              </div>
              <div v-if="!acceptedFriends.length" class="sheet-empty">还没有可邀请的好友。</div>
              <button class="wide-primary" :disabled="!composer.groupName || busy">创建群聊</button>
            </form>
          </template>

          <template v-else-if="sheetMode === 'requests'">
            <div class="sheet-title">好友请求</div>
            <div class="request-list">
              <div v-for="friend in incomingFriends" :key="friend.id" class="request-row">
                <span>{{ friend.user?.username }}</span>
                <button @click="accept(friend.id)" :disabled="busy">通过</button>
              </div>
              <div v-if="outgoingFriends.length" class="pending-line">
                待通过：{{ outgoingFriends.map(f => f.user?.username).join('、') }}
              </div>
              <div v-if="!incomingFriends.length && !outgoingFriends.length" class="sheet-empty">没有新的好友请求。</div>
            </div>
          </template>

          <template v-else-if="sheetMode === 'quickTools'">
            <div class="sheet-title">发送</div>
            <div class="sheet-actions-list">
              <button class="sheet-action" @click="triggerChatUpload">
                <strong>上传文件</strong>
                <span>像主页一样发送图片、文档或音频</span>
              </button>
              <button class="sheet-action" @click="openSheet('materialPicker')">
                <strong>发送已有资料</strong>
                <span>从个人资料库选择内容发送</span>
              </button>
            </div>
          </template>

          <template v-else-if="sheetMode === 'groupTools'">
            <div class="sheet-title">{{ activeChat?.type === 'group' ? '群工具' : '聊天工具' }}</div>
            <div class="sheet-actions-list">
              <button v-if="activeChat?.type === 'group'" class="sheet-action" @click="openSheet('groupMaterials')">
                <strong>群资料</strong>
                <span>{{ groupMaterials.length }} 条资料</span>
              </button>
              <button v-if="activeChat?.type === 'group'" class="sheet-action" @click="openSheet('assistant')">
                <strong>AI 助手</strong>
                <span>基于这个群的资料和上下文提问</span>
              </button>
              <div v-if="activeChat?.type !== 'group'" class="sheet-empty">这里暂无更多工具。</div>
            </div>
          </template>

          <template v-else-if="sheetMode === 'messageActions'">
            <div class="sheet-title">消息操作</div>
            <div class="sheet-actions-list">
              <button v-if="actionMessage?.message_type === 'material'" class="sheet-action" @click="commentMessageMaterial">
                <strong>留言</strong>
                <span>给这条资料补充说明</span>
              </button>
              <button v-if="actionMessage?.message_type === 'material'" class="sheet-action" @click="openMaterialDetail(materialMessageLinkId(actionMessage))">
                <strong>查看详情</strong>
                <span>打开资料详情页</span>
              </button>
              <button v-if="canDeleteMessage(actionMessage)" class="sheet-action danger" @click="deleteActionMessage">
                <strong>删除</strong>
                <span>{{ activeChat?.type === 'group' ? '群主可删任意消息，成员只能删自己的' : '只能删除自己发出的消息' }}</span>
              </button>
              <div v-if="!canDeleteMessage(actionMessage) && actionMessage?.message_type !== 'material'" class="sheet-empty">这条消息暂无可用操作。</div>
            </div>
          </template>

          <template v-else-if="sheetMode === 'messageComment'">
            <div class="sheet-title">留言</div>
            <form class="sheet-form" @submit.prevent="saveMessageComment">
              <AutoGrowTextarea v-model="messageCommentDraft" placeholder="给这条资料写留言" :min-rows="2" />
              <button class="wide-primary" :disabled="busy">保存</button>
            </form>
          </template>

          <template v-else-if="sheetMode === 'materialPicker'">
            <div class="sheet-title">发送资料</div>
            <div class="picker-list">
              <button v-for="file in shareableFiles" :key="file.id" class="picker-row" @click="shareToChat(file)">
                <span>{{ file.original_filename }}</span>
                <small>{{ file.type }}</small>
              </button>
              <div v-if="!shareableFiles.length" class="sheet-empty">还没有可发送的资料。</div>
            </div>
          </template>

          <template v-else-if="sheetMode === 'groupMaterials'">
            <div class="sheet-title">群资料</div>
            <div class="picker-list">
              <button v-for="material in groupMaterials" :key="material.link_id" class="picker-row" @click="openMaterialDetail(material.link_id)">
                <span>{{ material.title || material.url || `资料 ${material.link_id}` }}</span>
                <small>{{ material.note || material.summary || '群资料' }}</small>
              </button>
              <div v-if="!groupMaterials.length" class="sheet-empty">这个群还没有资料。</div>
            </div>
          </template>

          <template v-else-if="sheetMode === 'assistant'">
            <div class="assistant-head">
              <div class="sheet-title">AI 助手</div>
              <button class="close-btn" @click="closeSheet">关闭</button>
            </div>
            <ChatBox class="group-assistant" :group-id="activeChat.id" @open-file="openMaterialDetail" />
          </template>
        </div>
      </div>
    </transition>
  </div>
</template>

<script setup>
import { computed, defineComponent, h, nextTick, onMounted, reactive, ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import {
  acceptFriend,
  addFriend,
  createGroup,
  deleteDirectMessage,
  deleteGroupMaterial,
  deleteGroupMessage,
  downloadUrl,
  getDirectMessages,
  getFiles,
  getFriends,
  getGroupMaterials,
  getGroupMessages,
  getGroups,
  imgUrl,
  sendDirectMessage,
  sendGroupMessage,
  shareLinkToFriend,
  shareLinkToGroup,
  updateDirectMaterialComment,
  updateGroupMaterialComment,
  uploadDirectChatItem,
  uploadGroupChatItem,
} from '../api/files'
import ChatBox from '../components/ChatBox.vue'
import AutoGrowTextarea from '../components/AutoGrowTextarea.vue'
import ImageBatchCard from '../components/ImageBatchCard.vue'
import { isMineMessage, normalizeGroupMessagesResponse } from '../utils/groupChatDisplay'
import { commentPreviewText, fileIcon, fileLabel, fileTypeBackground, isLinkLikeType } from '../utils/mobileItemDisplay'
import { mobileProcessingText } from '../utils/mobileProcessingStatus'
import { organizeFile } from '../utils/mobileOrganizer'
import {
  acceptedFriendRows,
  buildConversationList,
  createEmptyComposerState,
  incomingFriendRequests,
  initial,
  outgoingFriendRequests,
} from '../utils/socialConversations'

const route = useRoute()
const router = useRouter()
const loading = ref(false)
const busy = ref(false)
const error = ref('')
const toast = ref('')
const friends = ref([])
const groups = ref([])
const activeChat = ref(null)
const messages = ref([])
const groupMaterials = ref([])
const shareableFiles = ref([])
const messageText = ref('')
const currentUser = ref(null)
const currentMember = ref(null)
const sheetMode = ref(null)
const messagesEl = ref(null)
const chatFileInputRef = ref(null)
const actionMessage = ref(null)
const messageCommentDraft = ref('')
const activeBatchImageIds = reactive({})
const composer = reactive(createEmptyComposerState())
const SOCIAL_CHAT_RETURN_KEY = 'linkbox.mobile.social.returnChat'

const FileHints = defineComponent({
  props: {
    file: { type: Object, required: true },
    inCard: Boolean,
    bubble: Boolean,
  },
  setup(props) {
    return () => {
      const file = props.file
      const status = mobileProcessingText(file)
      const org = organizeFile(file)
      const children = []
      if (status) {
        children.push(h('div', { class: ['fm-status-line', file.status, { 'in-card': props.inCard, bubble: props.bubble }] }, status))
      }
      children.push(h('div', { class: ['ai-organized-line', { 'in-card': props.inCard, bubble: props.bubble }] }, `归入 ${org.topic} · ${org.kind}`))
      if (file.type !== 'image' && file.summary) {
        children.push(h('div', { class: props.inCard ? 'fm-link-summary' : 'fm-summary-text' }, file.summary))
      }
      return children
    }
  },
})

const acceptedFriends = computed(() => acceptedFriendRows(friends.value))
const incomingFriends = computed(() => incomingFriendRequests(friends.value))
const outgoingFriends = computed(() => outgoingFriendRequests(friends.value))
const conversationRows = computed(() => buildConversationList({ friends: friends.value, groups: groups.value }))
const homeSubtitle = computed(() => `${acceptedFriends.value.length} 位好友 · ${groups.value.length} 个群聊`)
const chatSubtitle = computed(() => {
  if (!activeChat.value) return ''
  if (activeChat.value.type === 'group') return `${activeChat.value.memberCount || 1} 人 · ${activeChat.value.materialCount || groupMaterials.value.length || 0} 条资料`
  return '私人聊天'
})
const tallSheet = computed(() => ['assistant', 'materialPicker', 'groupMaterials', 'createGroup'].includes(sheetMode.value))
const displayMessages = computed(() => groupChatImageBatches(messages.value))

function timeStr(ts) {
  if (!ts) return ''
  const d = new Date(ts)
  return `${d.getHours().toString().padStart(2, '0')}:${d.getMinutes().toString().padStart(2, '0')}`
}

function fileIconBg(type) { return fileTypeBackground(type) }
function itemColorIndex(file) { return String(file?.id || '0').charCodeAt(0) % 3 }
function imgBgClass(file) { return ['img-bg-a', 'img-bg-b', 'img-bg-c'][itemColorIndex(file)] }
function linkBgClass(file) { return ['link-bg-a', 'link-bg-b', 'link-bg-c'][itemColorIndex(file)] }
function linkHost(url) {
  try { return new URL(url).hostname.replace('www.', '') } catch { return url || '' }
}
function fmtSize(bytes) {
  if (!bytes) return ''
  if (bytes > 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`
  return `${(bytes / 1024).toFixed(0)} KB`
}

function isImageUpload(file) {
  return file?.type?.startsWith('image/')
}

function createImageBatchId() {
  return `chatbatch-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`
}

function groupChatImageBatches(rows = []) {
  const counts = new Map()
  const seen = new Map()
  for (const message of rows) {
    const file = messageFile(message)
    if (message?.message_type !== 'material' || file?.type !== 'image' || !file.batch_id) continue
    counts.set(file.batch_id, (counts.get(file.batch_id) || 0) + 1)
  }

  const emitted = new Set()
  return rows.flatMap(message => {
    const file = messageFile(message)
    if (message?.message_type !== 'material' || file?.type !== 'image' || !file.batch_id || counts.get(file.batch_id) < 2) {
      return [message]
    }
    const count = (seen.get(file.batch_id) || 0) + 1
    seen.set(file.batch_id, count)
    if (count < counts.get(file.batch_id)) return []
    if (emitted.has(file.batch_id)) return []
    emitted.add(file.batch_id)
    const batchMessages = rows
      .filter(candidate => {
        const candidateFile = messageFile(candidate)
        return candidate?.message_type === 'material' && candidateFile?.type === 'image' && candidateFile.batch_id === file.batch_id
      })
      .sort((a, b) => Number(messageFile(a)?.batch_index || 0) - Number(messageFile(b)?.batch_index || 0) || Number(materialMessageLinkId(a)) - Number(materialMessageLinkId(b)))
    const images = batchMessages.map(candidate => messageFile(candidate)).filter(Boolean)
    return [{
      ...message,
      id: `batch:${file.batch_id}`,
      kind: 'image-batch',
      batchId: file.batch_id,
      images,
      batchMessages,
      material: {
        ...message.material,
        file: images[0],
      },
      body: `${images.length} 张照片`,
      created_at: batchMessages[0]?.created_at || message.created_at,
      user: batchMessages[0]?.user || message.user,
      user_id: batchMessages[0]?.user_id || message.user_id,
    }]
  })
}

function activeBatchImage(message) {
  if (message?.kind !== 'image-batch') return null
  const activeId = activeBatchImageIds[message.id]
  return message.images.find(image => String(image.id) === String(activeId)) || message.images[0] || null
}

function rememberBatchActive(message, image) {
  if (message?.id && image?.id) activeBatchImageIds[message.id] = image.id
}

function openBatchMaterial(message, image) {
  const target = image || activeBatchImage(message)
  if (!target?.id) return
  rememberBatchActive(message, target)
  saveChatReturnState()
  router.push({ path: `/file/${target.id}`, query: { returnTo: 'social-chat', batchId: target.batch_id } })
}

function messageFile(message) {
  if (message?.kind === 'image-batch') return activeBatchImage(message)
  return message?.material?.file || null
}

function messageFileType(message) {
  return messageFile(message)?.type || message?.material?.type || 'document'
}

function saveChatReturnState() {
  if (!activeChat.value) return
  try {
    sessionStorage.setItem(SOCIAL_CHAT_RETURN_KEY, JSON.stringify({
      chat: activeChat.value,
      scrollTop: messagesEl.value?.scrollTop || 0,
    }))
  } catch {}
}

function consumeChatReturnState() {
  try {
    const raw = sessionStorage.getItem(SOCIAL_CHAT_RETURN_KEY)
    if (!raw) return null
    sessionStorage.removeItem(SOCIAL_CHAT_RETURN_KEY)
    return JSON.parse(raw)
  } catch {
    return null
  }
}

function openMaterialDetail(id) {
  if (!id) return
  saveChatReturnState()
  router.push({ path: `/file/${id}`, query: { returnTo: 'social-chat' } })
}

function materialMessageLinkId(message) {
  return message?.material?.link_id || message?.link_id || (message?.message_type === 'material' ? message.body : '')
}

function openMessageActions(message) {
  actionMessage.value = message
  messageCommentDraft.value = messageFile(message)?.comment || ''
  openSheet('messageActions')
}

function canDeleteMessage(message) {
  if (!message || !currentUser.value) return false
  if (activeChat.value?.type === 'group') {
    return isMineMessage(message, currentUser.value) || ['owner', 'admin'].includes(currentMember.value?.role)
  }
  return isMineMessage(message, currentUser.value)
}

function notify(text) {
  toast.value = text
  window.setTimeout(() => { if (toast.value === text) toast.value = '' }, 1800)
}

function resetComposerFields() {
  Object.assign(composer, createEmptyComposerState())
}

function openSheet(mode) {
  sheetMode.value = mode
}

function closeSheet() {
  sheetMode.value = null
}

async function reload() {
  loading.value = true
  error.value = ''
  try {
    const [friendRows, groupRows] = await Promise.all([getFriends(), getGroups()])
    friends.value = friendRows
    groups.value = groupRows
    if (activeChat.value?.type === 'group') {
      const fresh = groupRows.find(g => g.id === activeChat.value.id)
      if (fresh) await openGroup(fresh)
    }
  } catch (e) {
    error.value = e?.response?.data?.error || e.message || '加载好友和群组失败'
  } finally {
    loading.value = false
  }
}

function openConversation(row) {
  if (row.type === 'requests') {
    openSheet('requests')
    return
  }
  if (row.type === 'friend') {
    openFriend(row.friend)
    return
  }
  if (row.type === 'group') openGroup(row.group)
}

async function submitFriend() {
  if (!composer.friendName || busy.value) return
  busy.value = true
  error.value = ''
  try {
    const result = await addFriend(composer.friendName)
    resetComposerFields()
    closeSheet()
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
  composer.selectedMemberIds = composer.selectedMemberIds.includes(id)
    ? composer.selectedMemberIds.filter(item => item !== id)
    : [...composer.selectedMemberIds, id]
}

async function submitGroup() {
  if (!composer.groupName || busy.value) return
  busy.value = true
  error.value = ''
  try {
    const result = await createGroup({
      name: composer.groupName,
      description: composer.groupDescription,
      agent_name: '群资料助理',
      member_ids: composer.selectedMemberIds,
    })
    resetComposerFields()
    closeSheet()
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

async function openGroup(group, { restoreScrollTop = null } = {}) {
  activeChat.value = {
    type: 'group',
    id: group.id,
    title: group.name,
    memberCount: group.member_count,
    materialCount: group.material_count,
  }
  closeSheet()
  error.value = ''
  try {
    const [messagePayload, materials, files] = await Promise.all([
      getGroupMessages(group.id),
      getGroupMaterials(group.id),
      getFiles({ limit: 80 }),
    ])
    const normalized = normalizeGroupMessagesResponse(messagePayload)
    messages.value = normalized.messages
    currentUser.value = normalized.currentUser
    currentMember.value = normalized.currentMember
    groupMaterials.value = materials
    shareableFiles.value = files
    await nextTick()
    messagesEl.value?.scrollTo({ top: restoreScrollTop === null ? messagesEl.value.scrollHeight : restoreScrollTop })
  } catch (e) {
    error.value = e?.response?.data?.error || e.message || '加载群消息失败'
  }
}

async function openFriend(friend, { restoreScrollTop = null } = {}) {
  if (!friend?.user?.id) return
  activeChat.value = {
    type: 'direct',
    id: friend.user.id,
    title: friend.user.username,
  }
  closeSheet()
  error.value = ''
  groupMaterials.value = []
  try {
    const [payload, files] = await Promise.all([
      getDirectMessages(friend.user.id),
      getFiles({ limit: 80 }),
    ])
    const normalized = normalizeGroupMessagesResponse(payload)
    messages.value = normalized.messages
    currentUser.value = normalized.currentUser
    currentMember.value = null
    shareableFiles.value = files
    await nextTick()
    messagesEl.value?.scrollTo({ top: restoreScrollTop === null ? messagesEl.value.scrollHeight : restoreScrollTop })
  } catch (e) {
    error.value = e?.response?.data?.error || e.message || '加载聊天消息失败'
  }
}

async function restoreChatIfNeeded() {
  if (route.query.restoreChat !== '1') return false
  const state = consumeChatReturnState()
  if (!state?.chat?.type || !state.chat.id) return false
  if (state.chat.type === 'group') {
    await openGroup({
      id: state.chat.id,
      name: state.chat.title,
      member_count: state.chat.memberCount,
      material_count: state.chat.materialCount,
    }, { restoreScrollTop: state.scrollTop || 0 })
    return true
  }
  await openFriend({
    user: { id: state.chat.id, username: state.chat.title },
  }, { restoreScrollTop: state.scrollTop || 0 })
  return true
}

function closeChat() {
  activeChat.value = null
  messages.value = []
  groupMaterials.value = []
  shareableFiles.value = []
  messageText.value = ''
  closeSheet()
}

async function submitMessage() {
  const body = messageText.value.trim()
  if (!activeChat.value || !body || busy.value) return
  busy.value = true
  error.value = ''
  try {
    const msg = activeChat.value.type === 'group'
      ? await sendGroupMessage(activeChat.value.id, body)
      : await sendDirectMessage(activeChat.value.id, body)
    messages.value.push(msg)
    messageText.value = ''
    await nextTick()
    messagesEl.value?.scrollTo({ top: messagesEl.value.scrollHeight, behavior: 'smooth' })
    if (activeChat.value.type === 'group') await reload()
  } catch (e) {
    error.value = e?.response?.data?.error || e.message || '发送消息失败'
  } finally {
    busy.value = false
  }
}

async function shareToChat(file) {
  if (!activeChat.value || !file?.id || busy.value) return
  busy.value = true
  error.value = ''
  try {
    if (activeChat.value.type === 'group') await shareLinkToGroup(activeChat.value.id, file.id)
    else await shareLinkToFriend(activeChat.value.id, file.id)
    notify('资料已发送')
    closeSheet()
    if (activeChat.value.type === 'group') {
      const group = groups.value.find(g => g.id === activeChat.value.id) || {
        id: activeChat.value.id,
        name: activeChat.value.title,
        member_count: activeChat.value.memberCount,
        material_count: activeChat.value.materialCount,
      }
      await openGroup(group)
    } else {
      await openFriend({ user: { id: activeChat.value.id, username: activeChat.value.title } })
    }
  } catch (e) {
    error.value = e?.response?.data?.error || e.message || '发送资料失败'
  } finally {
    busy.value = false
  }
}

function triggerChatUpload() {
  chatFileInputRef.value?.click()
}

async function uploadChatItem(payload) {
  if (!activeChat.value || busy.value) return
  busy.value = true
  error.value = ''
  try {
    const msg = activeChat.value.type === 'group'
      ? await uploadGroupChatItem(activeChat.value.id, payload)
      : await uploadDirectChatItem(activeChat.value.id, payload)
    messages.value.push(msg)
    closeSheet()
    await nextTick()
    messagesEl.value?.scrollTo({ top: messagesEl.value.scrollHeight, behavior: 'smooth' })
    if (activeChat.value.type === 'group') await reload()
  } catch (e) {
    error.value = e?.response?.data?.error || e.message || '发送资料失败'
  } finally {
    busy.value = false
  }
}

async function handleChatFileSelect(event) {
  const files = [...(event.target.files || [])]
  event.target.value = ''
  const imageFiles = files.filter(isImageUpload)
  const batchId = imageFiles.length > 1 ? createImageBatchId() : ''
  let imageIndex = 0
  for (const file of files) {
    const metadata = batchId && isImageUpload(file)
      ? { batchId, batchIndex: imageIndex++ }
      : {}
    await uploadChatItem({ file, ...metadata })
  }
}

function commentMessageMaterial() {
  messageCommentDraft.value = messageFile(actionMessage.value)?.comment || ''
  openSheet('messageComment')
}

async function saveMessageComment() {
  if (!activeChat.value || !actionMessage.value) return
  const linkId = materialMessageLinkId(actionMessage.value)
  if (!linkId) return
  busy.value = true
  try {
    if (activeChat.value.type === 'group') {
      await updateGroupMaterialComment(activeChat.value.id, linkId, messageCommentDraft.value)
      await openGroup({ id: activeChat.value.id, name: activeChat.value.title, member_count: activeChat.value.memberCount, material_count: activeChat.value.materialCount }, { restoreScrollTop: messagesEl.value?.scrollTop || null })
    } else {
      await updateDirectMaterialComment(activeChat.value.id, linkId, messageCommentDraft.value)
      await openFriend({ user: { id: activeChat.value.id, username: activeChat.value.title } }, { restoreScrollTop: messagesEl.value?.scrollTop || null })
    }
    closeSheet()
  } catch (e) {
    error.value = e?.response?.data?.error || e.message || '保存留言失败'
  } finally {
    busy.value = false
  }
}

async function deleteActionMessage() {
  if (!activeChat.value || !actionMessage.value || !canDeleteMessage(actionMessage.value)) return
  busy.value = true
  try {
    if (activeChat.value.type === 'group') {
      if (actionMessage.value.message_type === 'material') await deleteGroupMaterial(activeChat.value.id, materialMessageLinkId(actionMessage.value))
      else await deleteGroupMessage(activeChat.value.id, actionMessage.value.id)
    } else {
      await deleteDirectMessage(activeChat.value.id, actionMessage.value.id)
    }
    messages.value = messages.value.filter(message => message.id !== actionMessage.value.id)
    closeSheet()
  } catch (e) {
    error.value = e?.response?.data?.error || e.message || '删除失败'
  } finally {
    busy.value = false
  }
}

onMounted(async () => {
  await reload()
  await restoreChatIfNeeded()
})
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
.friends-hdr {
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
.friends-title {
  flex: 1;
  min-width: 0;
  height: 40px;
  display: flex;
  flex-direction: column;
  justify-content: center;
}
.friends-title strong {
  font-size: 17px;
  font-weight: 850;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.friends-title span {
  margin-top: 2px;
  font-size: 11px;
  color: var(--text3);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.nav-btn,
.tool-btn,
.send-btn {
  width: 40px;
  height: 40px;
  border: 0;
  border-radius: 50%;
  background: var(--s2);
  color: var(--text2);
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
}
.social-body,
.chat-view {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  padding: 12px 14px 24px;
}
.social-body {
  display: flex;
  flex-direction: column;
  gap: 14px;
}
.quick-row {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 10px;
}
.quick-action {
  min-height: 70px;
  border: 1px solid var(--border2);
  border-radius: 16px;
  background: var(--s2);
  color: var(--text);
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  justify-content: center;
  gap: 8px;
  padding: 12px;
  font-weight: 800;
}
.quick-action.primary {
  background: var(--accent-s);
  border-color: rgba(139,114,255,.32);
  color: var(--accent);
}
.quick-icon {
  width: 32px;
  height: 32px;
  border-radius: 11px;
  background: var(--s1);
  display: flex;
  align-items: center;
  justify-content: center;
}
.section-title {
  font-size: 12px;
  color: var(--text3);
  font-weight: 800;
  padding: 0 4px 8px;
}
.conversation-row {
  width: 100%;
  min-height: 64px;
  border: 0;
  border-bottom: 1px solid var(--border);
  background: transparent;
  color: var(--text);
  display: flex;
  align-items: center;
  gap: 11px;
  padding: 9px 2px;
  text-align: left;
}
.conversation-row:last-child { border-bottom: 0; }
.avatar,
.mini-avatar {
  width: 38px;
  height: 38px;
  border-radius: 13px;
  background: var(--accent);
  color: #fff;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  font-size: 13px;
  font-weight: 900;
  flex-shrink: 0;
}
.avatar.group { background: var(--orange); }
.avatar.request { background: var(--teal); }
.conversation-main {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 3px;
}
.conversation-main strong,
.picker-row span {
  font-size: 14px;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.conversation-main em,
.picker-row small,
.sheet-action span,
.pending-line {
  color: var(--text3);
  font-size: 11px;
  font-style: normal;
  line-height: 1.45;
}
.badge {
  min-width: 22px;
  height: 22px;
  border-radius: 999px;
  background: var(--red);
  color: #fff;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 11px;
  font-weight: 900;
}
.chev { color: var(--text3); flex-shrink: 0; }
.notice {
  border-radius: 12px;
  padding: 9px 11px;
  font-size: 12px;
  line-height: 1.45;
}
.notice.error { background: rgba(255,110,122,.13); color: var(--red); }
.notice.ok { background: var(--teal-s); color: var(--teal); }
.empty-state {
  margin: auto;
  padding: 46px 18px;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 7px;
  text-align: center;
  color: var(--text3);
  font-size: 12px;
}
.empty-state strong { color: var(--text); font-size: 15px; }
.empty-state.compact { margin: 0; padding: 60px 18px; }
.empty-mark {
  width: 62px;
  height: 62px;
  border-radius: 22px;
  background: var(--s2);
  color: var(--text3);
  display: flex;
  align-items: center;
  justify-content: center;
  margin-bottom: 6px;
}
.chat-view {
  display: flex;
  flex-direction: column;
  gap: 10px;
  overflow: hidden;
  padding-bottom: 12px;
}
.messages {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  display: flex;
  flex-direction: column;
  gap: 9px;
  padding: 4px 2px 10px;
}
.msg {
  align-self: flex-start;
  max-width: 82%;
  display: flex;
  flex-direction: column;
  gap: 3px;
}
.msg.mine { align-self: flex-end; }
.msg-name {
  color: var(--text3);
  font-size: 10px;
  padding: 0 3px;
}
.msg.mine .msg-name,
.msg.mine .msg-time {
  text-align: right;
}
.msg-card-wrap {
  position: relative;
  border-radius: 16px;
  overflow: hidden;
}
.msg-card-wrap.fm-row-inner {
  display: flex;
  align-items: stretch;
}
.msg-card {
  position: relative;
  width: 100%;
  min-width: 190px;
  max-width: 268px;
  border: 1px solid var(--border);
  border-radius: 15px;
  border-bottom-left-radius: 5px;
  background: var(--s2);
  color: var(--text);
  text-align: left;
  overflow: hidden;
}
.msg.mine .msg-card {
  border-bottom-left-radius: 15px;
  border-bottom-right-radius: 5px;
}
.text-card {
  width: fit-content;
  min-width: 0;
  max-width: min(268px, calc(100vw - 92px));
  background: var(--accent);
  color: #fff;
  padding: 10px 34px 10px 13px;
}
.msg:not(.mine) .text-card {
  background: var(--s2);
  color: var(--text);
}
.text-message-content {
  font-size: 13px;
  line-height: 1.55;
  white-space: pre-wrap;
  word-break: break-word;
  width: max-content;
  max-width: min(221px, calc(100vw - 139px));
  -webkit-user-select: text;
  user-select: text;
}
.fm-img-card,
.fm-link-card,
.fm-file-card,
.fm-text-bubble {
  position: relative;
  z-index: 1;
}
.fm-img-card,
.fm-link-card,
.fm-file-card {
  max-width: 255px;
  border: 1px solid var(--border);
  background: var(--s2);
  border-radius: 14px;
  overflow: hidden;
}
.fm-img-card {
  max-width: 185px;
  border-radius: 16px;
}
.fm-img-inner {
  position: relative;
  width: 185px;
  height: 120px;
  display: flex;
  align-items: center;
  justify-content: center;
  overflow: hidden;
}
.img-thumb,
.link-og-img {
  width: 100%;
  height: 100%;
  object-fit: cover;
  display: block;
}
.img-bg-a { background: linear-gradient(135deg, rgba(139,114,255,.25), rgba(94,234,181,.15)); }
.img-bg-b { background: linear-gradient(135deg, rgba(255,170,92,.2), rgba(255,110,122,.15)); }
.img-bg-c { background: linear-gradient(135deg, rgba(100,170,255,.2), rgba(94,234,181,.12)); }
.fm-img-status-dot {
  position: absolute;
  right: 8px;
  bottom: 8px;
  width: 9px;
  height: 9px;
  border-radius: 50%;
  border: 2px solid rgba(255,255,255,.9);
  box-shadow: 0 2px 8px rgba(0,0,0,.24);
}
.fm-img-status-dot.pending { background: var(--orange); animation: pulse 1.4s infinite; }
.fm-img-status-dot.ready { background: var(--teal); }
.fm-img-status-dot.failed { background: var(--red); }
.fm-link-preview {
  height: 72px;
  display: flex;
  align-items: center;
  justify-content: center;
  overflow: hidden;
}
.link-bg-a { background: linear-gradient(135deg, rgba(80,180,255,.18), rgba(40,120,200,.08)); }
.link-bg-b { background: linear-gradient(135deg, rgba(94,234,181,.15), rgba(40,160,120,.08)); }
.link-bg-c { background: linear-gradient(135deg, rgba(139,114,255,.18), rgba(80,60,180,.08)); }
.link-fav-big { width: 32px; height: 32px; border-radius: 8px; object-fit: contain; }
.link-fav-sm { width: 12px; height: 12px; border-radius: 2px; object-fit: contain; flex-shrink: 0; }
.fallback-ico { font-size: 26px; }
.fm-link-info { padding: 8px 34px 10px 12px; }
.fm-link-title,
.fm-file-name {
  font-size: 13px;
  color: var(--text);
  font-weight: 600;
  margin-bottom: 3px;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.fm-link-url,
.fm-file-meta {
  font-size: 11px;
  color: var(--text3);
  display: flex;
  align-items: center;
  gap: 4px;
}
.fm-comment-preview {
  margin-top: 7px;
  padding: 6px 8px;
  border-radius: 10px;
  border: 1px solid rgba(139,114,255,.18);
  background: rgba(139,114,255,.08);
  color: var(--text2);
  font-size: 11px;
  line-height: 1.45;
  white-space: pre-wrap;
  word-break: break-word;
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
}
.fm-comment-preview::before {
  content: '留言';
  margin-right: 6px;
  color: var(--accent);
  font-weight: 800;
}
.fm-comment-preview.bubble {
  border-color: rgba(255,255,255,.24);
  background: rgba(255,255,255,.12);
  color: rgba(255,255,255,.92);
}
.fm-comment-preview.bubble::before {
  color: rgba(255,255,255,.86);
}
.selectable-text,
.fm-link-title,
.fm-link-url,
.fm-file-name,
.fm-file-meta,
.fm-summary-text,
.fm-comment-preview,
.text-bubble-content {
  -webkit-user-select: text;
  user-select: text;
}
.fm-file-card {
  padding: 12px 34px 12px 14px;
  display: flex;
  gap: 10px;
  align-items: center;
}
.fm-file-ico {
  width: 40px;
  height: 40px;
  border-radius: 10px;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 21px;
  flex-shrink: 0;
}
.fm-file-body { flex: 1; min-width: 0; }
.fm-file-open {
  width: 28px;
  height: 28px;
  border-radius: 8px;
  background: var(--s1);
  border: 1px solid var(--border);
  color: var(--text3);
  flex-shrink: 0;
}
.fm-text-bubble {
  max-width: 248px;
  background: var(--accent);
  color: #fff;
  border-radius: 14px 14px 4px 14px;
  padding: 10px 34px 10px 14px;
  font-size: 14px;
  line-height: 1.55;
  white-space: pre-wrap;
  word-break: break-word;
}
.msg:not(.mine) .fm-text-bubble {
  background: var(--s2);
  color: var(--text);
  border: 1px solid var(--border);
  border-radius: 14px 14px 14px 4px;
}
.text-bubble-content {
  display: -webkit-box;
  -webkit-line-clamp: 5;
  -webkit-box-orient: vertical;
  overflow: hidden;
}
.status-dot {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  flex-shrink: 0;
  display: inline-block;
}
.status-dot.pending { background: var(--orange); animation: pulse 1.4s infinite; }
.status-dot.ready { background: var(--teal); }
.status-dot.failed { background: var(--red); }
.fm-status-line,
.ai-organized-line,
.fm-link-summary,
.fm-summary-text {
  margin-top: 6px;
  font-size: 11px;
  line-height: 1.35;
  color: var(--text3);
}
.fm-status-line.pending { color: var(--orange); }
.fm-status-line.failed { color: var(--red); }
.fm-status-line.ready { color: var(--teal); }
.fm-link-summary,
.fm-summary-text {
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
}
.fm-status-line.bubble,
.ai-organized-line.bubble,
.fm-summary-text.bubble {
  color: rgba(255,255,255,.78);
}
.msg:not(.mine) .fm-status-line.bubble,
.msg:not(.mine) .ai-organized-line.bubble,
.msg:not(.mine) .fm-summary-text.bubble {
  color: var(--text3);
}
.row-more-btn {
  position: absolute;
  top: 1px;
  right: 1px;
  z-index: 5;
  width: 40px;
  height: 40px;
  border: 0;
  border-radius: 0;
  background: transparent;
  color: rgba(255,255,255,.92);
  display: flex;
  align-items: center;
  justify-content: center;
  opacity: .9;
  filter: drop-shadow(0 1px 3px rgba(0,0,0,.45));
}
.msg:not(.mine) .row-more-btn {
  color: var(--text3);
  filter: none;
}
.msg-time {
  color: var(--text3);
  font-size: 10px;
  padding: 0 3px;
}
.chat-input {
  min-height: 50px;
  border: 1px solid var(--border2);
  border-radius: 25px;
  background: var(--s2);
  display: flex;
  align-items: flex-end;
  gap: 6px;
  padding: 5px 7px;
  flex-shrink: 0;
}
input,
textarea {
  width: 100%;
  min-width: 0;
  border: 0;
  outline: 0;
  border-radius: 12px;
  background: var(--s1);
  color: var(--text);
  font: inherit;
  font-size: 14px;
  padding: 10px 11px;
}
textarea {
  min-height: 72px;
  resize: none;
  line-height: 1.45;
}
.chat-message-input {
  flex: 1;
  min-height: 38px;
  background: transparent;
  padding: 9px 4px;
  border-radius: 0;
  line-height: 20px;
}
.send-btn {
  background: var(--accent);
  color: #fff;
}
button {
  font: inherit;
  cursor: pointer;
  touch-action: manipulation;
}
button:disabled { opacity: .42; cursor: default; }
.modal-mask {
  position: absolute;
  inset: 0;
  z-index: 300;
  background: rgba(0,0,0,.55);
  backdrop-filter: blur(4px);
  display: flex;
  align-items: flex-end;
  justify-content: center;
}
.bottom-sheet {
  width: 100%;
  max-height: 82%;
  overflow-y: auto;
  background: var(--card);
  border: 1px solid var(--border2);
  border-radius: 26px 26px 0 0;
  padding: 14px 18px 30px;
}
.bottom-sheet.tall { height: 78%; display: flex; flex-direction: column; }
.sheet-handle {
  width: 38px;
  height: 4px;
  border-radius: 2px;
  background: var(--border2);
  margin: 0 auto 18px;
  flex-shrink: 0;
}
.sheet-title {
  font-size: 16px;
  font-weight: 850;
  margin-bottom: 12px;
}
.sheet-actions-list,
.sheet-form,
.request-list,
.picker-list {
  display: flex;
  flex-direction: column;
  gap: 9px;
}
.sheet-action,
.picker-row,
.request-row {
  width: 100%;
  min-height: 54px;
  border: 1px solid var(--border);
  border-radius: 14px;
  background: var(--s2);
  color: var(--text);
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 10px 12px;
  text-align: left;
}
.sheet-action {
  align-items: flex-start;
  flex-direction: column;
  justify-content: center;
  gap: 3px;
}
.sheet-action strong { font-size: 14px; }
.sheet-action.danger strong { color: var(--red); }
.request-row span { font-size: 14px; font-weight: 700; }
.request-row button {
  height: 34px;
  border: 0;
  border-radius: 12px;
  background: var(--accent);
  color: #fff;
  padding: 0 12px;
  font-size: 13px;
  font-weight: 800;
}
.wide-primary {
  height: 44px;
  border: 0;
  border-radius: 14px;
  background: var(--accent);
  color: #fff;
  font-size: 14px;
  font-weight: 850;
}
.member-picks {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}
.member-chip {
  min-height: 36px;
  border: 1px solid transparent;
  border-radius: 999px;
  background: var(--s2);
  color: var(--text);
  display: flex;
  align-items: center;
  gap: 7px;
  padding: 5px 10px 5px 5px;
}
.member-chip.selected {
  border-color: var(--accent);
  background: var(--accent-s);
}
.mini-avatar {
  width: 26px;
  height: 26px;
  border-radius: 9px;
  font-size: 11px;
}
.sheet-empty {
  padding: 18px 0;
  text-align: center;
  color: var(--text3);
  font-size: 12px;
}
.pending-line {
  padding: 8px 2px 0;
}
.assistant-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  flex-shrink: 0;
}
.close-btn {
  height: 32px;
  border: 0;
  border-radius: 999px;
  background: var(--s2);
  color: var(--text2);
  padding: 0 12px;
  font-size: 12px;
  font-weight: 800;
}
.group-assistant {
  flex: 1;
  min-height: 0;
  border: 1px solid var(--border);
  border-radius: 16px;
  overflow: hidden;
  background: var(--s1);
}
.sheet-enter-active,
.sheet-leave-active { transition: opacity .18s ease; }
.sheet-enter-from,
.sheet-leave-to { opacity: 0; }
.hidden-input { display: none; }
</style>
