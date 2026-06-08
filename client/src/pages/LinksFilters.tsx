import { FileText, Filter, Image, Link2, Mic, Paperclip, Search, X } from 'lucide-react';
import type { LinkPageTag } from './linksPageTypes';

const TYPE_FILTERS = [
  { key: '', label: '全部', icon: null },
  { key: 'link', label: '链接', icon: Link2 },
  { key: 'image', label: '图片', icon: Image },
  { key: 'text', label: '文字', icon: FileText },
  { key: 'audio', label: '录音', icon: Mic },
  { key: 'file', label: '文件', icon: Paperclip },
];

interface Props {
  search: string;
  onSearchChange: (value: string) => void;
  activeType: string;
  onTypeChange: (value: string) => void;
  showFilters: boolean;
  onToggleFilters: () => void;
  hasFilters: string | boolean;
  activeFilterCount?: number;
  tags: LinkPageTag[];
  activeTag: string;
  onTagChange: (value: string) => void;
  dateFrom: string;
  onDateFromChange: (value: string) => void;
  dateTo: string;
  onDateToChange: (value: string) => void;
  onClearFilters: () => void;
}

export default function LinksFilters({
  search,
  onSearchChange,
  activeType,
  onTypeChange,
  showFilters,
  onToggleFilters,
  hasFilters,
  activeFilterCount = 0,
  tags,
  activeTag,
  onTagChange,
  dateFrom,
  onDateFromChange,
  dateTo,
  onDateToChange,
  onClearFilters,
}: Props) {
  return (
    <div className="card p-3 mb-4 space-y-3">
      <div className="flex gap-2">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
          <input className="input pl-9" placeholder="搜索标题、链接、评论..."
            value={search} onChange={e => onSearchChange(e.target.value)} />
        </div>
        <button onClick={onToggleFilters}
          className={`btn-secondary relative ${hasFilters ? 'text-indigo-600' : ''}`}>
          <Filter className="w-4 h-4" />
          {activeFilterCount > 0 && (
            <span className="absolute -top-1.5 -right-1.5 min-w-4 h-4 px-1 bg-indigo-600 text-white text-[10px] leading-4 rounded-full">
              {activeFilterCount}
            </span>
          )}
        </button>
      </div>

      <div className="flex gap-1.5 overflow-x-auto pb-0.5">
        {TYPE_FILTERS.map(typeFilter => (
          <button key={typeFilter.key} onClick={() => onTypeChange(typeFilter.key)}
            className={`shrink-0 flex items-center gap-1 px-3 py-1.5 rounded-full text-xs font-medium transition-colors ${
              activeType === typeFilter.key
                ? 'bg-gray-900 dark:bg-gray-100 text-white dark:text-gray-900'
                : 'bg-gray-100 dark:bg-gray-800 text-gray-600 dark:text-gray-400 hover:bg-gray-200 dark:hover:bg-gray-700'
            }`}>
            {typeFilter.icon && <typeFilter.icon className="w-3 h-3" />}
            {typeFilter.label}
          </button>
        ))}
      </div>

      {showFilters && (
        <div className="space-y-3 pt-2 border-t">
          <div>
            <label className="text-xs text-gray-500 mb-1.5 block">按标签筛选</label>
            <div className="flex flex-wrap gap-1.5">
              <button onClick={() => onTagChange('')}
                className={`px-2.5 py-1 rounded-full text-xs font-medium border transition-colors ${
                  !activeTag ? 'bg-gray-900 dark:bg-gray-100 text-white dark:text-gray-900 border-transparent' : 'border-gray-200 dark:border-gray-700'
                }`}>
                全部
              </button>
              {tags.map(tag => (
                <button key={tag.id} onClick={() => onTagChange(String(tag.id))}
                  className={`px-2.5 py-1 rounded-full text-xs font-medium border transition-colors ${
                    activeTag === String(tag.id) ? 'border-transparent text-white' : 'border-gray-200 dark:border-gray-700'
                  }`}
                  style={activeTag === String(tag.id) ? { backgroundColor: tag.color } : {}}>
                  {tag.name} ({tag.link_count})
                </button>
              ))}
            </div>
          </div>
          <div className="flex flex-col sm:flex-row gap-2">
            <div className="flex-1">
              <label className="text-xs text-gray-500 mb-1 block">开始日期</label>
              <input type="date" className="input text-sm" value={dateFrom} onChange={e => onDateFromChange(e.target.value)} />
            </div>
            <div className="flex-1">
              <label className="text-xs text-gray-500 mb-1 block">结束日期</label>
              <input type="date" className="input text-sm" value={dateTo} onChange={e => onDateToChange(e.target.value)} />
            </div>
            {hasFilters && (
              <button onClick={onClearFilters} className="btn-ghost text-xs self-end text-red-500">
                <X className="w-3 h-3" /> 清除筛选
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
