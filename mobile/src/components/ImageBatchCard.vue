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
          <div class="batch-count">{{ activeIndex + 1 }} / {{ images.length }}</div>
          <span class="batch-status-dot" :class="activeImage?.status"></span>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup>
import { computed, ref, watch } from 'vue'
import { downloadUrl } from '../api/files'

const props = defineProps({
  images: { type: Array, default: () => [] },
})

const emit = defineEmits(['open', 'active-change'])

const activeIndex = ref(0)
const activeImage = computed(() => props.images[activeIndex.value] || props.images[0] || null)
const backImages = computed(() => props.images
  .filter((_, index) => index !== activeIndex.value)
  .slice(0, 2))

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

</script>

<style scoped>
.image-batch-card {
  position: relative;
  z-index: 1;
  width: min(70vw, 214px);
  padding: 0;
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
  border-radius: 16px;
  background: linear-gradient(135deg, rgba(100,170,255,.18), rgba(94,234,181,.12));
  box-shadow: 0 18px 42px rgba(0,0,0,.22);
}
.batch-image {
  width: 100%;
  height: 100%;
  object-fit: cover;
  display: block;
}
.batch-count {
  position: absolute;
  color: #fff;
  backdrop-filter: blur(12px);
}
.batch-count {
  right: 24px;
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
.batch-status-dot {
  position: absolute;
  right: 8px;
  bottom: 8px;
  width: 9px;
  height: 9px;
  border-radius: 50%;
  border: 2px solid rgba(255,255,255,.9);
  box-shadow: 0 2px 8px rgba(0,0,0,.24);
}
.batch-status-dot.pending { background: var(--orange); animation: pulse 1.4s infinite; }
.batch-status-dot.ready { background: var(--teal); }
.batch-status-dot.failed { background: var(--red); }
@keyframes pulse { 0%,100%{opacity:1} 50%{opacity:.3} }
</style>
