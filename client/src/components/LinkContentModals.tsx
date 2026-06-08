import { useEffect, useState } from 'react';
import { BookOpen, Copy, Loader2, X } from 'lucide-react';
import { api } from '../api/client';
import HtmlModal from './HtmlModal';
import MarkdownRenderer from './MarkdownRenderer';

interface ModalProps {
  linkId: number;
  title: string;
  onClose: () => void;
}

export function LazyHtmlModal({ linkId, title, onClose }: ModalProps) {
  const [html, setHtml] = useState<string | null>(null);

  useEffect(() => {
    api.getLink(linkId).then((data: any) => setHtml(data.html_note || '')).catch(() => setHtml(''));
  }, [linkId]);

  if (html === null) {
    return (
      <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60">
        <Loader2 className="w-8 h-8 animate-spin text-white" />
      </div>
    );
  }

  return <HtmlModal html={html} title={title} onClose={onClose} />;
}

export function MarkdownModal({ linkId, title, onClose }: ModalProps) {
  const [content, setContent] = useState<string | null>(null);
  const [error, setError] = useState('');
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    api.getLink(linkId)
      .then((data: any) => setContent(data.content_md || ''))
      .catch(() => setError('加载失败，请重试'));
  }, [linkId]);

  const copy = () => {
    if (!content) return;
    const stripped = content
      .split('\n')
      .filter((line: string) => !line.match(/^!\[([^\]]*)\]\([^)]+\)$/))
      .map((line: string) => line.replace(/^>\s*图片描述[\uff1a:]\s*/, '图片描述：'))
      .join('\n')
      .replace(/\n{3,}/g, '\n\n')
      .trim();

    navigator.clipboard.writeText(stripped).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm">
      <div className="bg-white dark:bg-gray-900 rounded-2xl shadow-2xl w-full max-w-3xl max-h-[85vh] flex flex-col">
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-200 dark:border-gray-700">
          <div className="flex items-center gap-2 min-w-0">
            <BookOpen className="w-4 h-4 text-teal-500 shrink-0" />
            <span className="font-semibold text-sm truncate">{title}</span>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            {content && (
              <button onClick={copy}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs bg-teal-50 dark:bg-teal-900/30 text-teal-600 dark:text-teal-400 hover:bg-teal-100 transition-colors">
                <Copy className="w-3 h-3" />
                {copied ? '已复制' : '复制 Markdown'}
              </button>
            )}
            <button onClick={onClose} className="btn-ghost p-1.5">
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>
        <div className="flex-1 overflow-y-auto overflow-x-hidden p-5">
          {error ? (
            <p className="text-sm text-red-500">{error}</p>
          ) : content === null ? (
            <div className="flex items-center justify-center py-12">
              <Loader2 className="w-6 h-6 animate-spin text-teal-500" />
            </div>
          ) : (
            <MarkdownRenderer content={content} className="text-sm" />
          )}
        </div>
      </div>
    </div>
  );
}
