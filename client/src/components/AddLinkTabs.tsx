import type { ContentType } from './addLinkModalTypes';
import { ADD_ITEM_TABS } from './itemDisplay';

interface Props {
  type: ContentType;
  onChange: (type: ContentType) => void;
}

export default function AddLinkTabs({ type, onChange }: Props) {
  return (
    <div className="flex gap-1 p-1 bg-gray-100 dark:bg-gray-800 rounded-lg mb-4">
      {ADD_ITEM_TABS.map(tab => (
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
