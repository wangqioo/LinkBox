import { X } from 'lucide-react';

interface Props {
  html: string;
  title: string;
  onClose: () => void;
}

export default function HtmlModal({ html, title, onClose }: Props) {
  const blob = new Blob([html], { type: 'text/html;charset=utf-8' });
  const srcUrl = URL.createObjectURL(blob);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4" onClick={onClose}>
      <div className="bg-white dark:bg-gray-900 rounded-xl shadow-2xl w-full max-w-5xl h-[90vh] flex flex-col"
        onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between px-4 py-3 border-b border-gray-200 dark:border-gray-700 shrink-0">
          <span className="font-medium text-sm truncate">{title}</span>
          <button onClick={onClose} className="btn-ghost p-1.5 shrink-0">
            <X className="w-4 h-4" />
          </button>
        </div>
        <iframe
          src={srcUrl}
          sandbox="allow-same-origin allow-scripts"
          className="flex-1 w-full rounded-b-xl border-0"
          onLoad={() => URL.revokeObjectURL(srcUrl)}
        />
      </div>
    </div>
  );
}
