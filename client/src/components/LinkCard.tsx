import { useState } from 'react';
import { ExternalLink, Pencil, Trash2, X, Check, MessageSquare, FileText, Image, Mic, Download, Sparkles, Loader2, BookOpen, GraduationCap, FileSpreadsheet, Presentation, FileCode, File, Globe, FileSearch } from 'lucide-react';
import MarkdownRenderer from './MarkdownRenderer';
import LearningNoteModal from './LearningNoteModal';
import DocumentInspectorModal from './DocumentInspectorModal';
import { LazyHtmlModal, MarkdownModal } from './LinkContentModals';
import ProcessingBanner from './ProcessingBanner';
import type { LinkCardProps } from './linkCardTypes';
import { formatLinkDate, getItemTypeLabel, getLinkDomain, isLinkLikeItemType, proxyImage } from './linkCardUtils';
import { deriveProcessingDisplay } from './processingStatus';

export default function LinkCard({ link, allTags, onUpdate, onDelete, onSummarize, onExtract, onRetryProcessing, onNoteUpdated, isProcessing = false, selectMode = false, selected = false, onToggleSelect }: LinkCardProps) {
  const [editing, setEditing] = useState(false);
  const [comment, setComment] = useState(link.comment);
  const [editContent, setEditContent] = useState(link.content || '');
  const [editTitle, setEditTitle] = useState(link.title || '');
  const [selectedTags, setSelectedTags] = useState<number[]>(link.tags.map(t => t.id));
  const [summarizing, setSummarizing] = useState(false);
  const [extracting, setExtracting] = useState(false);
  const [savingEdit, setSavingEdit] = useState(false);
  const [retryingProcessing, setRetryingProcessing] = useState(false);
  const [retryError, setRetryError] = useState('');
  const [showMarkdown, setShowMarkdown] = useState(false);
  const [showNote, setShowNote] = useState(false);
  const [showHtml, setShowHtml] = useState(false);
  const [showDocumentInspector, setShowDocumentInspector] = useState(false);

  const itemType = link.type || 'link';
  const isLinkLike = isLinkLikeItemType(itemType);
  const itemLabel = link.title || link.url || link.description || `收藏 ${link.id}`;

  const selectOverlay = selectMode ? (
    <div
      className={`absolute inset-0 z-10 cursor-pointer rounded-xl transition-colors ${selected ? 'bg-indigo-500/10 ring-2 ring-indigo-500' : 'bg-transparent hover:bg-gray-500/5'}`}
      onClick={() => onToggleSelect?.(link.id)}
    >
      <div className={`absolute top-3 left-3 w-5 h-5 rounded-full border-2 flex items-center justify-center transition-all ${selected ? 'bg-indigo-500 border-indigo-500' : 'bg-white dark:bg-gray-800 border-gray-300 dark:border-gray-600'}`}>
        {selected && <Check className="w-3 h-3 text-white" />}
      </div>
    </div>
  ) : null;

  const save = async () => {
    if (savingEdit) return;
    const data: Record<string, any> = { comment, tag_ids: selectedTags };
    if (itemType === 'text') {
      data.title = editTitle;
      data.content = editContent;
    }
    setSavingEdit(true);
    try {
      await onUpdate(link.id, data);
      setEditing(false);
    } catch {
      // The page-level action already shows a toast.
    } finally {
      setSavingEdit(false);
    }
  };

  const cancel = () => {
    setComment(link.comment);
    setEditContent(link.content || '');
    setEditTitle(link.title || '');
    setSelectedTags(link.tags.map(t => t.id));
    setEditing(false);
  };

  const domain = getLinkDomain(link.url);
  const typeLabel = getItemTypeLabel(itemType);

  const editSection = editing && (
    <div className="mt-3 space-y-3">
      {itemType === 'text' && (
        <>
          <div>
            <label className="text-xs text-gray-500 mb-1 block">标题</label>
            <input aria-label="编辑标题" className="input text-sm" value={editTitle}
              onChange={e => setEditTitle(e.target.value)} />
          </div>
          <div>
            <label className="text-xs text-gray-500 mb-1 block">内容</label>
            <textarea aria-label="编辑内容" className="input text-sm" rows={4} value={editContent}
              onChange={e => setEditContent(e.target.value)} />
          </div>
        </>
      )}
      <div>
        <label className="text-xs text-gray-500 mb-1 block">我的评论</label>
        <textarea className="input text-sm" rows={2} placeholder="写点什么..."
          value={comment} onChange={e => setComment(e.target.value)} />
      </div>
      <div>
        <label className="text-xs text-gray-500 mb-1 block">标签</label>
        <div className="flex flex-wrap gap-1.5">
          {allTags.map(tag => (
            <button key={tag.id}
              onClick={() => setSelectedTags(prev =>
                prev.includes(tag.id) ? prev.filter(id => id !== tag.id) : [...prev, tag.id]
              )}
              className={`px-2.5 py-1 rounded-full text-xs font-medium border transition-colors ${
                selectedTags.includes(tag.id)
                  ? 'border-transparent text-white' : 'border-gray-200 dark:border-gray-700'
              }`}
              style={selectedTags.includes(tag.id) ? { backgroundColor: tag.color } : {}}>
              {tag.name}
            </button>
          ))}
        </div>
      </div>
      <div className="flex gap-2">
        <button onClick={save} disabled={savingEdit} className="btn-primary text-xs py-1.5">
          {savingEdit ? <Loader2 className="w-3 h-3 animate-spin" /> : <Check className="w-3 h-3" />}
          {savingEdit ? '保存中' : '保存'}
        </button>
        <button onClick={cancel} className="btn-secondary text-xs py-1.5">
          <X className="w-3 h-3" /> 取消
        </button>
      </div>
    </div>
  );

  const handleSummarize = async () => {
    if (!onSummarize || summarizing) return;
    setSummarizing(true);
    try {
      await onSummarize(link.id);
    } catch {
      // The page-level action already shows a toast.
    } finally {
      setSummarizing(false);
    }
  };

  const handleExtract = async () => {
    if (!onExtract || extracting) return;
    setExtracting(true);
    try {
      await onExtract(link.id);
      setShowMarkdown(true);
    } catch {
      // The page-level action already shows a toast.
    } finally { setExtracting(false); }
  };

  const handleRetryProcessing = async () => {
    if (!onRetryProcessing || retryingProcessing) return;
    setRetryingProcessing(true);
    setRetryError('');
    try {
      await onRetryProcessing(link.id);
    } catch (error: any) {
      setRetryError(error.message || '重试失败');
    } finally {
      setRetryingProcessing(false);
    }
  };

  const fileExt0 = (link.title || '').match(/\.(\w+)$/)?.[1]?.toLowerCase() || '';
  const isHtmlFile = itemType === 'file' && ['html', 'htm'].includes(fileExt0);
  const canSummarize = onSummarize && (isLinkLike || itemType === 'text' || itemType === 'file' || itemType === 'document');
  const canExtract = onExtract && (isLinkLike || itemType === 'file' || itemType === 'document');
  // Use flag columns from list API (content_md not included in list response)
  const hasMarkdown = !!(link.has_content_md || link.content_md);
  const hasHtml = isHtmlFile && !!(link.has_html_note || link.html_note);

  const actionButtons = !editing && (
    <div className="flex items-center gap-1 shrink-0">
      {isHtmlFile ? (
        <button onClick={() => setShowHtml(true)}
          disabled={!hasHtml}
          title={hasHtml ? '预览网页' : '正在处理...'}
          className={`btn-ghost p-1.5 disabled:opacity-50 ${hasHtml ? 'text-teal-500' : 'text-gray-400'}`}>
          <Globe className="w-3.5 h-3.5" />
        </button>
      ) : canExtract && (
        <button onClick={hasMarkdown ? () => setShowMarkdown(true) : handleExtract}
          disabled={extracting}
          title={hasMarkdown ? '查看正文 Markdown' : '提取正文'}
          className={`btn-ghost p-1.5 disabled:opacity-50 ${hasMarkdown ? 'text-teal-500' : 'text-gray-500'}`}>
          {extracting ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <BookOpen className="w-3.5 h-3.5" />}
        </button>
      )}
      {hasMarkdown && !isHtmlFile && (
        <button onClick={() => setShowNote(true)}
          title="AI 学习笔记"
          className={`btn-ghost p-1.5 ${link.html_note ? 'text-violet-500' : 'text-gray-400'}`}>
          <GraduationCap className="w-3.5 h-3.5" />
        </button>
      )}
      {hasMarkdown && (
        <button onClick={() => setShowDocumentInspector(true)}
          title="查看文档索引"
          className="btn-ghost p-1.5 text-indigo-500">
          <FileSearch className="w-3.5 h-3.5" />
        </button>
      )}
      {canSummarize && (
        <button onClick={handleSummarize} disabled={summarizing}
          title="AI 摘要"
          className="btn-ghost p-1.5 text-purple-500 disabled:opacity-50">
          {summarizing ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Sparkles className="w-3.5 h-3.5" />}
        </button>
      )}
      <button onClick={() => setEditing(true)} aria-label={`编辑收藏 ${itemLabel}`} className="btn-ghost p-1.5 text-gray-500">
        <Pencil className="w-3.5 h-3.5" />
      </button>
      <button onClick={() => onDelete(link.id)} aria-label={`删除收藏 ${itemLabel}`} className="btn-ghost p-1.5 text-red-500">
        <Trash2 className="w-3.5 h-3.5" />
      </button>
    </div>
  );

  const tagsDisplay = !editing && link.tags.length > 0 && (
    <div className="flex flex-wrap gap-1.5 mt-2">
      {link.tags.map(tag => (
        <span key={tag.id} className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium"
          style={{ backgroundColor: tag.color + '20', color: tag.color }}>
          {tag.name}
        </span>
      ))}
    </div>
  );

  const commentDisplay = !editing && link.comment && (
    <div className="mt-2 flex items-start gap-1.5 text-xs text-gray-500">
      <MessageSquare className="w-3 h-3 mt-0.5 shrink-0" />
      <span className="line-clamp-2">{link.comment}</span>
    </div>
  );

  const summaryDisplay = !editing && link.summary && (
    <div className="mt-2 flex items-start gap-1.5 text-xs text-purple-600 dark:text-purple-400 bg-purple-50 dark:bg-purple-900/20 rounded-lg px-2.5 py-2">
      <Sparkles className="w-3 h-3 mt-0.5 shrink-0" />
      <span>{link.summary}</span>
    </div>
  );

  const summarizingIndicator = summarizing && (
    <div className="mt-2 flex items-center gap-1.5 text-xs text-purple-500 bg-purple-50 dark:bg-purple-900/20 rounded-lg px-2.5 py-2">
      <Loader2 className="w-3 h-3 animate-spin shrink-0" />
      <span>AI 正在生成摘要...</span>
    </div>
  );

  const autoStatus = deriveProcessingDisplay({
    status: link.status,
    isProcessing,
    hasMarkdown,
    hasSummary: Boolean(link.summary),
    itemType,
    url: link.url,
    processing: link.processing,
  });
  const autoProcessingBanner = autoStatus && (
    <ProcessingBanner
      display={autoStatus}
      retryError={retryError}
      retrying={retryingProcessing}
      onRetry={onRetryProcessing ? handleRetryProcessing : undefined}
    />
  );

  const extractingIndicator = extracting && (
    <div className="mt-2 flex items-center gap-1.5 text-xs text-teal-500 bg-teal-50 dark:bg-teal-900/20 rounded-lg px-2.5 py-2">
      <Loader2 className="w-3 h-3 animate-spin shrink-0" />
      <span>正在提取正文...</span>
    </div>
  );

  const markdownBadge = !editing && hasMarkdown && (isLinkLike || itemType === 'file' || itemType === 'document') && (
    <button onClick={() => setShowMarkdown(true)}
      className="mt-2 inline-flex items-center gap-1 text-xs text-teal-600 dark:text-teal-400 bg-teal-50 dark:bg-teal-900/20 rounded-lg px-2.5 py-1.5 hover:bg-teal-100 transition-colors">
      <BookOpen className="w-3 h-3" />
      已提取正文 · 点击查看
    </button>
  );

  if (itemType === 'image') {
    return (
      <div role="article" aria-label={itemLabel} className="relative card overflow-hidden group hover:shadow-md transition-shadow">
        {selectOverlay}
        {link.image_path && !editing && (
          <div className="bg-gray-100 dark:bg-gray-800">
            <img src={link.image_path} alt={link.title}
              className="w-full max-h-64 object-contain"
              onError={e => { (e.target as HTMLImageElement).style.display = 'none'; }} />
          </div>
        )}
        <div className="p-4">
          <div className="flex items-start justify-between gap-2">
            <div className="min-w-0">
              <div className="flex items-center gap-1.5">
                <Image className="w-3.5 h-3.5 text-indigo-500 shrink-0" />
                <span className="font-medium text-sm truncate">{link.title || '未命名图片'}</span>
              </div>
              <p className="text-xs text-gray-400 mt-0.5">
                <span className="inline-flex items-center gap-1 px-1.5 py-0.5 bg-indigo-50 dark:bg-indigo-900/30 text-indigo-600 dark:text-indigo-400 rounded text-[10px]">
                  {typeLabel}
                </span>
                <span className="ml-1.5">{formatLinkDate(link.imported_at)}</span>
              </p>
            </div>
            {actionButtons}
          </div>
          {tagsDisplay}{commentDisplay}{editSection}
        </div>
      </div>
    );
  }

  if (itemType === 'text') {
    return (
      <div role="article" aria-label={itemLabel} className="relative card overflow-hidden group hover:shadow-md transition-shadow">
        {selectOverlay}
        <div className="p-4">
          <div className="flex items-start justify-between gap-2">
            <div className="min-w-0">
              <div className="flex items-center gap-1.5">
                <FileText className="w-3.5 h-3.5 text-emerald-500 shrink-0" />
                <span className="font-medium text-sm truncate">{link.title || '未命名笔记'}</span>
              </div>
              <p className="text-xs text-gray-400 mt-0.5">
                <span className="inline-flex items-center gap-1 px-1.5 py-0.5 bg-emerald-50 dark:bg-emerald-900/30 text-emerald-600 dark:text-emerald-400 rounded text-[10px]">
                  {typeLabel}
                </span>
                <span className="ml-1.5">{formatLinkDate(link.imported_at)}</span>
              </p>
            </div>
            {actionButtons}
          </div>
          {!editing && link.content && (
            <div className="mt-2">
              <MarkdownRenderer content={link.content} maxLines={8} />
            </div>
          )}
          {summarizingIndicator}{summaryDisplay}{tagsDisplay}{commentDisplay}{editSection}
        </div>
      </div>
    );
  }

  if (itemType === 'audio') {
    return (
      <div role="article" aria-label={itemLabel} className="relative card overflow-hidden group hover:shadow-md transition-shadow">
        {selectOverlay}
        <div className="p-4">
          <div className="flex items-start justify-between gap-2">
            <div className="min-w-0">
              <div className="flex items-center gap-1.5">
                <Mic className="w-3.5 h-3.5 text-orange-500 shrink-0" />
                <span className="font-medium text-sm truncate">{link.title || '未命名录音'}</span>
              </div>
              <p className="text-xs text-gray-400 mt-0.5">
                <span className="inline-flex items-center gap-1 px-1.5 py-0.5 bg-orange-50 dark:bg-orange-900/30 text-orange-600 dark:text-orange-400 rounded text-[10px]">
                  {typeLabel}
                </span>
                <span className="ml-1.5">{formatLinkDate(link.imported_at)}</span>
              </p>
            </div>
            {actionButtons}
          </div>
          {link.image_path && !editing && (
            <audio controls className="w-full mt-3 h-10" preload="metadata">
              <source src={link.image_path} />
            </audio>
          )}
          {tagsDisplay}{commentDisplay}{editSection}
        </div>
      </div>
    );
  }

  if (itemType === 'file') {
    const fileExt = (link.title || link.description || '').match(/\.(\w+)/)?.[1]?.toLowerCase() || '';
    const FileIcon = ['xlsx', 'xls', 'csv'].includes(fileExt) ? FileSpreadsheet
      : ['pptx', 'ppt'].includes(fileExt) ? Presentation
      : ['docx', 'doc'].includes(fileExt) ? FileText
      : ['pdf'].includes(fileExt) ? FileCode
      : ['html', 'htm'].includes(fileExt) ? Globe
      : File;
    const iconColor = ['xlsx', 'xls', 'csv'].includes(fileExt) ? 'text-emerald-500'
      : ['pptx', 'ppt'].includes(fileExt) ? 'text-orange-500'
      : ['docx', 'doc'].includes(fileExt) ? 'text-blue-500'
      : ['pdf'].includes(fileExt) ? 'text-red-500'
      : ['html', 'htm'].includes(fileExt) ? 'text-cyan-500'
      : 'text-violet-500';
    const iconBg = ['xlsx', 'xls', 'csv'].includes(fileExt) ? 'bg-emerald-50 dark:bg-emerald-900/20'
      : ['pptx', 'ppt'].includes(fileExt) ? 'bg-orange-50 dark:bg-orange-900/20'
      : ['docx', 'doc'].includes(fileExt) ? 'bg-blue-50 dark:bg-blue-900/20'
      : ['pdf'].includes(fileExt) ? 'bg-red-50 dark:bg-red-900/20'
      : ['html', 'htm'].includes(fileExt) ? 'bg-cyan-50 dark:bg-cyan-900/20'
      : 'bg-violet-50 dark:bg-violet-900/20';

    return (
      <>
        {showDocumentInspector && (
          <DocumentInspectorModal linkId={link.id} title={link.title || '文件文档'} onClose={() => setShowDocumentInspector(false)} />
        )}
        {showHtml && hasHtml && (
          <LazyHtmlModal linkId={link.id} title={link.title || '网页预览'} onClose={() => setShowHtml(false)} />
        )}
        {showMarkdown && (
          <MarkdownModal linkId={link.id} title={link.title || '文件正文'} onClose={() => setShowMarkdown(false)} />
        )}
        {showNote && (
          <LearningNoteModal
            linkId={link.id}
            linkTitle={link.title || '文件正文'}
            linkUrl={link.url}
            initialHtml={link.html_note || null}
            onClose={() => setShowNote(false)}
            onUpdated={(html) => { onNoteUpdated?.(link.id, html); }}
          />
        )}
        <div role="article" aria-label={itemLabel} className="relative card overflow-hidden group hover:shadow-md transition-shadow">
          {selectOverlay}
          <div className="flex">
            {link.thumbnail ? (
              <div className="w-24 h-24 sm:w-32 sm:h-32 shrink-0 bg-gray-100 dark:bg-gray-800">
                <img src={link.thumbnail} alt="" className="w-full h-full object-cover"
                  onError={e => { (e.target as HTMLImageElement).style.display = 'none'; }} />
              </div>
            ) : (
              <div className={`w-24 h-24 sm:w-32 sm:h-32 shrink-0 flex items-center justify-center ${iconBg}`}>
                <FileIcon className={`w-10 h-10 ${iconColor}`} />
              </div>
            )}
            <div className="flex-1 p-4 min-w-0">
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <span className="font-medium text-sm truncate block">{link.title || '未命名文件'}</span>
                  <p className="text-xs text-gray-400 mt-0.5 truncate">
                    <span className="inline-flex items-center gap-1 px-1.5 py-0.5 bg-violet-50 dark:bg-violet-900/30 text-violet-600 dark:text-violet-400 rounded text-[10px]">
                      {typeLabel}
                    </span>
                    <span className="ml-1.5">{link.description}</span>
                    <span className="ml-1.5">{formatLinkDate(link.imported_at)}</span>
                  </p>
                </div>
                {actionButtons}
              </div>
              {!editing && link.image_path && (
                <a href={link.image_path} download
                  className="inline-flex items-center gap-1.5 mt-2 px-2.5 py-1 bg-violet-50 dark:bg-violet-900/20 text-violet-600 dark:text-violet-400 rounded-lg text-xs font-medium hover:bg-violet-100 dark:hover:bg-violet-900/40 transition-colors">
                  <Download className="w-3 h-3" /> 下载文件
                </a>
              )}
              {autoProcessingBanner}
              {extractingIndicator}
              {markdownBadge}
              {summarizingIndicator}
              {summaryDisplay}
              {tagsDisplay}{commentDisplay}{editSection}
            </div>
          </div>
        </div>
      </>
    );
  }

  return (
    <>
      {showDocumentInspector && (
        <DocumentInspectorModal linkId={link.id} title={link.title || link.url} onClose={() => setShowDocumentInspector(false)} />
      )}
      {showMarkdown && (
        <MarkdownModal linkId={link.id} title={link.title || link.url} onClose={() => setShowMarkdown(false)} />
      )}
      {showNote && (
        <LearningNoteModal
          linkId={link.id}
          linkTitle={link.title || link.url}
          linkUrl={link.url}
          initialHtml={link.html_note}
          onClose={() => setShowNote(false)}
          onUpdated={(html) => { onNoteUpdated?.(link.id, html); }}
        />
      )}
      <div role="article" aria-label={itemLabel} className="relative card overflow-hidden group hover:shadow-md transition-shadow">
        {selectOverlay}
        <div className="flex">
          {link.thumbnail && (
            <div className="w-24 h-24 sm:w-32 sm:h-32 shrink-0 bg-gray-100 dark:bg-gray-800">
              <img src={proxyImage(link.thumbnail)} alt="" className="w-full h-full object-cover"
                onError={e => { (e.target as HTMLImageElement).style.display = 'none'; }} />
            </div>
          )}
          <div className="flex-1 p-4 min-w-0">
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0">
                <a href={link.url} target="_blank" rel="noopener noreferrer"
                  className="font-medium text-sm hover:text-indigo-600 flex items-center gap-1.5 group/link">
                  <span className="truncate">{link.title || link.url}</span>
                  <ExternalLink className="w-3 h-3 shrink-0 opacity-0 group-hover/link:opacity-100" />
                </a>
                <p className="text-xs text-gray-400 mt-0.5 truncate">{domain} &middot; {formatLinkDate(link.imported_at)}</p>
              </div>
              {actionButtons}
            </div>
            {link.description && !editing && (
              <p className="text-xs text-gray-500 mt-1.5 line-clamp-2">{link.description}</p>
            )}
            {autoProcessingBanner}
            {extractingIndicator}
            {markdownBadge}
            {summarizingIndicator}
            {summaryDisplay}
            {tagsDisplay}
            {commentDisplay}
            {editSection}
          </div>
        </div>
      </div>
    </>
  );
}
