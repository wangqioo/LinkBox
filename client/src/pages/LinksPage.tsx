import { useState, useEffect, useCallback } from 'react';
import { api, type UploadProgress } from '../api/client';
import LinkCard from '../components/LinkCard';
import AddLinkModal from '../components/AddLinkModal';
import ImportModal from '../components/ImportModal';
import { Plus, Upload, Download, Loader2, CheckSquare, Square } from 'lucide-react';
import LinksFilters from './LinksFilters';
import LinksPagination from './LinksPagination';
import type { LinkPageItem, LinkPageTag } from './linksPageTypes';

const PAGE_SIZE = 500;

function sortLikeMobile(a: LinkPageItem, b: LinkPageItem) {
  return b.id - a.id;
}
export default function LinksPage() {
  const [links, setLinks] = useState<LinkPageItem[]>([]);
  const [tags, setTags] = useState<LinkPageTag[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [activeTag, setActiveTag] = useState('');
  const [activeType, setActiveType] = useState('');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [showAdd, setShowAdd] = useState(false);
  const [showImport, setShowImport] = useState(false);
  const [showFilters, setShowFilters] = useState(false);
  const [showExportMenu, setShowExportMenu] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set());
  const [processingIds, setProcessingIds] = useState<Set<number>>(new Set());

  useEffect(() => {
    const timer = window.setTimeout(() => setDebouncedSearch(search.trim()), 300);
    return () => window.clearTimeout(timer);
  }, [search]);

  const fetchLinks = useCallback(async () => {
    setLoading(true);
    try {
      const params: Record<string, string> = { page: String(page), limit: String(PAGE_SIZE) };
      if (debouncedSearch) params.search = debouncedSearch;
      if (activeTag) params.tag = activeTag;
      if (activeType) params.type = activeType;
      if (dateFrom) params.from = dateFrom;
      if (dateTo) params.to = dateTo;
      const data = await api.getLinks(params);
      setLinks([...data.links].sort(sortLikeMobile));
      setTotal(data.total);
    } catch { /* ignore */ }
    setLoading(false);
  }, [debouncedSearch, activeTag, activeType, dateFrom, dateTo, page]);

  // Reset to page 1 when filters change
  useEffect(() => { setPage(1); }, [debouncedSearch, activeTag, activeType, dateFrom, dateTo]);

  const fetchTags = async () => {
    try { setTags(await api.getTags()); } catch { /* ignore */ }
  };

  useEffect(() => { fetchTags(); }, []);
  useEffect(() => { fetchLinks(); }, [fetchLinks]);

  // Resume polling for any items still processing after page load
  useEffect(() => {
    links.forEach(l => {
      if (l.status === 'processing' && !processingIds.has(l.id)) {
        startPolling(l.id);
      }
    });
  }, [links.map(l => l.id).join(',')]); // eslint-disable-line react-hooks/exhaustive-deps

  // Auto-select all when filtered results change (only when filter panel is open)
  useEffect(() => {
    if (showFilters) setSelectedIds(new Set(links.map(l => l.id)));
    else setSelectedIds(new Set());
  }, [links]); // eslint-disable-line react-hooks/exhaustive-deps

  // When opening filter panel, auto-select current results; when closing, clear selection
  useEffect(() => {
    if (showFilters) setSelectedIds(new Set(links.map(l => l.id)));
    else setSelectedIds(new Set());
  }, [showFilters]); // eslint-disable-line react-hooks/exhaustive-deps


  const startPolling = (id: number) => {
    setProcessingIds(prev => new Set(prev).add(id));
    const interval = setInterval(async () => {
      try {
        const updated = await api.getLink(id);
        setLinks(prev => prev.map(l => l.id === id ? { ...l, ...updated } : l));
        if (updated.status === 'done' || updated.status === 'error') {
          clearInterval(interval);
          setProcessingIds(prev => { const s = new Set(prev); s.delete(id); return s; });
        }
      } catch { /* ignore */ }
    }, 3000);
  };

  const handleAddLink = async (data: any) => {
    const added = await api.addLink(data);
    fetchLinks();
    fetchTags();
    if (added?.id) startPolling(added.id);
  };

  const handleAddText = async (data: any) => {
    await api.addText(data);
    fetchLinks();
    fetchTags();
  };

  const handleAddImage = async (formData: FormData, onProgress?: (p: UploadProgress) => void) => {
    await api.addImage(formData, onProgress);
    fetchLinks();
    fetchTags();
  };

  const handleAddAudio = async (formData: FormData, onProgress?: (p: UploadProgress) => void) => {
    await api.addAudio(formData, onProgress);
    fetchLinks();
    fetchTags();
  };

  const handleAddFile = async (formData: FormData, onProgress?: (p: UploadProgress) => void) => {
    const added = await api.addFile(formData, onProgress);
    fetchLinks();
    fetchTags();
    if (added?.id) startPolling(added.id);
  };

  const handleUpdate = async (id: number, data: Record<string, any>) => {
    await api.updateLink(id, data);
    fetchLinks();
    fetchTags();
  };

  const handleSummarize = async (id: number) => {
    const updated = await api.summarizeLink(id);
    setLinks(prev => prev.map(l => l.id === id ? { ...l, ...updated } : l));
  };

  const handleExtract = async (id: number) => {
    const result = await api.extractContent(id);
    setLinks(prev => prev.map(l => l.id === id ? { ...l, content_md: result.content_md } : l));
  };

  const handleNoteUpdated = (id: number, html: string) => {
    setLinks(prev => prev.map(l => l.id === id ? { ...l, html_note: html } : l));
  };

  const handleDelete = async (id: number) => {
    if (!confirm('确定删除这条收藏？')) return;
    await api.deleteLink(id);
    fetchLinks();
    fetchTags();
  };

  const handleImport = async (items: any[]) => {
    await api.importLinks(items);
    fetchLinks();
  };

  const selectAll = () => setSelectedIds(new Set(links.map(l => l.id)));
  const deselectAll = () => setSelectedIds(new Set());
  const toggleSelect = (id: number) => setSelectedIds(prev => {
    const next = new Set(prev);
    next.has(id) ? next.delete(id) : next.add(id);
    return next;
  });

  const handleExportJson = async () => {
    setShowExportMenu(false);
    const data = await api.exportLinks();
    // Filter to selected IDs if in filter/select mode and something is selected
    const ids = showFilters && selectedIds.size > 0 ? selectedIds : null;
    const filtered = ids
      ? {
          ...data,
          links: data.links.filter((l: any) => ids.has(l.id)),
          linkTags: data.linkTags.filter((lt: any) => ids.has(lt.link_id)),
        }
      : data;
    const blob = new Blob([JSON.stringify(filtered, null, 2)], { type: 'application/json' });
    const burl = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = burl;
    a.download = `linkbox-export-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(burl);
  };

  const handleExportSummaries = () => {
    setShowExportMenu(false);
    const token = localStorage.getItem('linkbox_token');
    const ids = showFilters && selectedIds.size > 0 ? Array.from(selectedIds).join(',') : '';
    const url = '/api/links/export/summaries' + (ids ? `?ids=${ids}` : '');
    fetch(url, { headers: { Authorization: `Bearer ${token}` } })
      .then(r => r.blob())
      .then(blob => {
        const burl = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = burl;
        a.download = `linkbox-summaries-${new Date().toISOString().slice(0, 10)}.md`;
        a.click();
        URL.revokeObjectURL(burl);
      });
  };

  const hasFilters = Boolean(activeTag || dateFrom || dateTo || activeType);
  const activeFilterCount = [activeTag, activeType, dateFrom || dateTo].filter(Boolean).length;
  const exportSelectionActive = showFilters && selectedIds.size > 0;
  const exportScopeLabel = exportSelectionActive ? `选中 ${selectedIds.size} 条` : '全部收藏';
  const clearFilters = () => { setActiveTag(''); setDateFrom(''); setDateTo(''); setActiveType(''); };

  return (
    <div>
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 mb-6">
        <div>
          <h1 className="text-xl font-bold">我的收藏</h1>
          <p className="text-sm text-gray-500">{total} 条收藏{total > PAGE_SIZE ? `，第 ${page} / ${Math.ceil(total / PAGE_SIZE)} 页` : ''}</p>
        </div>
        <div className="flex items-center gap-2">
          <button onClick={() => setShowImport(true)} className="btn-secondary text-xs">
            <Upload className="w-3.5 h-3.5" /> 导入
          </button>
          <div className="relative">
            <button onClick={() => setShowExportMenu(v => !v)} className="btn-secondary text-xs">
              <Download className="w-3.5 h-3.5" /> 导出
            </button>
            {showExportMenu && (
              <>
                <div className="fixed inset-0 z-40" onClick={() => setShowExportMenu(false)} />
                <div className="absolute right-0 mt-1 w-56 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg shadow-lg z-50 py-1">
                  <div className="px-3 py-2 border-b border-gray-100 dark:border-gray-700">
                    <p className="text-[11px] text-gray-400">导出范围</p>
                    <p className="text-xs font-medium text-gray-700 dark:text-gray-200">{exportScopeLabel}</p>
                  </div>
                  <button onClick={handleExportJson}
                    className="w-full text-left px-3 py-2 text-xs hover:bg-gray-50 dark:hover:bg-gray-700 flex items-center gap-2">
                    <span>📦</span> 数据导出 (JSON)
                  </button>
                  <button onClick={handleExportSummaries}
                    className="w-full text-left px-3 py-2 text-xs hover:bg-gray-50 dark:hover:bg-gray-700 flex items-center gap-2">
                    <span>📝</span> 摘要导出 (Markdown)
                  </button>
                </div>
              </>
            )}
          </div>
          <button onClick={() => setShowAdd(true)} className="btn-primary text-xs">
            <Plus className="w-3.5 h-3.5" /> 添加
          </button>
        </div>
      </div>

      <LinksFilters
        search={search}
        onSearchChange={setSearch}
        activeType={activeType}
        onTypeChange={setActiveType}
        showFilters={showFilters}
        onToggleFilters={() => setShowFilters(!showFilters)}
        hasFilters={hasFilters}
        activeFilterCount={activeFilterCount}
        tags={tags}
        activeTag={activeTag}
        onTagChange={setActiveTag}
        dateFrom={dateFrom}
        onDateFromChange={setDateFrom}
        dateTo={dateTo}
        onDateToChange={setDateTo}
        onClearFilters={clearFilters}
      />

      {/* Selection toolbar - visible only when filter panel is open */}
      {showFilters && links.length > 0 && (
        <div className="flex flex-wrap items-center gap-2 sm:gap-3 px-4 py-2.5 mb-3 bg-indigo-50 dark:bg-indigo-900/20 border border-indigo-200 dark:border-indigo-700 rounded-xl text-sm">
          <span className="text-indigo-700 dark:text-indigo-300 font-medium flex-1 min-w-40">
            当前结果 {links.length} 条，已选 {selectedIds.size} 条
          </span>
          <button onClick={selectAll}
            disabled={selectedIds.size === links.length}
            className="flex items-center gap-1 text-xs text-indigo-600 hover:text-indigo-800 dark:text-indigo-400 disabled:opacity-40 disabled:cursor-not-allowed">
            <CheckSquare className="w-3.5 h-3.5" /> 全选
          </button>
          <button onClick={deselectAll}
            disabled={selectedIds.size === 0}
            className="flex items-center gap-1 text-xs text-gray-500 hover:text-gray-700 dark:text-gray-400 disabled:opacity-40 disabled:cursor-not-allowed">
            <Square className="w-3.5 h-3.5" /> 取消全选
          </button>
        </div>
      )}

      {/* Links list */}
      {loading ? (
        <div className="flex justify-center py-20">
          <Loader2 className="w-6 h-6 animate-spin text-gray-400" />
        </div>
      ) : links.length === 0 ? (
        <div className="text-center py-20 text-gray-400">
          <p className="text-lg mb-2">{hasFilters || debouncedSearch ? '没有找到匹配的内容' : '还没有收藏任何内容'}</p>
          <p className="text-sm">{hasFilters || debouncedSearch ? '试试调整筛选条件' : '点击"添加"开始收藏'}</p>
        </div>
      ) : (
        <div className="space-y-3">
          {links.map(link => (
            <LinkCard key={link.id} link={link} allTags={tags}
              onUpdate={handleUpdate} onDelete={handleDelete} onSummarize={handleSummarize}
              onExtract={handleExtract} onNoteUpdated={handleNoteUpdated} isProcessing={processingIds.has(link.id)}
              selectMode={showFilters} selected={selectedIds.has(link.id)} onToggleSelect={toggleSelect} />
          ))}
        </div>
      )}

      <LinksPagination total={total} page={page} pageSize={PAGE_SIZE} onPageChange={setPage} />

      <AddLinkModal open={showAdd} tags={tags} onClose={() => setShowAdd(false)}
        onAddLink={handleAddLink} onAddText={handleAddText} onAddImage={handleAddImage} onAddAudio={handleAddAudio} onAddFile={handleAddFile} />
      <ImportModal open={showImport} onClose={() => setShowImport(false)} onImport={handleImport} />
    </div>
  );
}
