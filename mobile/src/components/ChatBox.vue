<template>
  <div class="chat-wrap">
    <div class="task-strip">
      <button
        v-for="item in TASKS"
        :key="item.key"
        class="task-pill"
        :class="{ active: task === item.key }"
        type="button"
        @click="task = item.key"
      >
        <span>{{ item.icon }}</span>
        {{ item.label }}
      </button>
    </div>

    <div class="msgs" ref="msgEl">
      <div v-if="!messages.length" class="chat-empty">
        <div class="ai-av">🤖</div>
        <strong>问你的资料库</strong>
        <p>它会检索你的链接、文件、图片描述和文本笔记，再用 AI 生成带引用的回答。</p>
        <button v-for="example in examples" :key="example" class="example-btn" @click="ask(example, 'ask')">
          {{ example }}
        </button>
      </div>

      <div v-for="msg in messages" :key="msg.id" class="msg" :class="msg.role">
        <div v-if="msg.role === 'assistant'" class="msg-av">🤖</div>
        <div class="msg-body">
          <div class="bubble" :class="msg.role">
            <div v-if="msg.role === 'assistant' && !msg.content" class="typing">
              <span></span><span></span><span></span>
            </div>
            <div v-else-if="msg.role === 'assistant'" class="md" v-html="renderMarkdown(msg.content, msg.sources || [])"></div>
            <div v-else class="user-text">{{ msg.content }}</div>
          </div>

          <div v-if="msg.role === 'assistant' && msg.done && msg.sources?.length" class="sources">
            <details>
              <summary>引用资料 {{ msg.sources.length }} 条</summary>
              <div
                v-for="(source, index) in msg.sources"
                :key="source.id"
                class="source-card"
              >
                <button
                  class="source-open"
                  type="button"
                  @click="$emit('open-file', source.link_id || source.id)"
                >
                  <span class="source-index">[{{ index + 1 }}]</span>
                  <span class="source-main">
                    <strong>{{ source.title }}</strong>
                    <em v-if="source.summary">{{ source.summary }}</em>
                    <small v-if="source.url">{{ source.url }}</small>
                  </span>
                </button>
                <span class="source-main">
                  <span v-if="source.chunks?.length" class="source-chunks">
                    <span
                      v-for="chunk in source.chunks"
                      :key="chunk.id"
                      class="source-chunk"
                    >
                      <b>片段 {{ chunk.index }}</b>
                      <span>{{ chunk.text }}</span>
                    </span>
                  </span>
                </span>
              </div>
            </details>
          </div>
        </div>
      </div>
    </div>

    <form class="chat-bar" @submit.prevent="send">
      <input
        v-model="input"
        class="chat-inp"
        :placeholder="activeTask.placeholder"
        :disabled="loading"
      />
      <button class="send-btn" type="submit" :disabled="!input.trim() || loading">
        <svg v-if="!loading" width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
          <path d="M2.01 21L23 12 2.01 3 2 10l15 2-15 2z"/>
        </svg>
        <span v-else class="mini-spin"></span>
      </button>
    </form>
  </div>
</template>

<script setup>
import { computed, nextTick, onMounted, ref } from 'vue'
import { streamAssistant } from '../api/files'

const props = defineProps({
  date: { type: String, default: '' },
  fileType: { type: String, default: '' },
  initialQ: { type: String, default: '' },
})
defineEmits(['open-file'])

const TASKS = [
  { key: 'ask', label: '问资料', icon: '🔎', placeholder: '问一个和资料库有关的问题...' },
  { key: 'recent', label: '总结最近', icon: '🗓', placeholder: '例如：总结最近一周收藏的重点' },
  { key: 'report', label: '生成报告', icon: '📄', placeholder: '例如：根据资料生成项目分析报告' },
  { key: 'organize', label: '整理标签', icon: '🏷', placeholder: '例如：帮我把最近资料分类并建议标签' },
  { key: 'todos', label: '提取待办', icon: '✅', placeholder: '例如：从资料里提取下一步待办' },
]

const examples = [
  '我最近收藏的内容里，哪些值得继续研究？',
  '帮我总结一下资料库里关于本地大模型部署的内容。',
  '根据我的资料，给我整理一个项目推进计划。',
]

const input = ref('')
const messages = ref([])
const loading = ref(false)
const msgEl = ref(null)
const task = ref('ask')
let nextId = 1

const activeTask = computed(() => TASKS.find(item => item.key === task.value) || TASKS[0])

onMounted(() => {
  if (props.date) task.value = 'recent'
  if (props.initialQ) {
    input.value = String(props.initialQ)
    send()
  }
})

function assistantScope() {
  return {
    date: props.date || '',
    type: props.fileType || '',
  }
}

async function ask(text, selectedTask = task.value) {
  const q = String(text || '').trim()
  if (!q || loading.value) return

  messages.value.push({ id: nextId++, role: 'user', content: q })
  input.value = ''
  loading.value = true

  const assistantId = nextId++
  messages.value.push({ id: assistantId, role: 'assistant', content: '', sources: [], done: false })
  await scrollBottom()

  try {
    await streamAssistant(q, selectedTask, {
      onSources: sources => {
        messages.value = messages.value.map(message =>
          message.id === assistantId ? { ...message, sources } : message
        )
      },
      onDelta: text => {
        messages.value = messages.value.map(message =>
          message.id === assistantId ? { ...message, content: message.content + text } : message
        )
        scrollBottom()
      },
      onDone: () => {
        messages.value = messages.value.map(message =>
          message.id === assistantId ? { ...message, done: true } : message
        )
      },
    }, assistantScope())
  } catch (e) {
    messages.value = messages.value.map(message =>
      message.id === assistantId
        ? { ...message, content: e?.message || '资料助理暂时无法回答。' }
        : message
    )
  } finally {
    messages.value = messages.value.map(message =>
      message.id === assistantId ? { ...message, done: true } : message
    )
    loading.value = false
    await scrollBottom()
  }
}

function send() {
  ask(input.value, task.value)
}

async function scrollBottom() {
  await nextTick()
  if (msgEl.value) msgEl.value.scrollTop = msgEl.value.scrollHeight
}

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;')
}

function normalizeCitations(value, maxSourceNumber = 0) {
  return String(value || '')
    .replace(/\[资料(\d+)\s*-\s*(\d+)\]/g, (_match, start, end) => {
      const from = Number(start)
      const to = maxSourceNumber ? Math.min(Number(end), maxSourceNumber) : Number(end)
      if (!Number.isFinite(from) || !Number.isFinite(to) || from > to) return ''
      return Array.from({ length: to - from + 1 }, (_v, index) => `[资料${from + index}]`).join('')
    })
    .replace(/\[资料(\d+)\]/g, (match, n) => {
      const value = Number(n)
      if (!Number.isFinite(value)) return match
      if (maxSourceNumber && (value < 1 || value > maxSourceNumber)) return ''
      return match
    })
    .replace(/(\[资料\d+\])(?:\s*[、,，]\s*\d+)+/g, '$1')
    .replace(/\[资料(\d+)(?!\])/g, (match, n) => {
      const value = Number(n)
      if (!Number.isFinite(value)) return match
      if (maxSourceNumber && value > maxSourceNumber) return match
      return `[资料${value}]`
    })
}

function renderInline(value) {
  return escapeHtml(value)
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(/`([^`]+)`/g, '<code>$1</code>')
    .replace(/\[(资料\d+)\]/g, '<mark>[$1]</mark>')
}

function renderMarkdown(md, sources = []) {
  const lines = normalizeCitations(md, sources.length).split(/\r?\n/)
  const html = []
  let listOpen = false

  for (const raw of lines) {
    const line = raw.trim()
    if (!line) {
      if (listOpen) { html.push('</ul>'); listOpen = false }
      continue
    }
    if (line.startsWith('### ')) {
      if (listOpen) { html.push('</ul>'); listOpen = false }
      html.push(`<h3>${renderInline(line.slice(4))}</h3>`)
    } else if (line.startsWith('## ')) {
      if (listOpen) { html.push('</ul>'); listOpen = false }
      html.push(`<h2>${renderInline(line.slice(3))}</h2>`)
    } else if (line.startsWith('# ')) {
      if (listOpen) { html.push('</ul>'); listOpen = false }
      html.push(`<h2>${renderInline(line.slice(2))}</h2>`)
    } else if (/^[-*]\s+/.test(line)) {
      if (!listOpen) { html.push('<ul>'); listOpen = true }
      html.push(`<li>${renderInline(line.replace(/^[-*]\s+/, ''))}</li>`)
    } else {
      if (listOpen) { html.push('</ul>'); listOpen = false }
      html.push(`<p>${renderInline(line)}</p>`)
    }
  }
  if (listOpen) html.push('</ul>')
  return html.join('')
}
</script>

<style scoped>
.chat-wrap { display: flex; flex-direction: column; height: 100%; background: var(--bg); }

.task-strip {
  display: flex; gap: 7px; overflow-x: auto;
  padding: 10px 14px;
  border-bottom: 1px solid var(--border);
  background: var(--bg-blur);
  flex-shrink: 0;
}
.task-pill {
  flex: 0 0 auto;
  height: 30px;
  padding: 0 10px;
  border: 1px solid var(--border);
  border-radius: 15px;
  background: var(--s2);
  color: var(--text2);
  font-size: 12px;
  font-weight: 700;
}
.task-pill.active {
  background: var(--accent);
  color: #fff;
  border-color: transparent;
}

.msgs {
  flex: 1; overflow-y: auto;
  padding: 16px 16px 8px;
  display: flex; flex-direction: column; gap: 14px;
}

.chat-empty {
  display: flex; flex-direction: column; align-items: stretch;
  gap: 10px; padding: 34px 0;
  color: var(--text2); font-size: 13px;
  text-align: center;
}
.chat-empty .ai-av {
  width: 48px; height: 48px; border-radius: 15px;
  margin: 0 auto 2px;
  background: linear-gradient(135deg, var(--accent), var(--teal));
  display: flex; align-items: center; justify-content: center; font-size: 22px;
  box-shadow: 0 0 16px var(--accent-g);
}
.chat-empty strong { color: var(--text); font-size: 15px; }
.chat-empty p { line-height: 1.55; margin-bottom: 4px; }

.example-btn {
  width: 100%;
  border: 1px solid var(--border);
  border-radius: 14px;
  background: var(--s2);
  color: var(--text);
  padding: 10px 12px;
  text-align: left;
  font-size: 12px;
  line-height: 1.5;
}

.msg { display: flex; gap: 8px; align-items: flex-start; }
.msg.user { flex-direction: row-reverse; }

.msg-av {
  width: 30px; height: 30px; border-radius: 10px;
  background: linear-gradient(135deg, var(--accent), var(--teal));
  display: flex; align-items: center; justify-content: center;
  font-size: 14px; flex-shrink: 0;
  box-shadow: 0 0 10px var(--accent-g);
}

.msg-body { max-width: 86%; display: flex; flex-direction: column; gap: 7px; }

.bubble {
  padding: 9px 13px; border-radius: 18px;
  font-size: 13px; line-height: 1.6; color: var(--text);
  overflow-wrap: anywhere;
}
.bubble.assistant {
  background: var(--s3); border: 1px solid var(--border);
  border-bottom-left-radius: 5px;
}
.bubble.user {
  background: linear-gradient(135deg, var(--accent), #6B52F0);
  color: #fff; border-bottom-right-radius: 5px;
}
.user-text { white-space: pre-wrap; }

.typing { display: flex; align-items: center; gap: 4px; min-height: 20px; }
.typing span {
  width: 6px; height: 6px;
  background: var(--text3); border-radius: 50%;
  animation: bounce 1.3s infinite;
}
.typing span:nth-child(2) { animation-delay: .18s; }
.typing span:nth-child(3) { animation-delay: .36s; }
@keyframes bounce { 0%,60%,100%{transform:translateY(0)} 30%{transform:translateY(-5px)} }

.md :deep(h2), .md :deep(h3) {
  font-size: 14px;
  margin: 4px 0 6px;
}
.md :deep(p) { margin: 0 0 7px; }
.md :deep(ul) { padding-left: 18px; margin: 0 0 8px; }
.md :deep(li) { margin: 3px 0; }
.md :deep(code) {
  background: rgba(255,255,255,.1);
  border-radius: 5px;
  padding: 1px 4px;
  font-size: 12px;
}
.md :deep(mark) {
  background: var(--accent-s);
  color: var(--accent);
  border-radius: 5px;
  padding: 1px 4px;
}

.sources {
  border: 1px solid var(--border);
  background: var(--s1);
  border-radius: 14px;
  overflow: hidden;
}
.sources summary {
  padding: 9px 11px;
  font-size: 12px;
  color: var(--text2);
  font-weight: 700;
}
.source-card {
  width: 100%;
  border: 0;
  border-top: 1px solid var(--border);
  background: transparent;
  color: var(--text);
  padding: 0;
}
.source-open {
  width: 100%;
  border: 0;
  background: transparent;
  color: var(--text);
  display: flex;
  gap: 8px;
  padding: 9px 11px;
  text-align: left;
}
.source-index {
  color: var(--accent);
  font-size: 12px;
  font-weight: 800;
  flex-shrink: 0;
}
.source-main {
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 3px;
}
.source-main strong {
  font-size: 12px;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.source-main em {
  color: var(--text2);
  font-size: 11px;
  line-height: 1.45;
  font-style: normal;
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
}
.source-main small {
  color: var(--accent);
  font-size: 10px;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.source-chunks {
  display: flex;
  flex-direction: column;
  gap: 6px;
  padding: 0 11px 10px 31px;
}
.source-chunk {
  border: 1px solid var(--border);
  background: var(--s2);
  border-radius: 9px;
  padding: 7px 8px;
}
.source-chunk b {
  display: block;
  color: var(--accent);
  font-size: 11px;
  margin-bottom: 3px;
}
.source-chunk span {
  color: var(--text2);
  font-size: 11px;
  line-height: 1.45;
  display: -webkit-box;
  -webkit-line-clamp: 3;
  -webkit-box-orient: vertical;
  overflow: hidden;
}

.chat-bar {
  display: flex; align-items: center; gap: 8px;
  padding: 10px 14px 16px;
  background: var(--bg-blur); backdrop-filter: blur(20px);
  border-top: 1px solid var(--border);
}

.chat-inp {
  flex: 1; height: 40px;
  background: var(--s2); border: 1px solid var(--border);
  border-radius: 20px; padding: 0 16px;
  color: var(--text); font-size: 13px; font-family: inherit;
  outline: none; transition: border-color .2s;
}
.chat-inp:focus { border-color: var(--accent); box-shadow: 0 0 0 3px var(--accent-s); }
.chat-inp::placeholder { color: var(--text3); }

.send-btn {
  width: 38px; height: 38px; border-radius: 50%;
  background: var(--accent); border: none; color: #fff;
  display: flex; align-items: center; justify-content: center;
  cursor: pointer; flex-shrink: 0;
  box-shadow: 0 0 14px var(--accent-g);
  transition: transform .15s, box-shadow .15s;
}
.send-btn:not(:disabled):active { transform: scale(.9); }
.send-btn:disabled { background: var(--s3); box-shadow: none; cursor: not-allowed; }
.mini-spin {
  width: 15px; height: 15px;
  border: 2px solid rgba(255,255,255,.45);
  border-top-color: #fff;
  border-radius: 50%;
  animation: spin .8s linear infinite;
}
@keyframes spin { to { transform: rotate(360deg); } }
</style>
