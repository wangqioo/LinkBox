<template>
  <div
    class="home"
    @paste.prevent="handlePaste"
    @touchstart.passive="onTouchStart"
    @touchend.passive="onTouchEnd"
    @mousedown="onMouseDown"
    @mousemove="onMouseMove"
    @mouseup="onMouseUp"
    @mouseleave="onMouseUp"
  >
    <div class="fm-bg"></div>

    <header class="fm-hdr">
      <div class="fm-av">🗂</div>
      <div class="hdr-copy">
        <div class="fm-ttl">文件传输助手</div>
        <div class="fm-sub">发送给自己的文件 · 链接 · 文字</div>
      </div>
      <button class="icon-btn" @click="showSettings = true" aria-label="设置">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
          <circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/>
        </svg>
      </button>
    </header>

    <div class="fm-search-bar">
      <button class="friend-entry" @click="router.push('/friends')" aria-label="好友">
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round">
          <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/>
          <circle cx="9" cy="7" r="4"/>
          <path d="M22 21v-2a4 4 0 0 0-3-3.87"/>
          <path d="M16 3.13a4 4 0 0 1 0 7.75"/>
        </svg>
      </button>
      <div class="fm-search-inner" @click="router.push('/search')">
        <svg width="14" height="14" viewBox="0 0 16 16" fill="none">
          <circle cx="7" cy="7" r="5.5" stroke="var(--text3)" stroke-width="1.5"/>
          <path d="M11 11L14 14" stroke="var(--text3)" stroke-width="1.5" stroke-linecap="round"/>
        </svg>
        <input readonly placeholder="搜索文件、链接或文字…" />
      </div>
    </div>

    <button class="organizer-strip" @click="showOrganizer = true">
      <span class="org-mark">
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round">
          <path d="M12 3l1.7 5.2L19 10l-5.3 1.8L12 17l-1.7-5.2L5 10l5.3-1.8L12 3z"/>
          <path d="M19 15l.8 2.2L22 18l-2.2.8L19 21l-.8-2.2L16 18l2.2-.8L19 15z"/>
        </svg>
      </span>
      <span class="org-main">
        <span class="org-title">今日整理</span>
        <span class="org-sub">{{ organizerLine }}</span>
      </span>
      <span v-if="todayDigest.failed" class="org-alert">{{ todayDigest.failed }}</span>
      <svg class="org-arrow" width="16" height="16" viewBox="0 0 16 16" fill="none">
        <path d="M6 4l4 4-4 4" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"/>
      </svg>
    </button>

    <main class="fm-feed" ref="feedEl">
      <div v-if="loading && !files.length" class="feed-center">
        <div class="orb-mini"></div>
        <span>加载中…</span>
      </div>

      <div v-else-if="!files.length" class="feed-center">
        <div class="empty-ico">🗂</div>
        <span>还没有文件，从底部发送吧</span>
      </div>

      <template v-else>
        <template v-for="group in dateGroups" :key="group.date">
          <button class="fm-date-sep" @click="router.push({ path:'/search', query:{ date: group.date } })">
            {{ group.label }}
            <span class="date-sep-hint">· AI 搜索</span>
          </button>

          <div
            v-for="f in group.files"
            :key="f.id"
            class="fm-row"
            :class="{ 'image-batch-row': f.kind === 'image-batch' }"
          >
            <div class="fm-row-inner">
              <ImageBatchCard
                v-if="f.kind === 'image-batch'"
                :images="f.images"
                @open="handleBatchOpen(f, $event)"
                @active-change="rememberBatchActive(f, $event)"
              />

              <div
                v-else-if="f.file.type === 'image'"
                class="fm-img-card"
                @click="handleCardClick(f.file, f.id)"
              >
                <div class="fm-img-inner" :class="imgBgClass(f.file)">
                  <img :src="downloadUrl(f.file.id)" class="img-thumb" loading="lazy" @error="e => e.target.style.display='none'" />
                  <span class="fm-img-status-dot" :class="f.file.status"></span>
                </div>
              </div>

              <div
                v-else-if="isLinkLikeType(f.file.type)"
                class="fm-link-card"
                @click="handleCardClick(f.file, f.id)"
              >
                <div class="fm-link-preview" :class="linkBgClass(f.file)">
                  <img v-if="f.file.og_image" :src="imgUrl(f.file.og_image)" class="link-og-img" loading="lazy" @error="e => e.target.style.display='none'" />
                  <template v-else>
                    <img v-if="f.file.favicon_url" :src="f.file.favicon_url" class="link-fav-big" loading="lazy" @error="e => e.target.style.display='none'" />
                    <span v-else class="fallback-ico">{{ f.file.type === 'video' ? '🎬' : '🔗' }}</span>
                  </template>
                </div>
                <div class="fm-link-info">
                  <div class="fm-link-title">{{ f.file.original_filename }}</div>
                  <div class="fm-link-url">
                    <img v-if="f.file.favicon_url" :src="f.file.favicon_url" class="link-fav-sm" @error="e => e.target.style.display='none'" />
                    {{ linkHost(f.file.url || f.file.original_filename) }}
                  </div>
                  <FileHints :file="f.file" in-card />
                  <div v-if="commentPreviewText(f.file.comment)" class="fm-comment-preview">
                    {{ commentPreviewText(f.file.comment) }}
                  </div>
                </div>
              </div>

              <div
                v-else-if="f.file.type === 'text'"
                class="fm-text-bubble"
                @click="handleCardClick(f.file, f.id)"
              >
                <div class="text-bubble-content">{{ f.file.content || f.file.summary || f.file.original_filename }}</div>
                <FileHints :file="f.file" bubble />
                <div v-if="commentPreviewText(f.file.comment)" class="fm-comment-preview bubble">
                  {{ commentPreviewText(f.file.comment) }}
                </div>
              </div>

              <div
                v-else
                class="fm-file-card"
                @click="handleCardClick(f.file, f.id)"
              >
                <div class="fm-file-ico" :style="{ background: fileIconBg(f.file.type) }">
                  {{ fileIcon(f.file.type) }}
                </div>
                <div class="fm-file-body">
                  <div class="fm-file-name">{{ f.file.original_filename }}</div>
                  <div class="fm-file-meta">
                    <span>{{ fileLabel(f.file.type) }}</span>
                    <span v-if="f.file.file_size"> · {{ fmtSize(f.file.file_size) }}</span>
                    <span class="status-dot" :class="f.file.status"></span>
                  </div>
                  <FileHints :file="f.file" in-card />
                  <div v-if="commentPreviewText(f.file.comment)" class="fm-comment-preview">
                    {{ commentPreviewText(f.file.comment) }}
                  </div>
                </div>
                <button class="fm-file-open" @click.stop="openFile(f.file.id)">↗</button>
              </div>

              <button class="row-more-btn" @click.stop="openActionSheet(f)" aria-label="更多操作">
                <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round">
                  <circle cx="12" cy="12" r="1"/>
                  <circle cx="19" cy="12" r="1"/>
                  <circle cx="5" cy="12" r="1"/>
                </svg>
              </button>
            </div>
            <div v-if="rowCommentText(f)" class="fm-row-comment">
              {{ rowCommentText(f) }}
            </div>
            <div class="fm-time">{{ timeStr(f.created_at || f.file?.created_at) }}</div>
          </div>
        </template>
      </template>
    </main>

    <div class="fm-inp">
      <button class="inp-icon" @click="triggerUpload()" title="上传文件">
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/>
        </svg>
      </button>
      <AutoGrowTextarea
        v-model="textInput"
        class="fm-inp-field"
        placeholder="粘贴链接或发送文字给自己…"
        :max-height="120"
        @keydown.enter.exact.prevent="submitText"
      />
      <button
        v-if="speechSupported"
        class="voice-btn"
        :class="{ recording: isRecording }"
        @click="toggleVoice"
        aria-label="语音输入"
      >
        <span v-if="!isRecording">🎤</span>
        <span v-else class="rec-wave"><i v-for="n in 5" :key="n"></i></span>
      </button>
      <button class="send-btn" @click="submitText" aria-label="发送">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
          <line x1="12" y1="19" x2="12" y2="5"/><polyline points="5 12 12 5 19 12"/>
        </svg>
      </button>
    </div>

    <input type="file" multiple ref="fileInputRef" class="hidden-input" @change="handleFileSelect" />

    <transition name="toast-fade">
      <div v-if="uploadToast" class="upload-toast">
        <div class="toast-spinner" v-if="uploading"></div>
        <span>{{ uploadToast }}</span>
      </div>
    </transition>

    <transition name="sheet">
      <div v-if="actionTarget" class="modal-mask" @click.self="actionTarget = null">
        <div class="bottom-sheet action-sheet">
          <div class="sheet-handle"></div>
          <div class="sheet-title">{{ actionTitle }}</div>
          <div class="action-list">
            <button class="action-row" @click="commentFromAction">
              <span>留言</span>
              <small>{{ actionTarget.kind === 'image-batch' ? '给这一批所有照片留言' : '给这一条留言' }}</small>
            </button>
            <button class="action-row danger" @click="deleteFromAction">
              <span>删除</span>
              <small>{{ actionTarget.kind === 'image-batch' ? '删除当前照片' : '删除这一条' }}</small>
            </button>
          </div>
        </div>
      </div>
    </transition>

    <transition name="sheet">
      <div v-if="deleteTarget" class="modal-mask" @click.self="deleteTarget = null">
        <div class="bottom-sheet">
          <div class="sheet-handle"></div>
          <div class="sheet-title">删除文件</div>
          <div class="sheet-body">确认删除「{{ deleteTarget.original_filename }}」？</div>
          <div class="sheet-actions">
            <button class="sheet-btn cancel" @click="deleteTarget = null">取消</button>
            <button class="sheet-btn danger" @click="doDelete">删除</button>
          </div>
        </div>
      </div>
    </transition>

    <transition name="sheet">
      <div v-if="commentTarget" class="modal-mask" @click.self="closeCommentSheet">
        <div class="bottom-sheet comment-sheet">
          <div class="sheet-handle"></div>
          <div class="comment-sheet-head">
            <div>
              <div class="sheet-title">留言</div>
              <div class="comment-sheet-sub">{{ commentTitle }}</div>
            </div>
            <button class="sheet-close" @click="closeCommentSheet">✕</button>
          </div>
          <AutoGrowTextarea
            v-model="commentDraft"
            class="comment-input"
            :min-rows="4"
            :max-height="240"
            maxlength="2000"
            placeholder="写一点自己的备注、想法或待办"
          />
          <div class="sheet-actions">
            <button class="sheet-btn cancel" @click="closeCommentSheet">取消</button>
            <button class="sheet-btn danger muted" @click="clearComment" :disabled="savingComment || !commentDraft.trim()">清空</button>
            <button class="sheet-btn primary" @click="saveComment" :disabled="savingComment">
              {{ savingComment ? '保存中' : '保存' }}
            </button>
          </div>
        </div>
      </div>
    </transition>

    <transition name="sheet">
      <div v-if="showOrganizer" class="modal-mask" @click.self="showOrganizer = false">
        <div class="bottom-sheet organizer-sheet">
          <div class="sheet-handle"></div>
          <div class="organizer-head">
            <div>
              <div class="sheet-title">今日整理</div>
              <div class="organizer-date">{{ todayLabel }}</div>
            </div>
            <button class="sheet-close" @click="showOrganizer = false">✕</button>
          </div>

          <div class="digest-stats">
            <div class="digest-stat">
              <span class="digest-num">{{ todayDigest.total }}</span>
              <span class="digest-label">收集</span>
            </div>
            <div class="digest-stat">
              <span class="digest-num">{{ todayDigest.topics.length }}</span>
              <span class="digest-label">主题</span>
            </div>
            <div class="digest-stat" :class="{ warn: todayDigest.pending }">
              <span class="digest-num">{{ todayDigest.pending }}</span>
              <span class="digest-label">处理中</span>
            </div>
            <div class="digest-stat" :class="{ danger: todayDigest.failed }">
              <span class="digest-num">{{ todayDigest.failed }}</span>
              <span class="digest-label">失败</span>
            </div>
          </div>

          <div class="digest-section">
            <div class="digest-title">主要主题</div>
            <div v-if="todayDigest.topics.length" class="topic-list">
              <button v-for="topic in todayDigest.topics" :key="topic.label" class="topic-pill" @click="openTopic(topic.label)">
                <span>{{ topic.label }}</span>
                <span>{{ topic.count }}</span>
              </button>
            </div>
            <div v-else class="digest-empty">今天还没有资料</div>
          </div>

          <div class="digest-section" v-if="todayDigest.actions.length">
            <div class="digest-title">可能需要处理</div>
            <button v-for="item in todayDigest.actions" :key="item.file.id" class="digest-row" @click="openFile(item.file.id)">
              <span class="digest-row-main">{{ item.file.original_filename }}</span>
              <span class="digest-row-tag">{{ item.org.topic }}</span>
            </button>
          </div>

          <div class="digest-section" v-if="todayDigest.reading.length">
            <div class="digest-title">稍后读</div>
            <button v-for="item in todayDigest.reading" :key="item.file.id" class="digest-row" @click="openFile(item.file.id)">
              <span class="digest-row-main">{{ item.file.original_filename }}</span>
              <span class="digest-row-tag">{{ item.org.kind }}</span>
            </button>
          </div>
        </div>
      </div>
    </transition>

    <transition name="sheet">
      <div v-if="showSettings" class="modal-mask" @click.self="showSettings = false">
        <div class="bottom-sheet">
          <div class="sheet-handle"></div>
          <div class="sheet-title">设置</div>
          <div class="settings-list">
            <div class="setting-row">
              <div class="setting-label">
                <span>外观模式</span>
                <span class="setting-sub">{{ theme === 'dark' ? '深色' : '浅色' }}</span>
              </div>
              <button class="theme-btn" @click="toggleTheme">
                {{ theme === 'dark' ? '🌙 切换浅色' : '☀️ 切换深色' }}
              </button>
            </div>
            <div class="setting-row" v-if="stats">
              <span class="setting-label">文件总数</span>
              <span class="setting-val">{{ stats.total }} 个</span>
            </div>
          </div>
        </div>
      </div>
    </transition>
  </div>
</template>

<script setup>
import { computed, defineComponent, h, nextTick, onMounted, onUnmounted, reactive, ref } from 'vue'
import { useRouter } from 'vue-router'
import { deleteFile, downloadUrl, getFiles, getStats, imgUrl, updateBatchComment, updateComment, uploadFile, uploadLink, uploadText } from '../api/files'
import AutoGrowTextarea from '../components/AutoGrowTextarea.vue'
import ImageBatchCard from '../components/ImageBatchCard.vue'
import { useTheme } from '../composables/useTheme'
import { groupImageBatches } from '../utils/imageBatchGallery'
import { getAutoProcessLinkUrl } from '../utils/linkAutoProcess'
import { commentPreviewText, fileIcon, fileLabel, fileTypeBackground, isLinkLikeType, shouldCloseCommentSheet } from '../utils/mobileItemDisplay'
import { mobileProcessingText } from '../utils/mobileProcessingStatus'
import { buildTodayDigest, organizeFile } from '../utils/mobileOrganizer'

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

const { theme, toggle: toggleTheme } = useTheme()
const router = useRouter()

const files = ref([])
const loading = ref(false)
const uploading = ref(false)
const textInput = ref('')
const fileInputRef = ref(null)
const showSettings = ref(false)
const showOrganizer = ref(false)
const actionTarget = ref(null)
const deleteTarget = ref(null)
const commentTarget = ref(null)
const commentDraft = ref('')
const savingComment = ref(false)
const stats = ref(null)
const feedEl = ref(null)
const uploadToast = ref('')
const activeBatchImageIds = reactive({})

const HOME_SCROLL_TOP_KEY = 'linkbox.mobile.home.scrollTop'
const HOME_SCROLL_PENDING_KEY = 'linkbox.mobile.home.restoreScroll'

function isImageUpload(file) {
  return file?.type?.startsWith('image/')
}

function createImageBatchId() {
  return `imgbatch-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`
}

function fileIconBg(t) { return fileTypeBackground(t) }
function itemColorIndex(f) { return String(f?.id || '0').charCodeAt(0) % 3 }
function imgBgClass(f) { return ['img-bg-a', 'img-bg-b', 'img-bg-c'][itemColorIndex(f)] }
function linkBgClass(f) { return ['link-bg-a', 'link-bg-b', 'link-bg-c'][itemColorIndex(f)] }
function linkHost(url) {
  try { return new URL(url).hostname.replace('www.', '') } catch { return url }
}
function fmtSize(b) {
  if (!b) return ''
  if (b > 1024 * 1024) return `${(b / 1024 / 1024).toFixed(1)} MB`
  return `${(b / 1024).toFixed(0)} KB`
}
function timeStr(ts) {
  if (!ts) return ''
  const d = new Date(ts)
  return `${d.getHours().toString().padStart(2, '0')}:${d.getMinutes().toString().padStart(2, '0')}`
}

const todayDigest = computed(() => buildTodayDigest(files.value))
const organizerLine = computed(() => {
  const digest = todayDigest.value
  if (!digest.total) return '今天还没有新资料'
  const topicText = digest.topics.slice(0, 2).map(t => t.label).join(' / ')
  return `${digest.total} 条 · ${topicText || '临时资料'}`
})
const todayLabel = computed(() => new Date().toLocaleDateString('zh-CN', { month: 'long', day: 'numeric', weekday: 'long' }))
const actionTitle = computed(() => actionTarget.value?.kind === 'image-batch'
  ? '批量照片'
  : actionTarget.value?.file?.original_filename || actionTarget.value?.original_filename || '操作')
const commentTitle = computed(() => commentTarget.value?.kind === 'image-batch'
  ? '这一批所有照片'
  : commentTarget.value?.original_filename || '')

const dateGroups = computed(() => {
  const map = {}
  for (const f of files.value) {
    const d = f.created_at ? f.created_at.slice(0, 10) : 'unknown'
    if (!map[d]) map[d] = []
    map[d].push(f)
  }
  const today = new Date().toISOString().slice(0, 10)
  const yesterday = new Date(Date.now() - 86400000).toISOString().slice(0, 10)
  return Object.keys(map).sort((a, b) => a.localeCompare(b)).map(date => ({
    date,
    label: date === today ? '今天' : date === yesterday ? '昨天' : date,
    files: groupImageBatches(map[date].sort((a, b) => Number(a.id) - Number(b.id))),
  }))
})

function openFile(id) {
  showOrganizer.value = false
  saveFeedScrollForReturn()
  router.push(`/file/${id}`)
}

function openBatch(row) {
  const first = activeBatchImage(row) || row?.images?.[0]
  if (!first) return
  showOrganizer.value = false
  saveFeedScrollForReturn()
  router.push({ path: `/file/${first.id}`, query: { batchId: row.batchId } })
}
function openTopic(topic) {
  showOrganizer.value = false
  router.push({ path: '/search', query: { q: topic } })
}

let txStart = 0
let tyStart = 0
let txValid = false
function onTouchStart(e) {
  const target = e.target
  txStart = e.touches[0].clientX
  tyStart = e.touches[0].clientY
  txValid = !target.closest('button, input, textarea, select, a, .fm-row, .modal-mask')
}
function onTouchEnd(e) {
  if (!txValid) return
  const dx = e.changedTouches[0].clientX - txStart
  const dy = e.changedTouches[0].clientY - tyStart
  if (Math.abs(dx) <= Math.abs(dy) + 8 || Math.abs(dx) < 48) return
  if (dx < 0) router.push('/category')
  else router.push('/friends')
}

let mouseDown = false
let mxStart = 0
let myStart = 0
let mouseMoved = false
function onMouseDown(e) {
  if (e.button !== 0 || e.target.closest('button, input, textarea, select, a, .modal-mask')) return
  mouseDown = true
  mouseMoved = false
  mxStart = e.clientX
  myStart = e.clientY
}
function onMouseMove(e) {
  if (!mouseDown) return
  if (Math.abs(e.clientX - mxStart) > 5) mouseMoved = true
}
function onMouseUp(e) {
  if (!mouseDown) return
  mouseDown = false
  if (!mouseMoved) return
  const dx = e.clientX - mxStart
  const dy = e.clientY - myStart
  if (Math.abs(dx) <= Math.abs(dy) + 10) return
  if (dx < -60) router.push('/category')
  if (dx > 60) router.push('/friends')
}

function handleCardClick(f, rowId = f?.id) {
  saveFeedScrollForReturn()
  router.push(`/file/${f.id}`)
}

function handleBatchOpen(row, image) {
  openBatch(row)
}

function saveFeedScrollForReturn() {
  const el = feedEl.value
  if (!el) return
  try {
    sessionStorage.setItem(HOME_SCROLL_TOP_KEY, String(el.scrollTop))
    sessionStorage.setItem(HOME_SCROLL_PENDING_KEY, '1')
  } catch {}
}

function consumeSavedFeedScroll() {
  try {
    if (sessionStorage.getItem(HOME_SCROLL_PENDING_KEY) !== '1') return null
    const raw = sessionStorage.getItem(HOME_SCROLL_TOP_KEY)
    sessionStorage.removeItem(HOME_SCROLL_PENDING_KEY)
    sessionStorage.removeItem(HOME_SCROLL_TOP_KEY)
    const top = Number(raw)
    return Number.isFinite(top) ? top : null
  } catch {
    return null
  }
}

function rememberBatchActive(row, image) {
  if (row?.id && image?.id) activeBatchImageIds[row.id] = image.id
}

function activeBatchImage(row) {
  if (row?.kind !== 'image-batch') return null
  const activeId = activeBatchImageIds[row.id]
  return row.images.find(image => image.id === activeId) || row.images[0] || null
}

function rowDeleteTarget(row) {
  return row?.kind === 'image-batch' ? activeBatchImage(row) : row?.file
}

function rowCommentTarget(row) {
  if (row?.kind === 'image-batch') {
    return {
      kind: 'image-batch',
      batchId: row.batchId,
      original_filename: `${row.images.length} 张照片`,
      comment: row.comment || '',
    }
  }
  return row?.file
}

function rowCommentText(row) {
  const file = rowCommentTarget(row)
  if (!file) return ''
  if (row?.kind === 'image-batch') return commentPreviewText(file.comment)
  if (file.type !== 'image') return ''
  return commentPreviewText(file.comment)
}

const isRecording = ref(false)
const speechSupported = ref(false)
let recognition = null

let pollTimer = null
let polling = false
function stopProcessingPoll() {
  if (pollTimer) clearInterval(pollTimer)
  pollTimer = null
}
function syncProcessingPoll() {
  const hasPending = files.value.some(f => f.status === 'pending')
  if (!hasPending) {
    stopProcessingPoll()
    return
  }
  if (pollTimer) return
  pollTimer = setInterval(async () => {
    if (polling) return
    if (!files.value.some(f => f.status === 'pending')) {
      stopProcessingPoll()
      return
    }
    polling = true
    try {
      ;[files.value, stats.value] = await Promise.all([getFiles({ limit: 200 }), getStats()])
      syncProcessingPoll()
    } finally {
      polling = false
    }
  }, 2500)
}

onMounted(() => {
  const SR = window.SpeechRecognition || window.webkitSpeechRecognition
  if (SR) {
    speechSupported.value = true
    recognition = new SR()
    recognition.lang = 'zh-CN'
    recognition.continuous = false
    recognition.interimResults = false
    recognition.onresult = e => {
      textInput.value = e.results[0][0].transcript
      isRecording.value = false
    }
    recognition.onerror = () => { isRecording.value = false }
    recognition.onend = () => { isRecording.value = false }
  }
  const savedScrollTop = consumeSavedFeedScroll()
  loadFiles({
    restoreScrollTop: savedScrollTop,
    scrollToBottom: savedScrollTop === null,
  })
})
onUnmounted(() => {
  recognition?.abort()
  stopProcessingPoll()
})

function toggleVoice() {
  if (!recognition) return
  if (isRecording.value) {
    recognition.stop()
    isRecording.value = false
  } else {
    recognition.start()
    isRecording.value = true
  }
}

async function loadFiles({ restoreScrollTop = null, scrollToBottom = false } = {}) {
  loading.value = true
  try {
    ;[files.value, stats.value] = await Promise.all([getFiles({ limit: 200 }), getStats()])
    syncProcessingPoll()
    await nextTick()
    if (restoreScrollTop !== null) {
      feedEl.value?.scrollTo({ top: restoreScrollTop })
    } else if (scrollToBottom) {
      feedEl.value?.scrollTo({ top: feedEl.value.scrollHeight })
    }
  } finally {
    loading.value = false
  }
}

function triggerUpload() {
  fileInputRef.value?.click()
}

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

async function handlePaste(e) {
  const items = [...(e.clipboardData?.items || [])]
  let handledFile = false
  for (const item of items) {
    if (item.kind === 'file') {
      const f = item.getAsFile()
      if (f) {
        handledFile = true
        await doUpload(f, null, {})
      }
    }
  }
  if (handledFile) return

  const text = e.clipboardData?.getData('text/plain')?.trim()
  if (!text) return
  textInput.value = textInput.value
    ? `${textInput.value}${text}`
    : text
}

async function submitText() {
  const val = textInput.value.trim()
  if (!val) return
  textInput.value = ''
  const autoUrl = getAutoProcessLinkUrl(val)
  if (autoUrl) {
    await doUpload(null, autoUrl)
  } else {
    await sendText(val)
  }
}

async function sendText(text) {
  uploading.value = true
  uploadToast.value = '发送中…'
  try {
    await uploadText(text)
    await loadFiles({ scrollToBottom: true })
    uploadToast.value = '✓ 发送成功'
    setTimeout(() => { feedEl.value?.scrollTo({ top: feedEl.value.scrollHeight, behavior: 'smooth' }) }, 100)
  } catch (e) {
    uploadToast.value = `✗ ${e.response?.data?.error || e.response?.data?.detail || e.message}`
  }
  uploading.value = false
  setTimeout(() => { uploadToast.value = '' }, 2200)
}

async function doUpload(file, url, metadata = {}) {
  uploading.value = true
  uploadToast.value = `上传中 ${file?.name || url || ''}…`
  try {
    if (file) await uploadFile(file, false, metadata)
    else await uploadLink(url, false)
    await loadFiles({ scrollToBottom: true })
    uploadToast.value = '✓ 发送成功'
    setTimeout(() => { feedEl.value?.scrollTo({ top: feedEl.value.scrollHeight, behavior: 'smooth' }) }, 100)
  } catch (e) {
    uploadToast.value = `✗ ${e.response?.data?.error || e.response?.data?.detail || e.message}`
  }
  uploading.value = false
  setTimeout(() => { uploadToast.value = '' }, 2200)
}

function confirmDelete(f) {
  if (!f) return
  deleteTarget.value = f
}

function openActionSheet(row) {
  if (!row) return
  actionTarget.value = row
}

function commentFromAction() {
  const target = rowCommentTarget(actionTarget.value)
  actionTarget.value = null
  openCommentSheet(target)
}

function deleteFromAction() {
  const target = rowDeleteTarget(actionTarget.value)
  actionTarget.value = null
  confirmDelete(target)
}
async function doDelete() {
  try {
    await deleteFile(deleteTarget.value.id)
    files.value = files.value.filter(f => f.id !== deleteTarget.value.id)
  } catch {}
  deleteTarget.value = null
}

function openCommentSheet(f) {
  if (!f) return
  commentTarget.value = f
  commentDraft.value = f.comment || ''
}

function closeCommentSheet({ force = false } = {}) {
  if (!shouldCloseCommentSheet({ saving: savingComment.value, force })) return
  commentTarget.value = null
  commentDraft.value = ''
}

function applyUpdatedComment(updated) {
  if (!updated?.id) return
  files.value = files.value.map(file => (
    file.id === updated.id
      ? { ...file, comment: updated.comment || '' }
      : file
  ))
  if (commentTarget.value?.id === updated.id) {
    commentTarget.value = { ...commentTarget.value, comment: updated.comment || '' }
  }
}

function applyBatchComments(updatedRows) {
  const byId = new Map((updatedRows || []).map(row => [Number(row.id), row]))
  files.value = files.value.map(file => byId.has(Number(file.id))
    ? { ...file, comment: byId.get(Number(file.id)).comment || '' }
    : file)
}

async function saveComment() {
  if (!commentTarget.value) return
  savingComment.value = true
  try {
    if (commentTarget.value.kind === 'image-batch') {
      const updatedRows = await updateBatchComment(commentTarget.value.batchId, commentDraft.value)
      applyBatchComments(updatedRows)
    } else {
      const updated = await updateComment(commentTarget.value.id, commentDraft.value)
      applyUpdatedComment(updated)
    }
    closeCommentSheet({ force: true })
  } finally {
    savingComment.value = false
  }
}

async function clearComment() {
  commentDraft.value = ''
  await saveComment()
}
</script>

<style scoped>
.home {
  position: relative;
  display: flex;
  flex-direction: column;
  height: 100%;
  background: var(--bg);
  overflow: hidden;
}
.fm-bg {
  position: absolute;
  inset: 0;
  pointer-events: none;
  background:
    radial-gradient(ellipse 260px 200px at 20% 8%, rgba(255,170,92,.07) 0%, transparent 65%),
    radial-gradient(ellipse 300px 220px at 85% 85%, rgba(139,114,255,.06) 0%, transparent 65%),
    var(--bg);
}
.fm-hdr {
  position: relative;
  z-index: 10;
  height: var(--header-h);
  background: var(--bg-blur);
  backdrop-filter: blur(24px);
  border-bottom: 1px solid var(--border);
  display: flex;
  align-items: flex-end;
  padding: 0 20px 14px;
  gap: 12px;
  flex-shrink: 0;
}
.fm-av {
  width: 38px;
  height: 38px;
  border-radius: 12px;
  flex-shrink: 0;
  background: linear-gradient(135deg, rgba(255,170,92,.6), rgba(255,110,70,.5));
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 18px;
}
.hdr-copy { min-width: 0; }
.fm-ttl { font-size: 16px; font-weight: 700; color: var(--text); }
.fm-sub { font-size: 11px; color: var(--text3); margin-top: 1px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.icon-btn {
  width: 34px;
  height: 34px;
  border-radius: 50%;
  background: var(--s2);
  border: 1px solid var(--border);
  color: var(--text2);
  display: flex;
  align-items: center;
  justify-content: center;
  margin-left: auto;
}
.fm-search-bar {
  position: relative;
  z-index: 9;
  padding: 10px 16px;
  background: var(--bg-blur);
  backdrop-filter: blur(12px);
  border-bottom: 1px solid var(--border);
  flex-shrink: 0;
  display: flex;
  align-items: center;
  gap: 8px;
}
.friend-entry,
.fm-search-inner {
  border: 1px solid var(--border);
  background: var(--s2);
  color: var(--text2);
}
.friend-entry {
  width: 36px;
  height: 36px;
  border-radius: 11px;
  flex: 0 0 36px;
  display: flex;
  align-items: center;
  justify-content: center;
}
.fm-search-inner {
  flex: 1;
  min-width: 0;
  display: flex;
  align-items: center;
  gap: 8px;
  border-radius: 10px;
  padding: 7px 12px;
}
.fm-search-inner input {
  flex: 1;
  min-width: 0;
  background: none;
  border: none;
  color: var(--text);
  font-size: 13px;
  outline: none;
}
.organizer-strip {
  position: relative;
  z-index: 8;
  margin: 10px 16px 0;
  flex-shrink: 0;
  min-height: 46px;
  border-radius: 14px;
  border: 1px solid rgba(139,114,255,.24);
  background: linear-gradient(135deg, rgba(139,114,255,.15), rgba(94,234,181,.08));
  color: var(--text);
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 8px 12px;
  text-align: left;
}
.org-mark {
  width: 28px;
  height: 28px;
  border-radius: 9px;
  background: var(--accent-s);
  color: var(--accent);
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
}
.org-main { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 2px; }
.org-title { font-size: 13px; font-weight: 800; }
.org-sub { font-size: 11px; color: var(--text3); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.org-alert {
  min-width: 20px;
  height: 20px;
  border-radius: 10px;
  background: rgba(255,110,122,.16);
  color: var(--red);
  font-size: 11px;
  font-weight: 800;
  display: flex;
  align-items: center;
  justify-content: center;
}
.org-arrow { color: var(--text3); flex-shrink: 0; }
.fm-feed {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  overflow-x: hidden;
  padding: 18px 14px 12px;
  display: flex;
  flex-direction: column;
  gap: 10px;
  position: relative;
  z-index: 1;
}
.feed-center {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 10px;
  padding: 60px 0;
  color: var(--text3);
  font-size: 13px;
  margin: auto;
}
.empty-ico { font-size: 44px; opacity: .25; }
.orb-mini {
  width: 36px;
  height: 36px;
  border-radius: 50%;
  background: linear-gradient(135deg, var(--accent), var(--teal));
  animation: spin .9s linear infinite;
  opacity: .5;
}
@keyframes spin { to { transform: rotate(360deg); } }
.fm-date-sep {
  align-self: center;
  border: none;
  background: none;
  color: var(--text3);
  font-size: 11px;
  font-weight: 500;
  padding: 2px 8px;
}
.date-sep-hint { color: var(--accent); font-size: 10px; opacity: .75; }
.fm-row {
  display: flex;
  flex-direction: column;
  align-items: flex-end;
  gap: 2px;
}
.fm-row-inner {
  position: relative;
  display: flex;
  align-items: stretch;
  overflow: hidden;
  border-radius: 16px;
}
.image-batch-row .fm-row-inner {
  overflow: visible;
}
.fm-time {
  font-size: 10px;
  color: var(--text3);
  padding: 0 2px;
  text-align: right;
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
  color: rgba(255,255,255,.9);
  display: flex;
  align-items: center;
  justify-content: center;
  opacity: .9;
  filter: drop-shadow(0 1px 3px rgba(0,0,0,.45));
}
.row-more-btn:active {
  color: #fff;
  opacity: 1;
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
.fm-comment-preview,
.fm-row-comment {
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
.selectable-text,
.fm-link-title,
.fm-link-url,
.fm-file-name,
.fm-file-meta,
.fm-summary-text,
.fm-comment-preview,
.fm-row-comment,
.text-bubble-content {
  -webkit-user-select: text;
  user-select: text;
}
.fm-comment-preview::before,
.fm-row-comment::before {
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
.fm-row-comment {
  max-width: 185px;
  align-self: flex-end;
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
@keyframes pulse { 0%,100%{opacity:1} 50%{opacity:.3} }
.fm-inp {
  position: relative;
  z-index: 10;
  bottom: 16px;
  margin: 0 16px 16px;
  min-height: 50px;
  background: var(--s2);
  border: 1px solid var(--border2);
  border-radius: 25px;
  backdrop-filter: blur(20px);
  display: flex;
  align-items: flex-end;
  padding: 7px 8px 7px 10px;
  gap: 4px;
  flex-shrink: 0;
}
.inp-icon,
.voice-btn,
.send-btn {
  width: 34px;
  height: 34px;
  border-radius: 50%;
  border: none;
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
}
.inp-icon { background: none; color: var(--text2); }
.voice-btn { background: var(--s2); border: 1px solid var(--border); color: var(--text2); }
.voice-btn.recording { background: linear-gradient(135deg, var(--red), #FF4E7E); color: #fff; }
.send-btn { background: var(--accent); color: #fff; }
.fm-inp-field {
  flex: 1;
  min-width: 0;
  min-height: 34px;
  background: none;
  border: none;
  padding: 8px 4px;
  color: var(--text);
  font-size: 13px;
  line-height: 18px;
  outline: none;
  font: inherit;
}
.rec-wave { display: flex; align-items: center; gap: 2px; height: 14px; }
.rec-wave i { width: 2px; border-radius: 1px; background: #fff; animation: wv .8s ease-in-out infinite; }
.rec-wave i:nth-child(1){height:4px} .rec-wave i:nth-child(2){height:10px;animation-delay:.1s}
.rec-wave i:nth-child(3){height:13px;animation-delay:.2s} .rec-wave i:nth-child(4){height:8px;animation-delay:.3s}
.rec-wave i:nth-child(5){height:4px;animation-delay:.4s}
@keyframes wv { 0%,100%{transform:scaleY(1)} 50%{transform:scaleY(.3)} }
.hidden-input { display: none; }
.upload-toast {
  position: absolute;
  bottom: 82px;
  left: 50%;
  transform: translateX(-50%);
  background: var(--bg-blur);
  border: 1px solid var(--border2);
  border-radius: 20px;
  padding: 8px 16px;
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 12px;
  color: var(--text2);
  backdrop-filter: blur(16px);
  white-space: nowrap;
  z-index: 500;
}
.toast-spinner {
  width: 13px;
  height: 13px;
  border: 2px solid rgba(139,114,255,.3);
  border-top-color: var(--accent);
  border-radius: 50%;
  animation: spin .8s linear infinite;
}
.toast-fade-enter-active,
.toast-fade-leave-active { transition: opacity .3s, transform .3s; }
.toast-fade-enter-from,
.toast-fade-leave-to { opacity: 0; transform: translateX(-50%) translateY(8px); }
.modal-mask {
  position: absolute;
  inset: 0;
  z-index: 300;
  background: rgba(0,0,0,.6);
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
  padding: 14px 20px 36px;
}
.sheet-handle {
  width: 38px;
  height: 4px;
  border-radius: 2px;
  background: var(--border2);
  margin: 0 auto 18px;
}
.sheet-title { font-size: 16px; font-weight: 800; color: var(--text); }
.action-sheet {
  padding-bottom: 24px;
}
.action-list {
  display: flex;
  flex-direction: column;
  gap: 8px;
  margin-top: 14px;
}
.action-row {
  width: 100%;
  min-height: 52px;
  border: 1px solid var(--border2);
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
.action-row span {
  font-size: 14px;
  font-weight: 800;
}
.action-row small {
  color: var(--text3);
  font-size: 11px;
  text-align: right;
}
.action-row.danger span {
  color: var(--red);
}
.sheet-body { font-size: 13px; color: var(--text2); margin: 12px 0 22px; line-height: 1.6; word-break: break-word; }
.sheet-actions { display: flex; gap: 10px; }
.sheet-btn {
  flex: 1;
  height: 46px;
  border-radius: 14px;
  border: none;
  font-size: 14px;
  font-weight: 800;
}
.sheet-btn.cancel { background: var(--s2); border: 1px solid var(--border2); color: var(--text); }
.sheet-btn.danger { background: rgba(255,110,122,.15); border: 1.5px solid rgba(255,110,122,.3); color: var(--red); }
.sheet-btn.danger.muted {
  flex: .7;
  background: var(--s2);
  border-color: var(--border2);
  color: var(--text3);
}
.sheet-btn.primary {
  background: var(--accent);
  color: #fff;
}
.sheet-btn:disabled {
  opacity: .45;
}
.comment-sheet {
  padding-bottom: 28px;
}
.comment-sheet-head {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 12px;
  margin-bottom: 12px;
}
.comment-sheet-sub {
  margin-top: 5px;
  color: var(--text3);
  font-size: 12px;
  line-height: 1.4;
  max-width: 270px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.comment-input {
  width: 100%;
  min-height: 132px;
  max-height: 240px;
  resize: none;
  overflow-y: auto;
  -webkit-overflow-scrolling: touch;
  border: 1px solid var(--border2);
  border-radius: 15px;
  background: var(--s1);
  color: var(--text);
  padding: 11px 12px;
  outline: none;
  font: inherit;
  font-size: 14px;
  line-height: 1.55;
  margin-bottom: 14px;
}
.comment-input::placeholder {
  color: var(--text3);
}
.comment-input:focus {
  border-color: rgba(139,114,255,.55);
  box-shadow: 0 0 0 3px rgba(139,114,255,.1);
}
.organizer-head {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 12px;
  margin-bottom: 14px;
}
.organizer-date { margin-top: 4px; font-size: 12px; color: var(--text3); }
.sheet-close {
  width: 30px;
  height: 30px;
  border-radius: 50%;
  border: none;
  background: var(--s2);
  color: var(--text3);
}
.digest-stats {
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  gap: 8px;
  margin-bottom: 16px;
}
.digest-stat {
  min-width: 0;
  padding: 10px 6px;
  border-radius: 14px;
  background: var(--s2);
  border: 1px solid var(--border);
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 3px;
}
.digest-stat.warn .digest-num { color: var(--orange); }
.digest-stat.danger .digest-num { color: var(--red); }
.digest-num { font-size: 18px; font-weight: 900; color: var(--text); }
.digest-label { font-size: 10px; color: var(--text3); white-space: nowrap; }
.digest-section { margin-top: 14px; }
.digest-title {
  font-size: 11px;
  font-weight: 800;
  color: var(--text3);
  letter-spacing: .08em;
  margin-bottom: 8px;
}
.topic-list { display: flex; flex-wrap: wrap; gap: 8px; }
.topic-pill,
.digest-row {
  border: 1px solid var(--border);
  background: var(--s2);
  color: var(--text);
}
.topic-pill {
  height: 30px;
  border-radius: 999px;
  padding: 0 11px;
  display: inline-flex;
  align-items: center;
  gap: 8px;
  font-size: 12px;
}
.topic-pill span:last-child { color: var(--accent); font-weight: 800; }
.digest-row {
  width: 100%;
  min-height: 42px;
  border-radius: 12px;
  padding: 8px 10px;
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 6px;
  text-align: left;
}
.digest-row-main { flex: 1; min-width: 0; font-size: 13px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.digest-row-tag { flex-shrink: 0; font-size: 11px; color: var(--accent); }
.digest-empty { font-size: 13px; color: var(--text3); padding: 10px 0; }
.settings-list { display: flex; flex-direction: column; }
.setting-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 14px 0;
  border-bottom: 1px solid var(--border);
}
.setting-row:last-child { border-bottom: none; }
.setting-label { font-size: 14px; color: var(--text); display: flex; flex-direction: column; gap: 2px; }
.setting-sub { font-size: 11px; color: var(--text3); }
.setting-val { font-size: 14px; color: var(--text2); }
.toggle {
  width: 44px;
  height: 26px;
  border-radius: 13px;
  background: var(--s3);
  position: relative;
  flex-shrink: 0;
}
.toggle.on { background: var(--teal); }
.toggle-thumb {
  position: absolute;
  top: 3px;
  left: 3px;
  width: 20px;
  height: 20px;
  background: #fff;
  border-radius: 50%;
  transition: left .2s;
}
.toggle.on .toggle-thumb { left: 21px; }
.theme-btn {
  padding: 7px 14px;
  border-radius: 20px;
  background: var(--accent-s);
  border: 1px solid rgba(139,114,255,.25);
  color: var(--accent);
  font-size: 13px;
  font-weight: 700;
}
.sheet-enter-active,
.sheet-leave-active { transition: opacity .3s; }
.sheet-enter-active .bottom-sheet,
.sheet-leave-active .bottom-sheet { transition: transform .36s cubic-bezier(.32,.72,0,1); }
.sheet-enter-from,
.sheet-leave-to { opacity: 0; }
.sheet-enter-from .bottom-sheet,
.sheet-leave-to .bottom-sheet { transform: translateY(100%); }
</style>

<style>
.fm-summary-text,
.fm-link-summary,
.fm-status-line,
.ai-organized-line {
  font-size: 9px;
  line-height: 1.25;
  font-weight: 400;
  color: var(--text3);
  opacity: .68;
  display: -webkit-box;
  -webkit-box-orient: vertical;
  overflow: hidden;
}
.fm-summary-text {
  padding: 0 10px 5px;
  color: rgba(150,150,165,.58);
  -webkit-line-clamp: 1;
}
.fm-link-summary {
  margin-top: 2px;
  color: rgba(150,150,165,.58);
  -webkit-line-clamp: 1;
}
.fm-status-line {
  padding: 0 10px 4px;
  -webkit-line-clamp: 1;
}
.fm-status-line.in-card,
.ai-organized-line.in-card {
  padding: 2px 0 0;
}
.fm-status-line.pending { color: rgba(255,170,92,.62); }
.fm-status-line.failed { color: rgba(255,93,108,.62); }
.ai-organized-line {
  padding: 0 10px 4px;
  color: rgba(94,234,181,.42);
  -webkit-line-clamp: 1;
}
.ai-organized-line.bubble {
  margin-top: 5px;
  padding: 0;
  color: rgba(255,255,255,.46);
}
</style>
