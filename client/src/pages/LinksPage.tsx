import { useState, useEffect, useCallback } from 'react';
import { api, type UploadProgress } from '../api/client';
import LinkCard from '../components/LinkCard';
import AddLinkModal from '../components/AddLinkModal';
import ImportModal from '../components/ImportModal';
import { Plus, Search, Upload, Download, Filter, X, Loader2, Link2, Image, FileText, Mic, Paperclip, CheckSquare, Square, ChevronLeft, ChevronRight } from 'lucide-react';

const PAGE_SIZE = 500;

function sortLikeMobile(a: Link, b: Link) {
  return b.id - a.id;
}

interface Tag { id: number; name: string; color: string; link_count: number; }
interface LinkItem {
  id: number; type?: string; url: string; title: string; description: string;
  thumbnail: string; comment: string; content?: string; image_path?: string;
  imported_at: string; tags: Tag[];
}

const TYPE_FILTERS = [
  { key: '', label: '全部', icon: null },
  { key: 'link', label: '链接', icon: Link2 },
  { key: 'image', label: '图片', icon: Image },
  { key: 'text', label: '文字', icon: FileText },
  { key: 'audio', label: '录音', icon: Mic },
  { key: 'file', label: '文件', icon: Paperclip },
];

export default function LinksPage() {
  const [links, setLinks] = useState<LinkItem[]>([]);
  const [tags, setTags] = useState<Tag[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [activeTag, setActiveTag] = useState('');
  const [activeType, setActiveType] = useState('');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [showAdd, setShowAdd] = useState(false);
  const [showImport, setShowImport] = useState(false);
  const [showFilters, setShowFilters] = useState(false);
  const [processingIds, setProcessingIds] = useState<Set<number>>(new Set());

  const fetchLinks = useCallback(async () => {
    setLoading(true);
    try {
      const params: Record<string, string> = { page: String(page), limit: String(PAGE_SIZE) };
      if (search) params.search = search;
      if (activeTag) params.tag = activeTag;
      if (activeType) params.type = activeType;
      if (dateFrom) params.from = dateFrom;
      if (dateTo) params.to = dateTo;
      const data = await api.getLinks(params);
      setLinks([...data.links].sort(sortLikeMobile));
      setTotal(data.total);
    } catch { /* ignore */ }
    setLoading(false);
  }, [search, activeTag, activeType, dateFrom, dateTo, page]);

  // Reset to page 1 when filters change
  useEffect(() => { setPage(1); }, [search, activeTag, activeType, dateFrom, dateTo]);

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

  const [showExportMenu, setShowExportMenu] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set());

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

  const hasFilters = activeTag || dateFrom || dateTo || activeType;
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
                <div className="absolute right-0 mt-1 w-48 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg shadow-lg z-50 py-1">
                  <button onClick={handleExportJson}
                    className="w-full text-left px-3 py-2 text-xs hover:bg-gray-50 dark:hover:bg-gray-700 flex items-center gap-2">
                    <span>📦</span> 全量导出 (JSON)
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

      {/* Search & Filter bar */}
      <div className="card p-3 mb-4 space-y-3">
        <div className="flex gap-2">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
            <input className="input pl-9" placeholder="搜索标题、链接、评论..."
              value={search} onChange={e => setSearch(e.target.value)} />
          </div>
          <button onClick={() => setShowFilters(!showFilters)}
            className={`btn-secondary relative ${hasFilters ? 'text-indigo-600' : ''}`}>
            <Filter className="w-4 h-4" />
            {hasFilters && <span className="absolute -top-1 -right-1 w-2 h-2 bg-indigo-600 rounded-full" />}
          </button>
        </div>

        {/* Type filter pills - always visible */}
        <div className="flex gap-1.5">
          {TYPE_FILTERS.map(tf => (
            <button key={tf.key} onClick={() => setActiveType(tf.key)}
              className={`flex items-center gap-1 px-3 py-1.5 rounded-full text-xs font-medium transition-colors ${
                activeType === tf.key
                  ? 'bg-gray-900 dark:bg-gray-100 text-white dark:text-gray-900'
                  : 'bg-gray-100 dark:bg-gray-800 text-gray-600 dark:text-gray-400 hover:bg-gray-200 dark:hover:bg-gray-700'
              }`}>
              {tf.icon && <tf.icon className="w-3 h-3" />}
              {tf.label}
            </button>
          ))}
        </div>

        {/* Expanded filters */}
        {showFilters && (
          <div className="space-y-3 pt-2 border-t">
            {/* Tag filter */}
            <div>
              <label className="text-xs text-gray-500 mb-1.5 block">按标签筛选</label>
              <div className="flex flex-wrap gap-1.5">
                <button onClick={() => setActiveTag('')}
                  className={`px-2.5 py-1 rounded-full text-xs font-medium border transition-colors ${
                    !activeTag ? 'bg-gray-900 dark:bg-gray-100 text-white dark:text-gray-900 border-transparent' : 'border-gray-200 dark:border-gray-700'
                  }`}>
                  全部
                </button>
                {tags.map(tag => (
                  <button key={tag.id} onClick={() => setActiveTag(String(tag.id))}
                    className={`px-2.5 py-1 rounded-full text-xs font-medium border transition-colors ${
                      activeTag === String(tag.id) ? 'border-transparent text-white' : 'border-gray-200 dark:border-gray-700'
                    }`}
                    style={activeTag === String(tag.id) ? { backgroundColor: tag.color } : {}}>
                    {tag.name} ({tag.link_count})
                  </button>
                ))}
              </div>
            </div>
            {/* Date range */}
            <div className="flex flex-col sm:flex-row gap-2">
              <div className="flex-1">
                <label className="text-xs text-gray-500 mb-1 block">开始日期</label>
                <input type="date" className="input text-sm" value={dateFrom} onChange={e => setDateFrom(e.target.value)} />
              </div>
              <div className="flex-1">
                <label className="text-xs text-gray-500 mb-1 block">结束日期</label>
                <input type="date" className="input text-sm" value={dateTo} onChange={e => setDateTo(e.target.value)} />
              </div>
              {hasFilters && (
                <button onClick={clearFilters} className="btn-ghost text-xs self-end text-red-500">
                  <X className="w-3 h-3" /> 清除筛选
                </button>
              )}
            </div>
          </div>
        )}
      </div>

      {/* Selection toolbar - visible only when filter panel is open */}
      {showFilters && links.length > 0 && (
        <div className="flex items-center gap-3 px-4 py-2.5 mb-3 bg-indigo-50 dark:bg-indigo-900/20 border border-indigo-200 dark:border-indigo-700 rounded-xl text-sm">
          <span className="text-indigo-700 dark:text-indigo-300 font-medium flex-1">
            已选 {selectedIds.size} / {links.length} 条
          </span>
          <button onClick={selectAll}
            className="flex items-center gap-1 text-xs text-indigo-600 hover:text-indigo-800 dark:text-indigo-400">
            <CheckSquare className="w-3.5 h-3.5" /> 全选
          </button>
          <button onClick={deselectAll}
            className="flex items-center gap-1 text-xs text-gray-500 hover:text-gray-700 dark:text-gray-400">
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
          <p className="text-lg mb-2">{hasFilters || search ? '没有找到匹配的内容' : '还没有收藏任何内容'}</p>
          <p className="text-sm">{hasFilters || search ? '试试调整筛选条件' : '点击"添加"开始收藏'}</p>
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

      {/* Pagination */}
      {total > PAGE_SIZE && (
        <div className="flex items-center justify-center gap-2 mt-6">
          <button
            onClick={() => { setPage(p => Math.max(1, p - 1)); window.scrollTo(0, 0); }}
            disabled={page === 1}
            className="flex items-center gap-1 px-3 py-1.5 rounded-lg text-sm border border-gray-200 dark:border-gray-700 disabled:opacity-40 disabled:cursor-not-allowed hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors">
            <ChevronLeft className="w-4 h-4" /> 上一页
          </button>
          <div className="flex items-center gap-1">
            {Array.from({ length: Math.ceil(total / PAGE_SIZE) }, (_, i) => i + 1)
              .filter(p => p === 1 || p === Math.ceil(total / PAGE_SIZE) || Math.abs(p - page) <= 2)
              .reduce<(number | '...')[]>((acc, p, idx, arr) => {
                if (idx > 0 && p - (arr[idx - 1] as number) > 1) acc.push('...');
                acc.push(p);
                return acc;
              }, [])
              .map((p, idx) =>
                p === '...'
                  ? <span key={`ellipsis-${idx}`} className="px-1 text-gray-400 text-sm">…</span>
                  : <button key={p} onClick={() => { setPage(p as number); window.scrollTo(0, 0); }}
                      className={`w-8 h-8 rounded-lg text-sm font-medium transition-colors ${
                        page === p
                          ? 'bg-gray-900 dark:bg-gray-100 text-white dark:text-gray-900'
                          : 'hover:bg-gray-100 dark:hover:bg-gray-800 text-gray-600 dark:text-gray-400'
                      }`}>{p}</button>
              )}
          </div>
          <button
            onClick={() => { setPage(p => Math.min(Math.ceil(total / PAGE_SIZE), p + 1)); window.scrollTo(0, 0); }}
            disabled={page === Math.ceil(total / PAGE_SIZE)}
            className="flex items-center gap-1 px-3 py-1.5 rounded-lg text-sm border border-gray-200 dark:border-gray-700 disabled:opacity-40 disabled:cursor-not-allowed hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors">
            下一页 <ChevronRight className="w-4 h-4" />
          </button>
        </div>
      )}

      <AddLinkModal open={showAdd} tags={tags} onClose={() => setShowAdd(false)}
        onAddLink={handleAddLink} onAddText={handleAddText} onAddImage={handleAddImage} onAddAudio={handleAddAudio} onAddFile={handleAddFile} />
      <ImportModal open={showImport} onClose={() => setShowImport(false)} onImport={handleImport} />
    </div>
  );
}
