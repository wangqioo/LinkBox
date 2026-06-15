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
            @touchstart.passive="onCardTS($event, f.id)"
            @touchmove.passive="onCardTM($event, f.id)"
            @touchend.passive="onCardTE(f.id)"
          >
            <div class="fm-row-inner">
              <ImageBatchCard
                v-if="f.kind === 'image-batch'"
                :images="f.images"
                :style="{ transform: `translateX(${swipe[f.id] || 0}px)` }"
                @open="handleCardClick"
                @active-change="rememberBatchActive(f, $event)"
                @delete-active="confirmDelete"
              />

              <div
                v-else-if="f.file.type === 'image'"
                class="fm-img-card"
                :style="{ transform: `translateX(${swipe[f.id] || 0}px)` }"
                @click="handleCardClick(f.file, f.id)"
              >
                <div class="fm-img-inner" :class="imgBgClass(f.file)">
                  <img :src="downloadUrl(f.file.id)" class="img-thumb" loading="lazy" @error="e => e.target.style.display='none'" />
                </div>
                <div class="fm-img-lbl">
                  <span class="img-lbl-name">{{ f.file.original_filename }}</span>
                  <span class="status-dot" :class="f.file.status"></span>
                </div>
                <FileHints :file="f.file" />
              </div>

              <div
                v-else-if="f.file.type === 'link'"
                class="fm-link-card"
                :style="{ transform: `translateX(${swipe[f.id] || 0}px)` }"
                @click="handleCardClick(f.file, f.id)"
              >
                <div class="fm-link-preview" :class="linkBgClass(f.file)">
                  <img v-if="f.file.og_image" :src="imgUrl(f.file.og_image)" class="link-og-img" loading="lazy" @error="e => e.target.style.display='none'" />
                  <template v-else>
                    <img v-if="f.file.favicon_url" :src="f.file.favicon_url" class="link-fav-big" loading="lazy" @error="e => e.target.style.display='none'" />
                    <span v-else class="fallback-ico">🔗</span>
                  </template>
                </div>
                <div class="fm-link-info">
                  <div class="fm-link-title">{{ f.file.original_filename }}</div>
                  <div class="fm-link-url">
                    <img v-if="f.file.favicon_url" :src="f.file.favicon_url" class="link-fav-sm" @error="e => e.target.style.display='none'" />
                    {{ linkHost(f.file.url || f.file.original_filename) }}
                  </div>
                  <FileHints :file="f.file" in-card />
                </div>
              </div>

              <div
                v-else-if="f.file.type === 'text'"
                class="fm-text-bubble"
                :style="{ transform: `translateX(${swipe[f.id] || 0}px)` }"
                @click="handleCardClick(f.file, f.id)"
              >
                <div class="text-bubble-content">{{ f.file.content || f.file.summary || f.file.original_filename }}</div>
                <FileHints :file="f.file" bubble />
              </div>

              <div
                v-else
                class="fm-file-card"
                :style="{ transform: `translateX(${swipe[f.id] || 0}px)` }"
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
                </div>
                <button class="fm-file-open" @click.stop="router.push(`/file/${f.file.id}`)">↗</button>
              </div>

              <button
                class="delete-action"
                :class="{ visible: (swipe[f.id] || 0) < -20 }"
                @click.stop="confirmDelete(rowDeleteTarget(f))"
                aria-label="删除"
              >
                <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                  <polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/><path d="M10 11v6"/><path d="M14 11v6"/>
                </svg>
              </button>
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
      <input
        v-model="textInput"
        class="fm-inp-field"
        placeholder="粘贴链接或发送文字给自己…"
        @keydown.enter="submitText"
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
            <div class="setting-row">
              <div class="setting-label">
                <span>上传后立即 AI 分析</span>
                <span class="setting-sub">关闭则后台队列处理</span>
              </div>
              <div class="toggle" :class="{ on: analyzeNow }" @click="analyzeNow = !analyzeNow">
                <div class="toggle-thumb"></div>
              </div>
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
import { deleteFile, downloadUrl, getFiles, getStats, imgUrl, uploadFile, uploadLink, uploadText } from '../api/files'
import ImageBatchCard from '../components/ImageBatchCard.vue'
import { useTheme } from '../composables/useTheme'
import { groupImageBatches } from '../utils/imageBatchGallery'
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
      const status = file.status === 'pending'
        ? (file.processing?.label || '后台处理中')
        : file.status === 'failed'
          ? 'AI 分析失败'
          : ''
      const org = organizeFile(file)
      const children = []
      if (status) {
        children.push(h('div', { class: ['fm-status-line', file.status, { 'in-card': props.inCard, bubble: props.bubble }] }, status))
      }
      children.push(h('div', { class: ['ai-organized-line', { 'in-card': props.inCard, bubble: props.bubble }] }, `归入 ${org.topic} · ${org.kind}`))
      if (file.summary) {
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
const analyzeNow = ref(false)
const showSettings = ref(false)
const showOrganizer = ref(false)
const deleteTarget = ref(null)
const stats = ref(null)
const feedEl = ref(null)
const uploadToast = ref('')
const swipe = reactive({})
const swipeMeta = reactive({})
const activeBatchImageIds = reactive({})

const FILE_ICONS = { image: '🖼', video: '🎬', document: '📄', audio: '🎵', link: '🔗', text: '💬', other: '📦' }
const FILE_LABELS = { image: '图片', video: '视频', document: '文档', audio: '音频', link: '链接', text: '文字', other: '其他' }
const FILE_BG = {
  image: 'rgba(139,114,255,.15)',
  video: 'rgba(255,110,122,.15)',
  document: 'rgba(94,234,181,.15)',
  audio: 'rgba(255,170,92,.15)',
  link: 'rgba(100,170,255,.15)',
  text: 'rgba(139,114,255,.15)',
  other: 'rgba(255,255,255,.08)',
}

function isImageUpload(file) {
  return file?.type?.startsWith('image/')
}

function createImageBatchId() {
  return `imgbatch-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`
}

function fileIcon(t) { return FILE_ICONS[t] || '📦' }
function fileLabel(t) { return FILE_LABELS[t] || '其他' }
function fileIconBg(t) { return FILE_BG[t] || FILE_BG.other }
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
  router.push(`/file/${id}`)
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

function onCardTS(e, id) {
  swipeMeta[id] = { sx: e.touches[0].clientX, sy: e.touches[0].clientY, moving: false }
}
function onCardTM(e, id) {
  const m = swipeMeta[id]
  if (!m) return
  const dx = e.touches[0].clientX - m.sx
  const dy = e.touches[0].clientY - m.sy
  if (!m.moving && Math.abs(dx) > Math.abs(dy) + 5) m.moving = true
  if (!m.moving) return
  swipe[id] = Math.max(-72, Math.min(0, dx))
}
function onCardTE(id) {
  swipe[id] = (swipe[id] || 0) < -36 ? -64 : 0
  if (swipeMeta[id]) swipeMeta[id].moving = false
}
function handleCardClick(f, rowId = f?.id) {
  if ((swipe[rowId] || 0) < -10) {
    swipe[rowId] = 0
    return
  }
  router.push(`/file/${f.id}`)
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
  loadFiles()
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

async function loadFiles() {
  loading.value = true
  try {
    ;[files.value, stats.value] = await Promise.all([getFiles({ limit: 200 }), getStats()])
    syncProcessingPoll()
    await nextTick()
    feedEl.value?.scrollTo({ top: feedEl.value.scrollHeight })
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
  if (text.startsWith('http://') || text.startsWith('https://')) {
    await doUpload(null, text)
  } else {
    await sendText(text)
  }
}

async function submitText() {
  const val = textInput.value.trim()
  if (!val) return
  textInput.value = ''
  if (val.startsWith('http://') || val.startsWith('https://')) {
    await doUpload(null, val)
  } else {
    await sendText(val)
  }
}

async function sendText(text) {
  uploading.value = true
  uploadToast.value = '发送中…'
  try {
    await uploadText(text)
    await loadFiles()
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
    if (file) await uploadFile(file, analyzeNow.value, metadata)
    else await uploadLink(url, analyzeNow.value)
    await loadFiles()
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
async function doDelete() {
  try {
    await deleteFile(deleteTarget.value.id)
    files.value = files.value.filter(f => f.id !== deleteTarget.value.id)
  } catch {}
  deleteTarget.value = null
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
  padding: 18px 22px 12px 14px;
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
.delete-action {
  position: absolute;
  right: 0;
  top: 0;
  bottom: 0;
  width: 64px;
  background: rgba(255,60,60,.85);
  border: none;
  display: flex;
  align-items: center;
  justify-content: center;
  color: #fff;
  border-radius: 0 16px 16px 0;
  opacity: 0;
  z-index: 0;
}
.delete-action.visible { opacity: 1; }
.fm-img-card,
.fm-link-card,
.fm-file-card,
.fm-text-bubble {
  position: relative;
  z-index: 1;
  transition: transform .3s cubic-bezier(.32,.72,0,1);
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
.fm-img-card { max-width: 185px; }
.fm-img-inner {
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
.fm-img-lbl {
  font-size: 11px;
  color: var(--text3);
  padding: 5px 10px 7px;
  background: var(--s2);
  display: flex;
  align-items: center;
  gap: 5px;
}
.img-lbl-name { flex: 1; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
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
.fm-link-info { padding: 8px 12px 10px; }
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
.fm-file-card {
  padding: 12px 14px;
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
  padding: 10px 14px;
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
  height: 50px;
  background: var(--s2);
  border: 1px solid var(--border2);
  border-radius: 25px;
  backdrop-filter: blur(20px);
  display: flex;
  align-items: center;
  padding: 0 8px 0 10px;
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
  height: 34px;
  background: none;
  border: none;
  padding: 0 4px;
  color: var(--text);
  font-size: 13px;
  outline: none;
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
