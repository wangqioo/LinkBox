import { ChevronLeft, ChevronRight } from 'lucide-react';

interface Props {
  total: number;
  page: number;
  pageSize: number;
  onPageChange: (page: number) => void;
}

export default function LinksPagination({ total, page, pageSize, onPageChange }: Props) {
  if (total <= pageSize) return null;

  const pageCount = Math.ceil(total / pageSize);
  const changePage = (nextPage: number) => {
    onPageChange(nextPage);
    window.scrollTo(0, 0);
  };

  return (
    <div className="flex items-center justify-center gap-2 mt-6">
      <button
        onClick={() => changePage(Math.max(1, page - 1))}
        disabled={page === 1}
        className="flex items-center gap-1 px-3 py-1.5 rounded-lg text-sm border border-gray-200 dark:border-gray-700 disabled:opacity-40 disabled:cursor-not-allowed hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors">
        <ChevronLeft className="w-4 h-4" /> 上一页
      </button>
      <div className="flex items-center gap-1">
        {Array.from({ length: pageCount }, (_, i) => i + 1)
          .filter(p => p === 1 || p === pageCount || Math.abs(p - page) <= 2)
          .reduce<(number | '...')[]>((acc, p, idx, arr) => {
            if (idx > 0 && p - (arr[idx - 1] as number) > 1) acc.push('...');
            acc.push(p);
            return acc;
          }, [])
          .map((p, idx) =>
            p === '...'
              ? <span key={`ellipsis-${idx}`} className="px-1 text-gray-400 text-sm">...</span>
              : <button key={p} onClick={() => changePage(p as number)}
                  className={`w-8 h-8 rounded-lg text-sm font-medium transition-colors ${
                    page === p
                      ? 'bg-gray-900 dark:bg-gray-100 text-white dark:text-gray-900'
                      : 'hover:bg-gray-100 dark:hover:bg-gray-800 text-gray-600 dark:text-gray-400'
                  }`}>{p}</button>
          )}
      </div>
      <button
        onClick={() => changePage(Math.min(pageCount, page + 1))}
        disabled={page === pageCount}
        className="flex items-center gap-1 px-3 py-1.5 rounded-lg text-sm border border-gray-200 dark:border-gray-700 disabled:opacity-40 disabled:cursor-not-allowed hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors">
        下一页 <ChevronRight className="w-4 h-4" />
      </button>
    </div>
  );
}
