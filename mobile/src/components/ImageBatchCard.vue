<template>
  <div
    class="image-batch-card"
    @click="openActive"
    @touchstart.stop="onTouchStart"
    @touchmove.stop="onTouchMove"
    @touchend.stop="onTouchEnd"
    @touchcancel.stop="resetTouch"
  >
    <div class="batch-surface">
      <div class="deck-stage">
        <div v-if="backImages[1]" class="stack-photo stack-photo-2">
          <img :src="downloadUrl(backImages[1].id)" alt="" loading="lazy" />
        </div>
        <div v-if="backImages[0]" class="stack-photo stack-photo-1">
          <img :src="downloadUrl(backImages[0].id)" alt="" loading="lazy" />
        </div>

        <div class="batch-media">
          <img
            v-if="activeImage?.id"
            :src="downloadUrl(activeImage.id)"
            class="batch-image"
            loading="lazy"
            @error="event => { event.target.style.visibility = 'hidden' }"
          />
          <button class="batch-delete" @click.stop="emitDelete" aria-label="删除当前图片">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.1" stroke-linecap="round" stroke-linejoin="round">
              <polyline points="3 6 5 6 21 6"/>
              <path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/>
              <path d="M10 11v6"/>
              <path d="M14 11v6"/>
              <path d="M9 6V4h6v2"/>
            </svg>
          </button>
          <div class="batch-count">{{ activeIndex + 1 }} / {{ images.length }}</div>
        </div>
      </div>

      <div class="batch-info">
        <div class="batch-title-row">
          <span class="batch-title">{{ activeImage?.original_filename || '图片' }}</span>
          <span class="status-dot" :class="activeImage?.status"></span>
        </div>
        <div class="batch-dots" aria-hidden="true">
          <span
            v-for="(_, index) in images"
            :key="index"
            :class="{ active: index === activeIndex }"
          ></span>
        </div>
        <div v-if="statusText" class="batch-status" :class="activeImage?.status">{{ statusText }}</div>
        <div class="batch-org">{{ orgLine }}</div>
        <div v-if="activeImage?.summary" class="batch-summary">{{ activeImage.summary }}</div>
      </div>
    </div>
  </div>
</template>

<script setup>
import { computed, ref, watch } from 'vue'
import { downloadUrl } from '../api/files'
import { organizeFile } from '../utils/mobileOrganizer'

const props = defineProps({
  images: { type: Array, default: () => [] },
})

const emit = defineEmits(['open', 'active-change', 'delete-active'])

const activeIndex = ref(0)
const activeImage = computed(() => props.images[activeIndex.value] || props.images[0] || null)
const backImages = computed(() => props.images
  .filter((_, index) => index !== activeIndex.value)
  .slice(0, 2))
const orgLine = computed(() => {
  if (!activeImage.value) return '归入 临时资料 · 图片'
  const org = organizeFile(activeImage.value)
  return `归入 ${org.topic} · ${org.kind}`
})
const statusText = computed(() => {
  const file = activeImage.value
  if (!file) return ''
  if (file.status === 'pending') return file.processing?.label || '后台处理中'
  if (file.status === 'failed') return 'AI 分析失败，点开查看详情'
  return ''
})

let startX = 0
let startY = 0
let lastDx = 0
let swiping = false
let suppressClickUntil = 0

watch(
  () => props.images.length,
  (count) => {
    if (!count) activeIndex.value = 0
    else if (activeIndex.value >= count) activeIndex.value = count - 1
  },
)

watch(activeImage, (image) => {
  if (image?.id) emit('active-change', image)
}, { immediate: true })

function move(delta) {
  if (!props.images.length) return
  activeIndex.value = Math.max(0, Math.min(props.images.length - 1, activeIndex.value + delta))
}

function onTouchStart(event) {
  startX = event.touches[0].clientX
  startY = event.touches[0].clientY
  lastDx = 0
  swiping = false
}

function onTouchMove(event) {
  const dx = event.touches[0].clientX - startX
  const dy = event.touches[0].clientY - startY
  if (!swiping && Math.abs(dx) > Math.abs(dy) + 6) swiping = true
  if (!swiping) return
  lastDx = dx
  event.preventDefault()
}

function onTouchEnd() {
  if (swiping && Math.abs(lastDx) > 36) {
    move(lastDx < 0 ? 1 : -1)
    suppressClickUntil = Date.now() + 260
  }
  resetTouch()
}

function resetTouch() {
  startX = 0
  startY = 0
  lastDx = 0
  swiping = false
}

function openActive() {
  if (Date.now() < suppressClickUntil || !activeImage.value) return
  emit('open', activeImage.value)
}

function emitDelete() {
  if (activeImage.value) emit('delete-active', activeImage.value)
}
</script>

<style scoped>
.image-batch-card {
  position: relative;
  z-index: 1;
  width: min(70vw, 214px);
  padding: 0 0 4px;
  cursor: pointer;
  touch-action: pan-y;
  transition: transform .3s cubic-bezier(.32,.72,0,1);
}
.deck-stage {
  position: relative;
  padding: 20px 0 0 26px;
}
.stack-photo {
  position: absolute;
  width: calc(100% - 26px);
  height: 144px;
  left: 26px;
  top: 20px;
  overflow: hidden;
  border: 1px solid rgba(255,255,255,.18);
  border-radius: 16px;
  background: var(--s2);
  box-shadow: 0 10px 26px rgba(0,0,0,.18);
  pointer-events: none;
}
.stack-photo img {
  width: 100%;
  height: 100%;
  object-fit: cover;
  display: block;
}
.stack-photo::after {
  content: '';
  position: absolute;
  inset: 0;
  background: rgba(8,12,20,.22);
}
.stack-photo-1 {
  transform: translate(-14px, -8px) rotate(-4.5deg);
  opacity: .84;
}
.stack-photo-2 {
  transform: translate(-25px, -15px) rotate(-8deg);
  opacity: .58;
}
.batch-surface {
  position: relative;
  background: transparent;
}
.batch-media {
  position: relative;
  height: 144px;
  overflow: hidden;
  border: 1px solid rgba(255,255,255,.18);
  border-radius: 16px 16px 10px 10px;
  background: linear-gradient(135deg, rgba(100,170,255,.18), rgba(94,234,181,.12));
  box-shadow: 0 18px 42px rgba(0,0,0,.22);
}
.batch-image {
  width: 100%;
  height: 100%;
  object-fit: cover;
  display: block;
}
.batch-delete,
.batch-count {
  position: absolute;
  color: #fff;
  backdrop-filter: blur(12px);
}
.batch-delete {
  top: 8px;
  right: 8px;
  width: 28px;
  height: 28px;
  border-radius: 50%;
  border: 1px solid rgba(255,255,255,.2);
  background: rgba(0,0,0,.34);
  display: flex;
  align-items: center;
  justify-content: center;
}
.batch-delete:active { background: rgba(255,60,60,.84); }
.batch-count {
  right: 8px;
  bottom: 8px;
  height: 22px;
  border-radius: 11px;
  padding: 0 8px;
  background: rgba(0,0,0,.42);
  display: flex;
  align-items: center;
  font-size: 11px;
  font-weight: 800;
}
.batch-info {
  margin-left: 26px;
  padding: 7px 10px 8px;
  border: 1px solid rgba(255,255,255,.18);
  border-top: none;
  border-radius: 0 0 16px 16px;
  background: var(--s2);
  box-shadow: 0 12px 30px rgba(0,0,0,.12);
}
.batch-title-row {
  display: flex;
  align-items: center;
  gap: 5px;
}
.batch-title {
  flex: 1;
  min-width: 0;
  color: var(--text3);
  font-size: 11px;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.batch-dots {
  display: flex;
  gap: 4px;
  margin-top: 6px;
}
.batch-dots span {
  width: 5px;
  height: 5px;
  border-radius: 50%;
  background: var(--border2);
}
.batch-dots span.active {
  width: 13px;
  border-radius: 5px;
  background: var(--accent);
}
.batch-status,
.batch-org,
.batch-summary {
  margin-top: 4px;
  font-size: 10px;
  line-height: 1.35;
  font-weight: 400;
  display: -webkit-box;
  -webkit-box-orient: vertical;
  overflow: hidden;
}
.batch-status {
  color: var(--text3);
  -webkit-line-clamp: 1;
}
.batch-status.pending { color: rgba(255,170,92,.78); }
.batch-status.failed { color: rgba(255,93,108,.78); }
.batch-org {
  color: rgba(94,234,181,.55);
  -webkit-line-clamp: 1;
}
.batch-summary {
  color: rgba(150,150,165,.78);
  -webkit-line-clamp: 1;
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
</style>
