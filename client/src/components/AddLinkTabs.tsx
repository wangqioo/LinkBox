import { FileText, Image, Link2, Mic, Paperclip } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import type { ContentType } from './addLinkModalTypes';

const TABS: { key: ContentType; label: string; icon: LucideIcon }[] = [
  { key: 'link', label: '链接', icon: Link2 },
  { key: 'image', label: '图片', icon: Image },
  { key: 'text', label: '文字', icon: FileText },
  { key: 'audio', label: '录音', icon: Mic },
  { key: 'file', label: '文件', icon: Paperclip },
];

interface Props {
  type: ContentType;
  onChange: (type: ContentType) => void;
}

export default function AddLinkTabs({ type, onChange }: Props) {
  return (
    <div className="flex gap-1 p-1 bg-gray-100 dark:bg-gray-800 rounded-lg mb-4">
      {TABS.map(tab => (
        <button key={tab.key} type="button"
          onClick={() => onChange(tab.key)}
          className={`flex-1 flex items-center justify-center gap-1.5 py-2 px-3 rounded-md text-sm font-medium transition-colors ${
            type === tab.key
              ? 'bg-white dark:bg-gray-700 shadow-sm text-gray-900 dark:text-gray-100'
              : 'text-gray-500 hover:text-gray-700 dark:hover:text-gray-300'
          }`}>
          <tab.icon className="w-4 h-4" />
          {tab.label}
        </button>
      ))}
    </div>
  );
}
