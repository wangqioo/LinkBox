import { FormEvent, useRef, useState } from 'react';
import { api, type AssistantSource } from '../api/client';
import { Bot, CalendarDays, CheckSquare, ChevronDown, FileText, Loader2, Search, Send, Tags, UserRound } from 'lucide-react';
import AutoGrowTextarea from '../components/AutoGrowTextarea';
import MarkdownRenderer from '../components/MarkdownRenderer';

interface Message {
  id: number;
  role: 'user' | 'assistant';
  content: string;
  sources?: AssistantSource[];
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
                          <RetrievalInfo retrieval={chunk.retrieval} />
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

function formatScore(value: unknown) {
  if (typeof value !== 'number' || Number.isNaN(value)) return '';
  return value.toFixed(3);
}

function formatModes(value: unknown) {
  return Array.isArray(value) && value.length ? value.join('+') : '';
}

function formatHeadingPath(value: unknown) {
  if (Array.isArray(value)) return value.filter(Boolean).join(' > ');
  return typeof value === 'string' ? value : '';
}

function RetrievalInfo({ retrieval }: { retrieval?: AssistantSource['retrieval'] }) {
  if (!retrieval) return null;
  const parts = [
    retrieval.sourceKind,
    formatModes(retrieval.retrieval_modes),
    formatScore(retrieval.score) && `score ${formatScore(retrieval.score)}`,
    formatScore(retrieval.combined_score) && `combined ${formatScore(retrieval.combined_score)}`,
    formatScore(retrieval.embedding_score) && `embed ${formatScore(retrieval.embedding_score)}`,
    retrieval.rerank_mode && `rerank ${retrieval.rerank_mode}${formatScore(retrieval.rerank_score) ? ` ${formatScore(retrieval.rerank_score)}` : ''}`,
    formatHeadingPath(retrieval.heading_path) && `heading ${formatHeadingPath(retrieval.heading_path)}`,
    retrieval.chunk_type && `type ${retrieval.chunk_type}`,
  ].filter(Boolean);

  if (!parts.length) return null;
  return (
    <div className="mt-1 text-[11px] leading-5 text-gray-500 dark:text-gray-400">
      检索：{parts.join(' · ')}
    </div>
  );
}

export default function AssistantPage() {
  const [messages, setMessages] = useState<Message[]>([]);
  const [question, setQuestion] = useState('');
  const [task, setTask] = useState('ask');
  const [loading, setLoading] = useState(false);
  const idRef = useRef(1);
  const activeTask = TASKS.find(item => item.key === task) || TASKS[0];

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
    }
  };

  const onSubmit = (e: FormEvent) => {
    e.preventDefault();
    ask(question);
  };

  return (
    <div className="h-[calc(100vh-3rem)] md:h-[calc(100vh-3rem)] flex flex-col">
      <div className="mb-4">
        <h1 className="text-xl font-bold">资料助理</h1>
        <p className="text-sm text-gray-500">问答、总结、报告、整理和待办都基于你的 Markdown 资料库。</p>
      </div>

      <div className="card flex-1 min-h-0 flex flex-col overflow-hidden">
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
