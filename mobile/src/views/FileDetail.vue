<template>
  <div class="page">
    <div class="detail-bg"></div>
    <header class="app-hdr">
      <button class="app-back" @click="$router.back()">‹</button>
      <span class="app-hdr-ttl">文件详情</span>
      <button class="app-hdr-act" @click="confirmDelete" title="删除">🗑</button>
    </header>

    <div class="app-body">
      <div v-if="loading" class="center-tip">加载中...</div>
      <div v-else-if="!file" class="center-tip">文件不存在</div>

      <template v-else>
        <!-- Hero -->
        <div class="hero gc" :class="{ 'hero-img': file.type === 'image' || (isLinkLike && file.og_image) }">
          <div class="hero-glow"></div>
          <!-- Image preview -->
          <template v-if="file.type === 'image'">
            <div class="hero-img-wrap">
              <img
                :src="downloadUrl(file.id)"
                class="hero-img-el"
                loading="lazy"
                @error="e => e.target.closest('.hero-img-wrap').innerHTML = '<span style=\'font-size:52px\'>🖼</span>'"
              />
            </div>
          </template>
          <!-- Link cover image -->
          <template v-else-if="isLinkLike && file.og_image">
            <div class="hero-img-wrap">
              <img
                :src="imgUrl(file.og_image)"
                class="hero-img-el"
                loading="lazy"
                @error="e => e.target.closest('.hero-img-wrap').innerHTML = '<span style=\'font-size:52px\'>🔗</span>'"
              />
            </div>
          </template>
          <div v-else class="hero-icon">{{ typeIcon }}</div>
          <div class="hero-name">{{ isLinkLike ? (file.summary || file.original_filename) : file.original_filename }}</div>
          <div class="hero-badges">
            <span class="type-chip" :class="file.type">{{ typeLabel }}</span>
            <span class="status-chip" :class="file.status">{{ statusLabel }}</span>
          </div>
          <div class="hero-time">{{ timeStr }}</div>
        </div>

        <!-- AI Summary -->
        <div class="info-card gc">
          <div class="card-label">AI 简介</div>
          <div v-if="file.status === 'pending'" class="state-row">
            <div class="mini-orb"></div>
            <div class="state-copy">
              <span class="state-title">{{ processingLabel }}</span>
              <span v-if="file.processing?.stage" class="state-detail">{{ file.processing.stage }}</span>
            </div>
            <button class="action-link" @click="handlePendingAction" :disabled="analyzing || loading">
              {{ pendingActionLabel }}
            </button>
          </div>
          <div v-else-if="file.status === 'failed'" class="state-row failed">
            <div class="state-copy">
              <span class="state-title">处理失败</span>
              <span class="state-detail">{{ processingError }}</span>
            </div>
            <button class="action-link" @click="triggerAnalyze" :disabled="analyzing">重试</button>
          </div>
          <template v-else>
            <div v-if="!isLinkLike" class="summary-text">{{ file.summary || '暂无简介' }}</div>
            <div class="desc-text">{{ file.description || (isLinkLike ? file.summary : '') || '暂无简介' }}</div>
            <!-- WeChat read full article button -->
            <button v-if="isWechat" class="read-btn" @click="loadArticle" :disabled="extracting">
              <span v-if="extracting" class="read-btn-orb"></span>
              <span>{{ extracting ? '正在提取正文…' : (file.has_content || file.content_md ? '📖 查看原文' : '📖 提取原文') }}</span>
            </button>
          </template>
        </div>

        <!-- Video transcript -->
        <div v-if="isBilibiliVideo && videoTranscriptMd" class="info-card gc transcript-card">
          <div class="card-label">视频原文</div>
          <div class="transcript-body md-content" v-html="renderedVideoTranscript"></div>
        </div>

        <!-- Article markdown reader overlay -->
        <transition name="slide-up">
          <div v-if="showArticle" class="article-overlay">
            <div class="article-hdr">
              <button class="article-close" @click="showArticle = false">✕</button>
              <span class="article-hdr-ttl">原文</span>
              <span style="width:32px"></span>
            </div>
            <div class="article-meta" v-if="articleMeta">
              <div class="article-title">{{ articleMeta.title }}</div>
              <div class="article-byline">
                <span v-if="articleMeta.author">{{ articleMeta.author }}</span>
                <span v-if="articleMeta.pub_time">· {{ articleMeta.pub_time }}</span>
              </div>
            </div>
            <div class="article-body md-content" v-html="renderedMd"></div>
          </div>
        </transition>

        <!-- Highlights -->
        <div v-if="file.highlights?.length" class="info-card gc">
          <div class="card-label">亮点</div>
          <ul class="highlight-list">
            <li v-for="h in file.highlights" :key="h">{{ h }}</li>
          </ul>
        </div>

        <!-- Link -->
        <div v-if="file.url && !isWechat" class="info-card gc">
          <div class="card-label">原始链接</div>
          <a :href="file.url" target="_blank" class="link-url">{{ file.url }}</a>
        </div>

        <!-- Actions -->
        <div class="actions">
          <a v-if="!isLinkLike"
            :href="downloadUrl(file.id)"
            class="btn-primary" download>
            ⬇ 下载文件
          </a>
          <a v-if="file.url" :href="file.url" target="_blank" class="btn-primary">
            🔗 打开链接
          </a>
          <button v-if="file.status !== 'ready'"
            class="btn-secondary" @click="triggerAnalyze" :disabled="analyzing">
            {{ analyzing ? '分析中...' : '🤖 AI 分析' }}
          </button>
        </div>
      </template>
    </div>
  </div>
</template>

<script setup>
import { ref, computed, onMounted } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { getFile, analyzeFile, deleteFile, extractContent, imgUrl, downloadUrl } from '../api/files'
import { fileIcon, fileLabel, isLinkLikeType } from '../utils/mobileItemDisplay'

const route = useRoute()
const router = useRouter()
const file = ref(null)
const loading = ref(true)
const analyzing = ref(false)
const articleMd = ref('')
const articleMeta = ref(null)
const extracting = ref(false)
const showArticle = ref(false)

const isLinkLike = computed(() => {
  return isLinkLikeType(file.value?.type)
})

const isWechat = computed(() => {
  const url = file.value?.url || ''
  return isLinkLike.value && (url.includes('mp.weixin.qq.com') || url.includes('weixin.qq.com'))
})

const isBilibiliVideo = computed(() => {
  const url = file.value?.url || ''
  return file.value?.type === 'video' || (
    /https?:\/\/([^/]+\.)?bilibili\.com\/video\/BV[A-Za-z0-9]+/i.test(url) ||
    /https?:\/\/([^/]+\.)?b23\.tv\/[^/\s]+/i.test(url)
  )
})

const renderedMd = computed(() => articleMd.value ? renderMarkdown(articleMd.value) : '')
const videoTranscriptMd = computed(() => {
  if (!isBilibiliVideo.value) return ''
  return String(file.value?.content_md || file.value?.content || '').trim()
})
const renderedVideoTranscript = computed(() => videoTranscriptMd.value ? renderMarkdown(videoTranscriptMd.value) : '')

function escapeHtml(text) {
  return String(text)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

function renderInline(text) {
  return escapeHtml(text)
    .replace(/!\[([^\]]*)\]\(([^)]+)\)/g, (_, alt, src) => `<img alt="${alt}" src="${proxyMarkdownImage(src)}" />`)
    .replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2" target="_blank" rel="noreferrer">$1</a>')
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
    .replace(/`([^`]+)`/g, '<code>$1</code>')
}

function proxyMarkdownImage(src) {
  const decoded = src.replace(/&amp;/g, '&')
  return imgUrl(decoded)
}

function sanitizeTableHtml(block) {
  const template = document.createElement('template')
  template.innerHTML = block
  const allowedTags = new Set(['DIV', 'TABLE', 'THEAD', 'TBODY', 'TFOOT', 'TR', 'TH', 'TD', 'COLGROUP', 'COL', 'P', 'BR', 'SPAN', 'STRONG', 'B', 'EM', 'I', 'U'])
  const allowedAttrs = new Set(['rowspan', 'colspan'])

  template.content.querySelectorAll('*').forEach((el) => {
    if (!allowedTags.has(el.tagName)) {
      el.replaceWith(...Array.from(el.childNodes))
      return
    }
    Array.from(el.attributes).forEach((attr) => {
      if (!allowedAttrs.has(attr.name.toLowerCase()) && attr.name !== 'data-linkbox-table') {
        el.removeAttribute(attr.name)
      }
    })
  })
  return template.innerHTML
}

function renderMarkdown(markdown) {
  const lines = String(markdown).split(/\r?\n/)
  const html = []
  let paragraph = []
  let htmlBlock = []
  let codeBlock = null
  const flush = () => {
    if (!paragraph.length) return
    html.push(`<p>${renderInline(paragraph.join(' '))}</p>`)
    paragraph = []
  }
  for (const line of lines) {
    if (codeBlock) {
      if (line.startsWith('```')) {
        const language = escapeHtml(codeBlock.language)
        html.push(`<pre><code${language ? ` class="language-${language}"` : ''}>${escapeHtml(codeBlock.lines.join('\n'))}</code></pre>`)
        codeBlock = null
      } else {
        codeBlock.lines.push(line)
      }
      continue
    }
    if (htmlBlock.length) {
      htmlBlock.push(line)
      if (line.includes('</div>')) {
        html.push(`<div class="table-scroll">${sanitizeTableHtml(htmlBlock.join('\n'))}</div>`)
        htmlBlock = []
      }
      continue
    }
    if (!line.trim()) { flush(); continue }
    if (line.startsWith('```')) {
      flush()
      codeBlock = { language: line.slice(3).trim(), lines: [] }
      continue
    }
    if (line.includes('data-linkbox-table')) {
      flush()
      htmlBlock = [line]
      if (line.includes('</div>')) {
        html.push(`<div class="table-scroll">${sanitizeTableHtml(htmlBlock.join('\n'))}</div>`)
        htmlBlock = []
      }
      continue
    }
    if (line.startsWith('### ')) { flush(); html.push(`<h3>${renderInline(line.slice(4))}</h3>`); continue }
    if (line.startsWith('## ')) { flush(); html.push(`<h2>${renderInline(line.slice(3))}</h2>`); continue }
    if (line.startsWith('# ')) { flush(); html.push(`<h1>${renderInline(line.slice(2))}</h1>`); continue }
    if (line.startsWith('- ')) { flush(); html.push(`<ul><li>${renderInline(line.slice(2))}</li></ul>`); continue }
    if (line.startsWith('> ')) { flush(); html.push(`<blockquote>${renderInline(line.slice(2))}</blockquote>`); continue }
    paragraph.push(line)
  }
  flush()
  if (codeBlock) {
    const language = escapeHtml(codeBlock.language)
    html.push(`<pre><code${language ? ` class="language-${language}"` : ''}>${escapeHtml(codeBlock.lines.join('\n'))}</code></pre>`)
  }
  if (htmlBlock.length) html.push(`<div class="table-scroll">${sanitizeTableHtml(htmlBlock.join('\n'))}</div>`)
  return html.join('')
}

async function loadArticle() {
  if (articleMd.value) { showArticle.value = true; return }
  const cachedArticle = file.value?.content_md || (isLinkLike.value ? file.value?.content : '')
  if (cachedArticle) {
    articleMeta.value = {
      title: file.value.original_filename,
      author: '',
      pub_time: '',
    }
    articleMd.value = cachedArticle
    showArticle.value = true
    return
  }
  extracting.value = true
  try {
    const res = await extractContent(file.value.id)
    articleMeta.value = res
    articleMd.value = res.markdown
    showArticle.value = true
  } catch (e) {
    alert(e.response?.data?.detail || '提取失败，请稍后重试')
  } finally {
    extracting.value = false
  }
}

const SLABELS = { pending:'分析中', ready:'已完成', failed:'分析失败' }

const typeIcon = computed(() => isBilibiliVideo.value ? fileIcon('video') : fileIcon(file.value?.type))
const typeLabel = computed(() => isBilibiliVideo.value ? fileLabel('video') : fileLabel(file.value?.type))
const statusLabel = computed(() => SLABELS[file.value?.status] || '')
const processingLabel = computed(() => file.value?.processing?.label || '后台处理中')
const processingError = computed(() => file.value?.error || file.value?.processing?.lastError || '请稍后重试')
const pendingActionLabel = computed(() => file.value?.processing?.activeJob ? '刷新' : '继续处理')

const timeStr = computed(() => {
  if (!file.value?.created_at) return ''
  return new Date(file.value.created_at)
    .toLocaleString('zh-CN', { year:'numeric', month:'2-digit', day:'2-digit', hour:'2-digit', minute:'2-digit' })
})

async function load() {
  loading.value = true
  try {
    file.value = await getFile(route.params.id)
  }
  finally { loading.value = false }
}

async function triggerAnalyze() {
  analyzing.value = true
  try { await analyzeFile(file.value.id); await load() }
  finally { analyzing.value = false }
}

async function handlePendingAction() {
  if (file.value?.processing?.activeJob) {
    await load()
    return
  }
  await triggerAnalyze()
}

async function confirmDelete() {
  if (!confirm(`删除「${file.value?.original_filename}」？`)) return
  await deleteFile(file.value.id)
  router.back()
}

onMounted(load)
</script>

<style scoped>
.page {
  position: relative;
  height: 100%;
  min-height: 0;
  background: var(--bg);
  display: flex;
  flex-direction: column;
  overflow: hidden;
}
.detail-bg {
  position: absolute; inset: 0; pointer-events: none;
  background: radial-gradient(ellipse 300px 240px at 50% 0%, rgba(139,114,255,.1) 0%, transparent 65%), var(--bg);
}

.app-hdr {
  position: relative; z-index: 10; height: 90px;
  display: flex; align-items: flex-end; padding: 0 16px 14px; gap: 8px;
  background: var(--bg-blur); backdrop-filter: blur(20px);
  border-bottom: 1px solid var(--border); flex-shrink: 0;
}
.app-back {
  width: 32px; height: 32px; border: none; background: none;
  color: var(--accent); font-size: 26px; cursor: pointer;
  display: flex; align-items: center; justify-content: center;
}
.app-hdr-ttl { font-size: 17px; font-weight: 700; color: var(--text); flex: 1; }
.app-hdr-act {
  width: 32px; height: 32px; border-radius: 50%;
  background: var(--s2); border: 1px solid var(--border);
  color: var(--text2); font-size: 16px; cursor: pointer;
  display: flex; align-items: center; justify-content: center;
  transition: background .15s;
}
.app-hdr-act:hover { background: rgba(255,110,122,.15); color: var(--red); }

.app-body {
  flex: 1;
  min-height: 0;
  overflow-x: hidden;
  overflow-y: auto;
  -webkit-overflow-scrolling: touch;
  overscroll-behavior-y: contain;
  touch-action: pan-y;
  padding: 14px 16px calc(96px + env(safe-area-inset-bottom, 0px));
  display: flex; flex-direction: column; gap: 10px;
  position: relative; z-index: 1;
}

.center-tip { text-align: center; color: var(--text3); font-size: 13px; padding: 40px; }

/* Hero card */
.hero {
  flex-shrink: 0;
  max-height: 360px;
  padding: 24px 18px; text-align: center;
  border-radius: var(--radius);
  background: var(--s2); border: 1px solid var(--border2);
  overflow: hidden;
}
.hero.hero-img { padding: 0 0 16px; overflow: hidden; }
.hero.hero-img .hero-name,
.hero.hero-img .hero-badges,
.hero.hero-img .hero-time { padding: 0 18px; }
.hero.hero-img .hero-name { margin-top: 12px; }
.hero-glow {
  position: absolute; top: -40px; right: -40px;
  width: 140px; height: 140px;
  background: radial-gradient(circle, var(--accent-g) 0%, transparent 70%);
  pointer-events: none;
}
.hero-icon { font-size: 52px; margin-bottom: 10px; }
.hero-img-wrap {
  width: 100%; max-height: 260px;
  overflow: hidden; border-radius: var(--radius) var(--radius) 0 0;
  background: var(--s3);
  display: flex; align-items: center; justify-content: center;
}
.hero-img-el {
  width: 100%; height: 100%; object-fit: cover; display: block;
  max-height: 260px;
}
.hero-name {
  font-size: 15px; font-weight: 700; color: var(--text);
  word-break: break-all; margin-bottom: 10px;
  max-height: 96px;
  overflow-y: auto;
  -webkit-overflow-scrolling: touch;
  overscroll-behavior-y: contain;
  touch-action: pan-y;
}
.hero-badges { display: flex; gap: 8px; justify-content: center; margin-bottom: 8px; }
.hero-time { font-size: 11px; color: var(--text3); }

.type-chip {
  font-size: 11px; font-weight: 600; padding: 3px 9px; border-radius: 8px;
}
.type-chip.image    { background: rgba(139,114,255,.15); color: var(--accent); }
.type-chip.video    { background: rgba(255,110,122,.15); color: var(--red); }
.type-chip.document { background: rgba(94,234,181,.15);  color: var(--teal); }
.type-chip.audio    { background: rgba(255,170,92,.15);  color: var(--orange); }
.type-chip.link     { background: rgba(100,170,255,.15); color: #64AAFF; }
.type-chip.other    { background: var(--s3);             color: var(--text3); }

.status-chip { font-size: 11px; padding: 3px 9px; border-radius: 8px; }
.status-chip.pending { background: rgba(255,170,92,.15); color: var(--orange); }
.status-chip.ready   { background: rgba(94,234,181,.15); color: var(--teal); }
.status-chip.failed  { background: rgba(255,110,122,.15); color: var(--red); }

/* Info cards */
.info-card {
  flex-shrink: 0;
  max-height: 220px;
  padding: 14px 16px; border-radius: var(--radius);
  background: var(--s2); border: 1px solid var(--border);
  display: flex;
  flex-direction: column;
  overflow: hidden;
}
.card-label {
  font-size: 10px; font-weight: 600; color: var(--text3);
  letter-spacing: .08em; text-transform: uppercase; margin-bottom: 9px;
}
.transcript-card {
  max-height: 320px;
}
.transcript-body {
  flex: 1;
  min-height: 0;
  overflow-x: hidden;
  overflow-y: auto;
  -webkit-overflow-scrolling: touch;
  overscroll-behavior-y: contain;
  touch-action: pan-y;
  padding-right: 2px;
}
.state-row {
  min-height: 0;
  overflow-y: auto;
  -webkit-overflow-scrolling: touch;
  overscroll-behavior-y: contain;
  touch-action: pan-y;
  display: flex; align-items: flex-start; gap: 8px;
  font-size: 13px; color: var(--text2);
}
.state-row.failed { color: var(--red); }
.mini-orb {
  width: 14px; height: 14px; border-radius: 50%;
  border: 2px solid rgba(139,114,255,.3);
  border-top-color: var(--accent);
  animation: spin .8s linear infinite; flex-shrink: 0;
  margin-top: 2px;
}
@keyframes spin { to { transform: rotate(360deg); } }
.state-copy {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 3px;
}
.state-title {
  color: var(--text);
  font-weight: 700;
}
.state-detail {
  color: var(--text3);
  font-size: 12px;
  line-height: 1.45;
  word-break: break-word;
}
.state-row.failed .state-title,
.state-row.failed .state-detail {
  color: var(--red);
}
.action-link {
  margin-left: auto; background: none; border: none;
  color: var(--accent); font-size: 12px; font-weight: 600;
  cursor: pointer; padding: 4px 10px;
  border: 1px solid rgba(139,114,255,.3); border-radius: 10px;
  flex-shrink: 0;
}
.action-link:disabled { opacity: .4; cursor: not-allowed; }

.summary-text {
  min-height: 0;
  max-height: 72px;
  overflow-y: auto;
  -webkit-overflow-scrolling: touch;
  overscroll-behavior-y: contain;
  touch-action: pan-y;
  font-size: 15px; font-weight: 600; color: var(--text); line-height: 1.5;
}
.desc-text {
  min-height: 0;
  overflow-y: auto;
  -webkit-overflow-scrolling: touch;
  overscroll-behavior-y: contain;
  touch-action: pan-y;
  font-size: 13px; color: var(--text2); margin-top: 6px; line-height: 1.65;
}

.kw-row { display: flex; flex-wrap: wrap; gap: 6px; }
.kw-tag {
  padding: 4px 11px; border-radius: 20px;
  background: var(--s1); border: 1px solid var(--border2);
  font-size: 12px; color: var(--text2);
}

.highlight-list {
  min-height: 0;
  overflow-y: auto;
  -webkit-overflow-scrolling: touch;
  overscroll-behavior-y: contain;
  touch-action: pan-y;
  list-style: none; display: flex; flex-direction: column; gap: 7px;
}
.highlight-list li {
  font-size: 13px; color: var(--text2); line-height: 1.6;
  padding-left: 16px; position: relative;
}
.highlight-list li::before {
  content: '✓'; position: absolute; left: 0;
  color: var(--teal); font-weight: 700;
}

.link-url {
  min-height: 0;
  overflow-y: auto;
  -webkit-overflow-scrolling: touch;
  overscroll-behavior-y: contain;
  touch-action: pan-y;
  display: block;
  font-size: 13px; color: var(--accent); word-break: break-all; text-decoration: none;
}
.link-url:hover { text-decoration: underline; }

/* Actions */
.actions { display: flex; flex-direction: column; gap: 8px; padding-top: 4px; }
.btn-primary {
  display: flex; align-items: center; justify-content: center;
  height: 48px; border-radius: 14px; border: none;
  background: var(--accent); color: #fff;
  font-size: 15px; font-weight: 700; font-family: inherit;
  cursor: pointer; text-decoration: none;
  box-shadow: 0 4px 18px var(--accent-g);
  transition: transform .15s, box-shadow .15s;
}
.btn-primary:active { transform: scale(.97); }

.btn-secondary {
  height: 48px; border-radius: 14px;
  background: var(--accent-s); border: 1.5px solid rgba(139,114,255,.25);
  color: var(--accent); font-size: 15px; font-weight: 700;
  font-family: inherit; cursor: pointer;
  transition: transform .15s;
}
.btn-secondary:active { transform: scale(.97); }
.btn-secondary:disabled { opacity: .4; cursor: not-allowed; }

/* Read article button */
.read-btn {
  margin-top: 12px; width: 100%; height: 40px; border-radius: 12px;
  background: var(--accent-s); border: 1.5px solid rgba(139,114,255,.3);
  color: var(--accent); font-size: 14px; font-weight: 600;
  font-family: inherit; cursor: pointer; display: flex; align-items: center;
  justify-content: center; gap: 6px;
  transition: transform .15s, background .15s;
}
.read-btn:active { transform: scale(.97); }
.read-btn:disabled { opacity: .5; cursor: not-allowed; }
.read-btn-orb {
  width: 12px; height: 12px; border-radius: 50%;
  border: 2px solid rgba(139,114,255,.3);
  border-top-color: var(--accent);
  animation: spin .8s linear infinite; flex-shrink: 0;
}

/* Article overlay */
.article-overlay {
  position: absolute; inset: 0; z-index: 100;
  background: var(--bg); display: flex; flex-direction: column;
  min-height: 0;
  overflow: hidden;
}
.article-hdr {
  flex-shrink: 0; height: 52px;
  display: flex; align-items: center; padding: 0 16px; gap: 8px;
  background: var(--bg-blur); backdrop-filter: blur(20px);
  border-bottom: 1px solid var(--border);
}
.article-close {
  width: 32px; height: 32px; border: none; background: none;
  color: var(--text2); font-size: 18px; cursor: pointer;
  display: flex; align-items: center; justify-content: center;
}
.article-hdr-ttl { flex: 1; text-align: center; font-size: 15px; font-weight: 700; color: var(--text); }
.article-meta {
  flex-shrink: 0; padding: 16px 18px 12px;
  border-bottom: 1px solid var(--border);
}
.article-title { font-size: 18px; font-weight: 800; color: var(--text); line-height: 1.4; margin-bottom: 8px; }
.article-byline { font-size: 12px; color: var(--text3); display: flex; gap: 6px; }
.article-body {
  flex: 1;
  min-height: 0;
  overflow-x: hidden;
  overflow-y: auto;
  -webkit-overflow-scrolling: touch;
  overscroll-behavior-y: contain;
  touch-action: pan-y;
  padding: 16px 18px calc(96px + env(safe-area-inset-bottom, 0px));
}

/* Markdown content styles */
.md-content { color: var(--text); font-size: 15px; line-height: 1.8; }
.md-content :deep(h1) { font-size: 20px; font-weight: 800; margin: 20px 0 10px; color: var(--text); }
.md-content :deep(h2) { font-size: 17px; font-weight: 700; margin: 18px 0 8px; color: var(--text); }
.md-content :deep(h3) { font-size: 15px; font-weight: 700; margin: 14px 0 6px; color: var(--text); }
.md-content :deep(p) { margin: 0 0 12px; color: var(--text2); }
.md-content :deep(strong) { color: var(--text); font-weight: 700; }
.md-content :deep(em) { color: var(--text2); }
.md-content :deep(a) { color: var(--accent); text-decoration: none; }
.md-content :deep(a:hover) { text-decoration: underline; }
.md-content :deep(img) { max-width: 100%; border-radius: 8px; margin: 10px 0; display: block; }
.md-content :deep(blockquote) {
  border-left: 3px solid var(--accent); padding: 6px 12px;
  margin: 12px 0; background: var(--s2); border-radius: 0 8px 8px 0;
  color: var(--text2); font-size: 14px;
}
.md-content :deep(ul), .md-content :deep(ol) { padding-left: 20px; margin: 8px 0; }
.md-content :deep(li) { margin: 4px 0; color: var(--text2); }
.md-content :deep(code) {
  background: var(--s3); border-radius: 4px; padding: 1px 5px;
  font-family: monospace; font-size: 13px; color: var(--teal);
}
.md-content :deep(pre) {
  background: var(--s3); border-radius: 8px; padding: 12px;
  overflow-x: auto; margin: 12px 0;
}
.md-content :deep(pre code) { background: none; padding: 0; color: var(--text2); }
.md-content :deep(hr) { border: none; border-top: 1px solid var(--border); margin: 20px 0; }
.md-content :deep(.table-scroll) {
  overflow-x: auto;
  margin: 14px 0;
  border: 1px solid var(--border);
  border-radius: 12px;
}
.md-content :deep(table) {
  width: max-content;
  min-width: 100%;
  border-collapse: collapse;
  background: var(--s1);
}
.md-content :deep(th),
.md-content :deep(td) {
  border: 1px solid var(--border);
  padding: 8px 10px;
  color: var(--text2);
  font-size: 13px;
  line-height: 1.55;
  vertical-align: top;
  white-space: pre-wrap;
}
.md-content :deep(th) {
  color: var(--text);
  font-weight: 700;
  background: var(--s2);
}

/* Slide up transition */
.slide-up-enter-active, .slide-up-leave-active { transition: transform .35s cubic-bezier(.32,.72,0,1); }
.slide-up-enter-from, .slide-up-leave-to { transform: translateY(100%); }
</style>
