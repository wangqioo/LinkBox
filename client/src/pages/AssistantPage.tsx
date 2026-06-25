import { FormEvent, useEffect, useRef, useState } from 'react';
import { api, type AssistantAgent, type AssistantConversation, type AssistantMemory, type AssistantSource } from '../api/client';
import { Bot, Brain, CalendarDays, CheckSquare, ChevronDown, FileText, Loader2, Plus, RefreshCw, Search, Send, Tags, Trash2, UserRound, X } from 'lucide-react';
import AutoGrowTextarea from '../components/AutoGrowTextarea';
import MarkdownRenderer from '../components/MarkdownRenderer';
import { assistantSourceInspectionRows } from '../components/assistantSourceInspection';

interface Message {
  id: number;
  role: 'user' | 'assistant';
  content: string;
  sources?: AssistantSource[];
  agent?: AssistantAgent;
  done?: boolean;
}

const EXAMPLES = [
  '我最近收藏的内容里，哪些值得继续研究？',
  '帮我总结一下资料库里关于本地大模型部署的内容。',
  '根据我的资料，给我整理一个项目推进计划。',
];

const TASKS = [
  { key: 'ask', label: '问资料', icon: Search, placeholder: '问一个和资料库有关的问题...' },
  { key: 'recent', label: '总结最近', icon: CalendarDays, placeholder: '例如：总结最近一周收藏的重点' },
  { key: 'report', label: '生成报告', icon: FileText, placeholder: '例如：根据 VibeBoard 资料生成项目分析报告' },
  { key: 'organize', label: '整理标签', icon: Tags, placeholder: '例如：帮我把最近资料分类并建议标签' },
  { key: 'todos', label: '提取待办', icon: CheckSquare, placeholder: '例如：从 VibeBoard 资料里提取下一步待办' },
];

function SourceList({ sources = [] }: { sources?: AssistantSource[] }) {
  const [open, setOpen] = useState(false);

  if (!sources.length) return null;
  return (
    <div className="mt-4 border-t pt-3">
      <button type="button" onClick={() => setOpen(v => !v)}
        className="flex items-center gap-1.5 text-xs font-medium text-gray-500 hover:text-gray-700 dark:hover:text-gray-300">
        <ChevronDown className={`w-3.5 h-3.5 transition-transform ${open ? 'rotate-180' : ''}`} />
        引用资料 {sources.length} 条
      </button>
      {open && (
        <div className="space-y-2 mt-2">
          {sources.map((source, index) => (
            <div key={source.id} className="rounded-lg border bg-gray-50 dark:bg-gray-800/60 px-3 py-2">
              <div className="flex items-start gap-2">
                <span className="shrink-0 text-xs font-semibold text-indigo-600 dark:text-indigo-400">
                  [{index + 1}]
                </span>
                <div className="min-w-0">
                  <div className="text-sm font-medium truncate">{source.title}</div>
                  <RetrievalInfo retrieval={source.retrieval} />
                  {source.summary && (
                    <div className="text-xs text-gray-500 mt-1 line-clamp-2">{source.summary}</div>
                  )}
                  {source.url && (
                    <a className="text-xs text-indigo-600 dark:text-indigo-400 hover:underline break-all"
                      href={source.url} target="_blank" rel="noreferrer">
                      {source.url}
                    </a>
                  )}
                  {!!source.chunks?.length && (
                    <div className="mt-2 space-y-1.5">
                      {source.chunks.map(chunk => (
                        <div key={chunk.id} className="rounded-md bg-white dark:bg-gray-900/60 border px-2 py-1.5">
                          <div className="text-[11px] font-medium text-indigo-600 dark:text-indigo-400 mb-0.5">
                            片段 {chunk.index}
                          </div>
                          <RetrievalInfo retrieval={chunk.retrieval} compact />
                          <div className="text-xs text-gray-500 dark:text-gray-400 line-clamp-3">
                            {chunk.text}
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function RetrievalInfo({ retrieval, compact = false }: { retrieval?: AssistantSource['retrieval']; compact?: boolean }) {
  const rows = assistantSourceInspectionRows(retrieval);
  if (!rows.length) return null;
  return (
    <div className={`mt-1 flex flex-wrap gap-1.5 ${compact ? 'text-[10px]' : 'text-[11px]'}`}>
      {rows.map(row => (
        <span key={`${row.label}:${row.value}`} className="inline-flex min-w-0 max-w-full items-center gap-1 rounded-md border border-gray-200 bg-white/70 px-1.5 py-0.5 text-gray-500 dark:border-gray-700 dark:bg-gray-900/50 dark:text-gray-400">
          <span className="shrink-0 font-medium text-gray-400 dark:text-gray-500">{row.label}</span>
          <span className="truncate">{row.value}</span>
        </span>
      ))}
    </div>
  );
}

function AgentStatus({ agent }: { agent?: AssistantAgent }) {
  if (!agent) return null;
  const tools = agent.plan?.tools?.length || 0;
  const evidenceStatus = agent.evidence?.status || 'unknown';
  const support = agent.verification?.support || 'unknown';
  const memoryCount = agent.memory?.items?.length || 0;
  const attempts = agent.run?.steps?.find(step => step.step_type === 'retrieval')?.metadata?.queryCount;

  return (
    <div className="mt-3 flex flex-wrap gap-1.5 text-[11px] text-gray-500 dark:text-gray-400">
      <span className="inline-flex items-center gap-1 rounded-md border border-gray-200 bg-white/70 px-1.5 py-0.5 dark:border-gray-700 dark:bg-gray-900/50">
        意图 <span className="font-medium text-gray-700 dark:text-gray-200">{agent.plan?.intent || 'unknown'}</span>
      </span>
      <span className="inline-flex items-center gap-1 rounded-md border border-gray-200 bg-white/70 px-1.5 py-0.5 dark:border-gray-700 dark:bg-gray-900/50">
        工具 <span className="font-medium text-gray-700 dark:text-gray-200">{tools}</span>
      </span>
      {typeof attempts === 'number' && (
        <span className="inline-flex items-center gap-1 rounded-md border border-gray-200 bg-white/70 px-1.5 py-0.5 dark:border-gray-700 dark:bg-gray-900/50">
          检索 <span className="font-medium text-gray-700 dark:text-gray-200">{attempts}</span>
        </span>
      )}
      <span className="inline-flex items-center gap-1 rounded-md border border-gray-200 bg-white/70 px-1.5 py-0.5 dark:border-gray-700 dark:bg-gray-900/50">
        证据 <span className="font-medium text-gray-700 dark:text-gray-200">{evidenceStatus}</span>
      </span>
      <span className="inline-flex items-center gap-1 rounded-md border border-gray-200 bg-white/70 px-1.5 py-0.5 dark:border-gray-700 dark:bg-gray-900/50">
        校验 <span className="font-medium text-gray-700 dark:text-gray-200">{support}</span>
      </span>
      {memoryCount > 0 && (
        <span className="inline-flex items-center gap-1 rounded-md border border-gray-200 bg-white/70 px-1.5 py-0.5 dark:border-gray-700 dark:bg-gray-900/50">
          记忆 <span className="font-medium text-gray-700 dark:text-gray-200">{memoryCount}</span>
        </span>
      )}
    </div>
  );
}

export default function AssistantPage() {
  const [messages, setMessages] = useState<Message[]>([]);
  const [conversations, setConversations] = useState<AssistantConversation[]>([]);
  const [memories, setMemories] = useState<AssistantMemory[]>([]);
  const [activeConversationId, setActiveConversationId] = useState<number | null>(null);
  const [question, setQuestion] = useState('');
  const [task, setTask] = useState('ask');
  const [loading, setLoading] = useState(false);
  const [memoryOpen, setMemoryOpen] = useState(false);
  const [loadingMemories, setLoadingMemories] = useState(false);
  const [deletingMemoryId, setDeletingMemoryId] = useState<number | null>(null);
  const idRef = useRef(1);
  const activeTask = TASKS.find(item => item.key === task) || TASKS[0];

  const loadConversations = async () => {
    const data = await api.getAssistantConversations();
    setConversations(data.conversations);
  };

  const loadMemories = async () => {
    setLoadingMemories(true);
    try {
      const data = await api.getAssistantMemories();
      setMemories(data.memories || []);
    } finally {
      setLoadingMemories(false);
    }
  };

  useEffect(() => {
    loadConversations().catch(() => setConversations([]));
    loadMemories().catch(() => setMemories([]));
  }, []);

  const ask = async (text: string, selectedTask = task) => {
    const q = text.trim();
    if (!q || loading) return;

    const userMessage: Message = { id: idRef.current++, role: 'user', content: q };
    setMessages(prev => [...prev, userMessage]);
    setQuestion('');
    setLoading(true);
    const assistantId = idRef.current++;
    setMessages(prev => [...prev, { id: assistantId, role: 'assistant', content: '', sources: [], done: false }]);

    try {
      await api.streamAssistant(q, selectedTask, {
        conversationId: activeConversationId,
        onConversation: conversation => {
          setActiveConversationId(conversation.id);
          loadConversations().catch(() => undefined);
        },
        onAgent: agent => {
          setMessages(prev => prev.map(message =>
            message.id === assistantId ? { ...message, agent } : message
          ));
        },
        onSources: sources => {
          setMessages(prev => prev.map(message =>
            message.id === assistantId ? { ...message, sources } : message
          ));
        },
        onDelta: text => {
          setMessages(prev => prev.map(message =>
            message.id === assistantId ? { ...message, content: message.content + text } : message
          ));
        },
        onDone: () => {
          setMessages(prev => prev.map(message =>
            message.id === assistantId ? { ...message, done: true } : message
          ));
        },
      });
    } catch (e) {
      setMessages(prev => prev.map(message => message.id === assistantId ? {
        ...message,
        content: e instanceof Error ? e.message : '资料助理暂时无法回答。',
      } : message));
    } finally {
      setMessages(prev => prev.map(message =>
        message.id === assistantId ? { ...message, done: true } : message
      ));
      setLoading(false);
      loadConversations().catch(() => undefined);
      loadMemories().catch(() => undefined);
    }
  };

  const onSubmit = (e: FormEvent) => {
    e.preventDefault();
    ask(question);
  };

  const startNewConversation = () => {
    setActiveConversationId(null);
    setMessages([]);
    setQuestion('');
    idRef.current = 1;
  };

  const openConversation = async (id: number) => {
    if (!id) {
      startNewConversation();
      return;
    }
    const data = await api.getAssistantConversationMessages(id);
    setActiveConversationId(id);
    setMessages(data.messages.map(message => ({
      id: message.id,
      role: message.role,
      content: message.error || message.content,
      sources: message.sources,
      agent: message.agent,
      done: true,
    })));
    idRef.current = Math.max(1, ...data.messages.map(message => message.id)) + 1;
  };

  const deleteConversation = async () => {
    if (!activeConversationId || loading) return;
    await api.deleteAssistantConversation(activeConversationId);
    startNewConversation();
    await loadConversations();
  };

  const toggleMemoryPanel = () => {
    setMemoryOpen(open => {
      const next = !open;
      if (next) loadMemories().catch(() => setMemories([]));
      return next;
    });
  };

  const deleteMemory = async (id: number) => {
    if (deletingMemoryId) return;
    setDeletingMemoryId(id);
    try {
      await api.deleteAssistantMemory(id);
      setMemories(prev => prev.filter(memory => memory.id !== id));
    } finally {
      setDeletingMemoryId(null);
    }
  };

  return (
    <div className="h-[calc(100vh-3rem)] md:h-[calc(100vh-3rem)] flex flex-col">
      <div className="mb-4">
        <h1 className="text-xl font-bold">资料助理</h1>
        <p className="text-sm text-gray-500">问答、总结、报告、整理和待办都基于你的 Markdown 资料库。</p>
      </div>

      <div className="card flex-1 min-h-0 flex flex-col overflow-hidden">
        <div className="border-b p-3 flex items-center gap-2">
          <button type="button" onClick={startNewConversation} className="btn-secondary shrink-0">
            <Plus className="w-4 h-4" />
            新对话
          </button>
          <select
            className="input min-w-0"
            value={activeConversationId || ''}
            onChange={event => openConversation(Number(event.target.value)).catch(() => startNewConversation())}
          >
            <option value="">当前新对话</option>
            {conversations.map(conversation => (
              <option key={conversation.id} value={conversation.id}>{conversation.title}</option>
            ))}
          </select>
          <button type="button" onClick={deleteConversation} className="btn-secondary shrink-0" disabled={!activeConversationId || loading}>
            <Trash2 className="w-4 h-4" />
          </button>
          <button type="button" onClick={toggleMemoryPanel} className="btn-secondary shrink-0">
            <Brain className="w-4 h-4" />
            <span>记忆</span>
            {memories.length > 0 && <span className="text-xs text-gray-500 dark:text-gray-400">{memories.length}</span>}
          </button>
        </div>
        {memoryOpen && (
          <div className="border-b bg-gray-50/80 dark:bg-gray-900/40 px-3 py-3" role="region" aria-label="助手记忆">
            <div className="mb-2 flex items-center justify-between gap-2">
              <div className="min-w-0">
                <div className="text-sm font-semibold">助手记忆</div>
                <div className="text-xs text-gray-500">长期偏好和明确要求会影响之后的回答。</div>
              </div>
              <div className="flex items-center gap-1.5">
                <button type="button" onClick={() => loadMemories().catch(() => setMemories([]))}
                  aria-label="刷新助手记忆"
                  className="btn-secondary px-2 py-1" disabled={loadingMemories}>
                  <RefreshCw className={`w-3.5 h-3.5 ${loadingMemories ? 'animate-spin' : ''}`} />
                </button>
                <button type="button" onClick={() => setMemoryOpen(false)} aria-label="关闭助手记忆" className="btn-secondary px-2 py-1">
                  <X className="w-3.5 h-3.5" />
                </button>
              </div>
            </div>
            {loadingMemories ? (
              <div className="flex items-center gap-2 text-xs text-gray-500">
                <Loader2 className="w-3.5 h-3.5 animate-spin" />
                正在加载记忆
              </div>
            ) : memories.length ? (
              <div className="max-h-40 overflow-y-auto divide-y divide-gray-200 dark:divide-gray-800 rounded-lg border bg-white dark:bg-gray-950">
                {memories.map(memory => (
                  <div key={memory.id} className="flex items-start gap-3 px-3 py-2">
                    <div className="min-w-0 flex-1">
                      <div className="mb-1 flex flex-wrap items-center gap-1.5">
                        <span className="rounded-md bg-indigo-50 px-1.5 py-0.5 text-[11px] font-medium text-indigo-700 dark:bg-indigo-950 dark:text-indigo-300">
                          {memory.memory_type}
                        </span>
                        <span className="text-[11px] text-gray-400">{memory.source}</span>
                      </div>
                      <div className="break-words text-sm text-gray-700 dark:text-gray-200">{memory.content}</div>
                    </div>
                    <button type="button" onClick={() => deleteMemory(memory.id)}
                      aria-label={`删除助手记忆 ${memory.content}`}
                      className="btn-secondary px-2 py-1" disabled={deletingMemoryId === memory.id}>
                      {deletingMemoryId === memory.id ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Trash2 className="w-3.5 h-3.5" />}
                    </button>
                  </div>
                ))}
              </div>
            ) : (
              <div className="rounded-lg border border-dashed px-3 py-3 text-xs text-gray-500">
                暂无记忆。对助手说“记住：...”后会出现在这里。
              </div>
            )}
          </div>
        )}
        <div className="border-b p-3 flex gap-2 overflow-x-auto">
          {TASKS.map(item => (
            <button key={item.key} type="button" onClick={() => setTask(item.key)}
              className={`shrink-0 flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${
                task === item.key
                  ? 'bg-indigo-600 text-white'
                  : 'bg-gray-100 dark:bg-gray-800 text-gray-600 dark:text-gray-400 hover:bg-gray-200 dark:hover:bg-gray-700'
              }`}>
              <item.icon className="w-3.5 h-3.5" />
              {item.label}
            </button>
          ))}
        </div>

        <div className="flex-1 overflow-y-auto p-4 space-y-4">
          {messages.length === 0 ? (
            <div className="h-full flex flex-col items-center justify-center text-center px-4">
              <div className="w-12 h-12 rounded-xl bg-indigo-50 dark:bg-indigo-950 text-indigo-600 dark:text-indigo-400 flex items-center justify-center mb-4">
                <Search className="w-6 h-6" />
              </div>
              <div className="font-semibold mb-2">问你的资料库</div>
              <div className="text-sm text-gray-500 max-w-md mb-5">
                它会检索你的链接、文件、图片描述和文本笔记，再用 AI 生成带引用的回答。
              </div>
              <div className="grid gap-2 w-full max-w-xl">
                {EXAMPLES.map(example => (
                  <button key={example} onClick={() => ask(example, 'ask')}
                    className="text-left rounded-lg border px-3 py-2 text-sm hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors">
                    {example}
                  </button>
                ))}
              </div>
            </div>
          ) : (
            messages.map(message => (
              <div key={message.id} className={`flex gap-3 ${message.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                {message.role === 'assistant' && (
                  <div className="w-8 h-8 rounded-lg bg-indigo-50 dark:bg-indigo-950 text-indigo-600 dark:text-indigo-400 flex items-center justify-center shrink-0">
                    <Bot className="w-4 h-4" />
                  </div>
                )}
                <div className={`max-w-3xl rounded-xl px-4 py-3 text-sm leading-6 ${
                  message.role === 'user'
                    ? 'bg-indigo-600 text-white'
                    : 'bg-gray-50 dark:bg-gray-800 text-gray-900 dark:text-gray-100'
                }`}>
                  {message.role === 'assistant' ? (
                    message.content
                      ? <MarkdownRenderer content={message.content} />
                      : <div className="flex items-center gap-2 text-gray-500">
                          <Loader2 className="w-4 h-4 animate-spin" />
                          正在生成回答
                        </div>
                  ) : (
                    <div className="whitespace-pre-wrap">{message.content}</div>
                  )}
                  {message.role === 'assistant' && <AgentStatus agent={message.agent} />}
                  {message.role === 'assistant' && message.done && <SourceList sources={message.sources} />}
                </div>
                {message.role === 'user' && (
                  <div className="w-8 h-8 rounded-lg bg-gray-100 dark:bg-gray-800 flex items-center justify-center shrink-0">
                    <UserRound className="w-4 h-4" />
                  </div>
                )}
              </div>
            ))
          )}

        </div>

        <form onSubmit={onSubmit} className="border-t p-3 flex items-end gap-2">
          <AutoGrowTextarea className="input min-h-10" value={question} onChange={e => setQuestion(e.target.value)}
            placeholder={activeTask.placeholder} disabled={loading} maxHeight={160} />
          <button className="btn-primary shrink-0" disabled={loading || !question.trim()}>
            {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
            发送
          </button>
        </form>
      </div>
    </div>
  );
}
