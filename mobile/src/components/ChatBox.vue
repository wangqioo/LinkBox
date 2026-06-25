<template>
  <div class="chat-wrap">
    <div class="history-strip">
      <button class="history-new" type="button" @click="startNewConversation">新对话</button>
      <select class="history-select" :value="activeConversationId || ''" @change="selectConversation($event.target.value)">
        <option value="">当前新对话</option>
        <option v-for="conversation in conversations" :key="conversation.id" :value="conversation.id">
          {{ conversation.title }}
        </option>
      </select>
      <button
        class="history-delete"
        type="button"
        :disabled="!activeConversationId"
        @click="removeConversation"
      >
        删除
      </button>
    </div>
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
        <strong>{{ emptyTitle }}</strong>
        <p>{{ emptyDescription }}</p>
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
            <div v-else-if="msg.role === 'assistant'" class="md" v-html="renderAssistantMarkdown(msg.content, msg.sources || [])"></div>
            <div v-else class="user-text">{{ msg.content }}</div>
          </div>

          <AssistantAgentStatus v-if="msg.role === 'assistant'" :agent="msg.agent" />

          <AssistantSourceList
            v-if="msg.role === 'assistant' && msg.done"
            :sources="msg.sources || []"
            @open-source="openSource"
          />
        </div>
      </div>
    </div>

    <form class="chat-bar" @submit.prevent="send">
      <AutoGrowTextarea
        v-model="input"
        class="chat-inp"
        :placeholder="activeTask.placeholder"
        :disabled="loading"
        :max-height="120"
        @keydown.enter.exact.prevent="send"
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
import { computed, nextTick, onMounted, ref, watch } from 'vue'
import {
  deleteAssistantConversation,
  getAssistantConversationMessages,
  getAssistantConversations,
  streamAssistant,
} from '../api/files'
import AssistantAgentStatus from './AssistantAgentStatus.vue'
import AssistantSourceList from './AssistantSourceList.vue'
import AutoGrowTextarea from './AutoGrowTextarea.vue'
import {
  nextAssistantMessageId,
  normalizeAssistantMessages,
} from '../utils/assistantConversations'
import { renderAssistantMarkdown } from '../utils/markdownParser'

const props = defineProps({
  date: { type: String, default: '' },
  fileType: { type: String, default: '' },
  initialQ: { type: String, default: '' },
  groupId: { type: [String, Number], default: '' },
})
const emit = defineEmits(['open-file'])

const PERSONAL_TASKS = [
  { key: 'ask', label: '问资料', icon: '🔎', placeholder: '问一个和资料库有关的问题...' },
  { key: 'recent', label: '总结最近', icon: '🗓', placeholder: '例如：总结最近一周收藏的重点' },
  { key: 'report', label: '生成报告', icon: '📄', placeholder: '例如：根据资料生成项目分析报告' },
  { key: 'organize', label: '整理标签', icon: '🏷', placeholder: '例如：帮我把最近资料分类并建议标签' },
  { key: 'todos', label: '提取待办', icon: '✅', placeholder: '例如：从资料里提取下一步待办' },
]

const GROUP_TASKS = [
  { key: 'ask', label: '问群资料', icon: '🔎', placeholder: '问一个和这个群资料有关的问题...' },
  { key: 'recent', label: '总结群内最近', icon: '🗓', placeholder: '例如：总结这个群最近共享的重点资料' },
  { key: 'report', label: '生成群报告', icon: '📄', placeholder: '例如：根据群资料生成项目讨论报告' },
  { key: 'organize', label: '整理群资料', icon: '🏷', placeholder: '例如：帮这个群的资料分类并建议主题' },
  { key: 'todos', label: '提取群待办', icon: '✅', placeholder: '例如：从群资料里提取下一步待办' },
]

const personalExamples = [
  '我最近收藏的内容里，哪些值得继续研究？',
  '帮我总结一下资料库里关于本地大模型部署的内容。',
  '根据我的资料，给我整理一个项目推进计划。',
]

const groupExamples = [
  '总结一下这个群里最近共享的重点资料。',
  '这个群的文件和链接里，有哪些需要继续跟进？',
  '根据群资料整理一个讨论结论和下一步行动。',
]

const input = ref('')
const messages = ref([])
const conversations = ref([])
const activeConversationId = ref(null)
const loading = ref(false)
const msgEl = ref(null)
const task = ref('ask')
let nextId = 1

const isGroupAssistant = computed(() => Boolean(props.groupId))
const TASKS = computed(() => isGroupAssistant.value ? GROUP_TASKS : PERSONAL_TASKS)
const examples = computed(() => isGroupAssistant.value ? groupExamples : personalExamples)
const emptyTitle = computed(() => isGroupAssistant.value ? '问这个群的资料' : '问你的资料库')
const emptyDescription = computed(() => isGroupAssistant.value
  ? '它只会检索这个群里共享的文件、链接、图片描述和群资料，不会混用你的个人资料库。'
  : '它会检索你的链接、文件、图片描述和文本笔记，再用 AI 生成带引用的回答。')
const activeTask = computed(() => TASKS.value.find(item => item.key === task.value) || TASKS.value[0])

onMounted(() => {
  if (props.date) task.value = 'recent'
  loadConversations()
  if (props.initialQ) {
    input.value = String(props.initialQ)
    send()
  }
})

watch(() => props.groupId, () => {
  startNewConversation()
  loadConversations()
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
      onConversation: conversation => {
        if (conversation?.id) activeConversationId.value = conversation.id
        loadConversations()
      },
      onAgent: agent => {
        messages.value = messages.value.map(message =>
          message.id === assistantId ? { ...message, agent } : message
        )
      },
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
    }, assistantScope(), {
      groupId: props.groupId || undefined,
      conversationId: activeConversationId.value || undefined,
    })
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
    loadConversations()
    await scrollBottom()
  }
}

function send() {
  ask(input.value, task.value)
}

function openSource(id) {
  if (id) emit('open-file', id)
}

async function loadConversations() {
  try {
    conversations.value = await getAssistantConversations({ groupId: props.groupId || undefined })
  } catch {
    conversations.value = []
  }
}

async function selectConversation(value) {
  const id = Number(value)
  if (!id) {
    startNewConversation()
    return
  }
  try {
    const data = await getAssistantConversationMessages(id, { groupId: props.groupId || undefined })
    activeConversationId.value = id
    messages.value = normalizeAssistantMessages(data.messages)
    nextId = nextAssistantMessageId(messages.value)
    await scrollBottom()
  } catch {
    startNewConversation()
  }
}

function startNewConversation() {
  activeConversationId.value = null
  messages.value = []
  input.value = ''
  nextId = 1
}

async function removeConversation() {
  if (!activeConversationId.value || loading.value) return
  const id = activeConversationId.value
  await deleteAssistantConversation(id, { groupId: props.groupId || undefined })
  startNewConversation()
  await loadConversations()
}

async function scrollBottom() {
  await nextTick()
  if (msgEl.value) msgEl.value.scrollTop = msgEl.value.scrollHeight
}

</script>

<style scoped>
.chat-wrap { display: flex; flex-direction: column; height: 100%; background: var(--bg); }

.history-strip {
  display: grid;
  grid-template-columns: auto minmax(0, 1fr) auto;
  gap: 7px;
  padding: 10px 14px 0;
  background: var(--bg-blur);
  flex-shrink: 0;
}
.history-new,
.history-delete,
.history-select {
  height: 30px;
  border: 1px solid var(--border);
  border-radius: 12px;
  background: var(--s2);
  color: var(--text2);
  font: inherit;
  font-size: 12px;
  font-weight: 700;
}
.history-new,
.history-delete {
  padding: 0 10px;
}
.history-select {
  min-width: 0;
  padding: 0 8px;
}
.history-delete:disabled {
  opacity: .45;
}

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
.md :deep(ul), .md :deep(ol) { padding-left: 18px; margin: 0 0 8px; }
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

.chat-bar {
  display: flex; align-items: flex-end; gap: 8px;
  padding: 10px 14px 16px;
  background: var(--bg-blur); backdrop-filter: blur(20px);
  border-top: 1px solid var(--border);
}

.chat-inp {
  flex: 1; min-height: 40px;
  background: var(--s2); border: 1px solid var(--border);
  border-radius: 20px; padding: 10px 16px;
  color: var(--text); font-size: 13px; font-family: inherit;
  line-height: 20px;
  resize: none;
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
