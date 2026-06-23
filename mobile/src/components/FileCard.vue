<template>
  <div class="fm-card-wrap">
    <div
      class="fm-file-card gc"
      :class="{ 'no-pad': isLinkLike && file.og_image }"
      @click="handleClick"
    >
      <!-- Link card with OG image banner -->
      <template v-if="isLinkLike && file.og_image">
        <div class="fm-link-card">
          <img class="link-og" :src="file.og_image" loading="lazy" @error="e => e.target.style.display='none'" />
          <div class="link-body">
            <div class="link-title-row">
              <img v-if="file.favicon_url" class="link-favicon" :src="file.favicon_url" loading="lazy" @error="e => e.target.style.display='none'" />
              <span class="fm-file-name">{{ file.original_filename }}</span>
            </div>
            <div class="fm-file-meta">
              <span class="type-chip" :class="file.type">{{ typeLabel }}</span>
              <span class="status-dot" :class="file.status"></span>
              <span class="meta-time">{{ timeStr }}</span>
            </div>
            <div v-if="file.summary" class="fm-summary">{{ file.summary }}</div>
          </div>
        </div>
      </template>
      <template v-else>
        <div class="fm-file-ico" :class="iconBg">
          <img v-if="isLinkLike && file.favicon_url" class="ico-favicon" :src="file.favicon_url" loading="lazy" @error="e => e.target.style.display='none'" />
          <span v-else>{{ typeIcon }}</span>
        </div>
        <div class="fm-file-body">
          <div class="fm-file-name">{{ file.original_filename }}</div>
          <div class="fm-file-meta">
            <span class="type-chip" :class="file.type">{{ typeLabel }}</span>
            <span class="status-dot" :class="file.status"></span>
            <span class="meta-time">{{ timeStr }}</span>
          </div>
          <div v-if="file.summary" class="fm-summary">{{ file.summary }}</div>
        </div>
      </template>
    </div>
  </div>
</template>

<script setup>
import { computed } from 'vue'
import { fileIcon, fileLabel, iconBackgroundClass, isLinkLikeType } from '../utils/mobileItemDisplay'

const props = defineProps({ file: Object })
const emit = defineEmits(['click'])

const typeIcon = computed(() => fileIcon(props.file.type))
const typeLabel = computed(() => fileLabel(props.file.type))
const iconBg = computed(() => iconBackgroundClass(props.file.type))
const isLinkLike = computed(() => isLinkLikeType(props.file.type))

const timeStr = computed(() => {
  const d = new Date(props.file.created_at)
  return `${d.getHours().toString().padStart(2,'0')}:${d.getMinutes().toString().padStart(2,'0')}`
})

function handleClick() {
  emit('click', props.file)
}
</script>

<style scoped>
.fm-card-wrap {
  position: relative;
  overflow: hidden;
  border-radius: 16px;
}

.fm-file-card {
  width: 100%;
  padding: 12px 14px;
  display: flex;
  gap: 12px;
  align-items: center;
  cursor: pointer;
  border-radius: 16px;
  transition: background .15s, box-shadow .2s;
  position: relative; z-index: 1;
}
.fm-file-card:active { background: var(--s3); transform: scale(.97); }

.fm-file-ico {
  width: 44px; height: 44px;
  border-radius: 12px;
  display: flex; align-items: center; justify-content: center;
  font-size: 22px; flex-shrink: 0;
}
.ico-purple { background: rgba(139,114,255,.15); box-shadow: 0 2px 10px rgba(139,114,255,.18); }
.ico-red    { background: rgba(255,110,122,.15); box-shadow: 0 2px 10px rgba(255,110,122,.18); }
.ico-teal   { background: rgba(94,234,181,.15);  box-shadow: 0 2px 10px rgba(94,234,181,.18);  }
.ico-orange { background: rgba(255,170,92,.15);  box-shadow: 0 2px 10px rgba(255,170,92,.18);  }
.ico-blue   { background: rgba(100,170,255,.15); box-shadow: 0 2px 10px rgba(100,170,255,.18); }
.ico-gray   { background: var(--s3); }

.fm-file-body { flex: 1; min-width: 0; }

.fm-file-name {
  font-size: 14px; font-weight: 600; color: var(--text);
  margin-bottom: 4px;
  white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
  -webkit-user-select: text;
  user-select: text;
}

.fm-file-meta {
  display: flex; align-items: center; gap: 6px;
  font-size: 11px; color: var(--text3);
  -webkit-user-select: text;
  user-select: text;
}
.meta-time { color: var(--text3); }

.type-chip {
  font-size: 10px; font-weight: 600;
  padding: 2px 7px; border-radius: 6px;
}
.type-chip.image    { background: rgba(139,114,255,.15); color: var(--accent); }
.type-chip.video    { background: rgba(255,110,122,.15); color: var(--red); }
.type-chip.document { background: rgba(94,234,181,.15);  color: var(--teal); }
.type-chip.audio    { background: rgba(255,170,92,.15);  color: var(--orange); }
.type-chip.link     { background: rgba(100,170,255,.15); color: #64AAFF; }
.type-chip.other    { background: var(--s3);             color: var(--text3); }

.status-dot {
  width: 6px; height: 6px; border-radius: 50%; flex-shrink: 0;
}
.status-dot.pending { background: var(--orange); animation: pulse 1.4s infinite; }
.status-dot.ready   { background: var(--teal); }
.status-dot.failed  { background: var(--red); }
@keyframes pulse { 0%,100%{opacity:1} 50%{opacity:.3} }

.fm-file-card.no-pad { padding: 0; overflow: hidden; }

/* Link card with OG image */
.fm-link-card {
  flex: 1; min-width: 0;
  display: flex; flex-direction: column;
}
.link-og {
  width: 100%; height: 110px;
  object-fit: cover;
  display: block;
}
.link-body {
  padding: 8px 12px 10px;
  display: flex; flex-direction: column; gap: 4px;
}
.link-title-row {
  display: flex; align-items: center; gap: 6px;
}
.link-favicon {
  width: 14px; height: 14px; border-radius: 3px; flex-shrink: 0;
  object-fit: contain;
}
.ico-favicon {
  width: 22px; height: 22px; border-radius: 5px; object-fit: contain;
}

.fm-summary {
  font-size: 11px; color: var(--text3);
  margin-top: 5px;
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
  line-height: 1.5;
  -webkit-user-select: text;
  user-select: text;
}
</style>
