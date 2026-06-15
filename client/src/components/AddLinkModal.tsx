import { useState, useEffect, useRef } from 'react';
import { X, Loader2, Clipboard, Check, Image, Paperclip } from 'lucide-react';
import VoiceInput, { speechSupported } from './VoiceInput';
import AudioRecorder from './AudioRecorder';
import type { UploadProgress } from '../api/client';
import AddLinkTabs from './AddLinkTabs';
import UploadProgressBar from './UploadProgressBar';
import type { AddLinkModalProps, ContentType } from './addLinkModalTypes';
import { formatSize, isUrl, nowLocal, titleFromUploadName } from './addLinkModalUtils';

export default function AddLinkModal({ open, tags, onClose, onAddLink, onAddText, onAddImage, onAddAudio, onAddFile }: AddLinkModalProps) {
  const [type, setType] = useState<ContentType>('link');
  // Link fields
  const [url, setUrl] = useState('');
  const [clipboardRead, setClipboardRead] = useState(false);
  // Text fields
  const [textTitle, setTextTitle] = useState('');
  const [textContent, setTextContent] = useState('');
  // Image fields
  const [imageFile, setImageFile] = useState<File | null>(null);
  const [imagePreview, setImagePreview] = useState('');
  const [imageTitle, setImageTitle] = useState('');
  // Audio fields
  const [audioBlob, setAudioBlob] = useState<Blob | null>(null);
  const [audioTitle, setAudioTitle] = useState('');
  // File fields
  const [fileData, setFileData] = useState<File | null>(null);
  const [fileTitle, setFileTitle] = useState('');
  // Shared fields
  const [comment, setComment] = useState('');
  const [importedAt, setImportedAt] = useState('');
  const [selectedTags, setSelectedTags] = useState<number[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [uploadProgress, setUploadProgress] = useState<UploadProgress | null>(null);
  const commentRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Auto-read clipboard when modal opens
  useEffect(() => {
    if (!open) return;
    setImportedAt(nowLocal());
    setClipboardRead(false);

    (async () => {
      try {
        const text = await navigator.clipboard.readText();
        if (text && isUrl(text)) {
          setUrl(text.trim());
          setClipboardRead(true);
          setType('link');
          setTimeout(() => commentRef.current?.focus(), 100);
        }
      } catch {
        // Clipboard permission denied or not available
      }
    })();
  }, [open]);

  // Generate image preview
  useEffect(() => {
    if (!imageFile) { setImagePreview(''); return; }
    const url = URL.createObjectURL(imageFile);
    setImagePreview(url);
    return () => URL.revokeObjectURL(url);
  }, [imageFile]);

  if (!open) return null;

  const reset = () => {
    setUrl(''); setComment(''); setImportedAt('');
    setSelectedTags([]); setError(''); setClipboardRead(false);
    setTextTitle(''); setTextContent('');
    setImageFile(null); setImagePreview(''); setImageTitle('');
    setAudioBlob(null); setAudioTitle('');
    setFileData(null); setFileTitle('');
    setUploadProgress(null);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError('');
    setUploadProgress(null);
    try {
      const tagIds = selectedTags.length ? selectedTags : undefined;
      const time = importedAt || undefined;
      const onProgress = (p: UploadProgress) => setUploadProgress(p);

      if (type === 'link') {
        if (!url.trim()) { setError('请输入链接地址'); setLoading(false); return; }
        await onAddLink({
          url: url.trim(),
          comment: comment.trim() || undefined,
          tag_ids: tagIds,
          imported_at: time,
        });
      } else if (type === 'text') {
        if (!textTitle.trim() && !textContent.trim()) { setError('标题或内容不能为空'); setLoading(false); return; }
        await onAddText({
          title: textTitle.trim(),
          content: textContent.trim(),
          comment: comment.trim() || undefined,
          tag_ids: tagIds,
          imported_at: time,
        });
      } else if (type === 'image') {
        if (!imageFile) { setError('请选择图片'); setLoading(false); return; }
        const formData = new FormData();
        formData.append('image', imageFile);
        if (imageTitle.trim()) formData.append('title', imageTitle.trim());
        if (comment.trim()) formData.append('comment', comment.trim());
        if (tagIds) formData.append('tag_ids', JSON.stringify(tagIds));
        if (time) formData.append('imported_at', time);
        await onAddImage(formData, onProgress);
      } else if (type === 'audio') {
        if (!audioBlob) { setError('请先录音'); setLoading(false); return; }
        const formData = new FormData();
        formData.append('audio', audioBlob, 'recording.webm');
        if (audioTitle.trim()) formData.append('title', audioTitle.trim());
        if (comment.trim()) formData.append('comment', comment.trim());
        if (tagIds) formData.append('tag_ids', JSON.stringify(tagIds));
        if (time) formData.append('imported_at', time);
        await onAddAudio(formData, onProgress);
      } else if (type === 'file') {
        if (!fileData) { setError('请选择文件'); setLoading(false); return; }
        const formData = new FormData();
        formData.append('file', fileData);
        if (fileTitle.trim()) formData.append('title', fileTitle.trim());
        if (comment.trim()) formData.append('comment', comment.trim());
        if (tagIds) formData.append('tag_ids', JSON.stringify(tagIds));
        if (time) formData.append('imported_at', time);
        await onAddFile(formData, onProgress);
      }
      reset();
      onClose();
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
      setUploadProgress(null);
    }
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      setImageFile(file);
      // Don't auto-fill title with hash-like filenames from mobile photo library
      const title = titleFromUploadName(file.name);
      if (!imageTitle && title) setImageTitle(title);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/40" onClick={onClose} />
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="add-link-title"
        className="card relative w-full max-w-lg p-6 z-10 max-h-[90vh] overflow-y-auto"
      >
        <div className="flex items-center justify-between mb-4">
          <h2 id="add-link-title" className="text-lg font-semibold">添加收藏</h2>
          <button type="button" onClick={onClose} aria-label="关闭添加收藏弹窗" className="btn-ghost p-1.5"><X className="w-4 h-4" /></button>
        </div>

        <AddLinkTabs type={type} onChange={setType} />

        <form onSubmit={handleSubmit} noValidate className="space-y-4">
          {/* Link input */}
          {type === 'link' && (
            <div>
              <label className="text-sm text-gray-600 dark:text-gray-400 mb-1 flex items-center gap-1.5">
                链接地址 *
                {clipboardRead && (
                  <span className="inline-flex items-center gap-1 text-xs text-green-600">
                    <Clipboard className="w-3 h-3" /> 已从剪贴板读取
                  </span>
                )}
              </label>
              <input className="input" placeholder="https://..." value={url}
                onChange={e => { setUrl(e.target.value); setClipboardRead(false); }} />
            </div>
          )}

          {/* Image input */}
          {type === 'image' && (
            <>
              <div>
                <label className="text-sm text-gray-600 dark:text-gray-400 mb-1 block">选择图片 *</label>
                <input ref={fileInputRef} type="file" accept="image/*" className="hidden"
                  onChange={handleFileChange} />
                {imagePreview ? (
                  <div className="relative">
                    <img src={imagePreview} alt="preview"
                      className="w-full max-h-48 object-contain rounded-lg bg-gray-100 dark:bg-gray-800" />
                    <button type="button"
                      onClick={() => { setImageFile(null); setImagePreview(''); if (fileInputRef.current) fileInputRef.current.value = ''; }}
                      className="absolute top-2 right-2 bg-black/50 text-white rounded-full p-1">
                      <X className="w-3 h-3" />
                    </button>
                  </div>
                ) : (
                  <button type="button" onClick={() => fileInputRef.current?.click()}
                    className="w-full py-8 border-2 border-dashed border-gray-300 dark:border-gray-600 rounded-lg text-gray-400 hover:border-indigo-400 hover:text-indigo-500 transition-colors">
                    <Image className="w-8 h-8 mx-auto mb-2" />
                    <span className="text-sm">点击选择图片</span>
                  </button>
                )}
              </div>
              <div>
                <label className="text-sm text-gray-600 dark:text-gray-400 mb-1 block">标题</label>
                <input className="input" placeholder="图片标题（可选）" value={imageTitle}
                  onChange={e => setImageTitle(e.target.value)} />
              </div>
            </>
          )}

          {/* Text input */}
          {type === 'text' && (
            <>
              <div>
                <label className="text-sm text-gray-600 dark:text-gray-400 mb-1 block">标题</label>
                <input className="input" placeholder="笔记标题" value={textTitle}
                  onChange={e => setTextTitle(e.target.value)} />
              </div>
              <div>
                <label className="text-sm text-gray-600 dark:text-gray-400 mb-1 flex items-center gap-1.5">
                  内容 *
                  {speechSupported && (
                    <VoiceInput onResult={text => setTextContent(prev => prev + text)} />
                  )}
                </label>
                <textarea className="input" rows={5} placeholder="写下你的想法...（支持语音输入）"
                  value={textContent} onChange={e => setTextContent(e.target.value)} />
              </div>
            </>
          )}

          {/* Audio input */}
          {type === 'audio' && (
            <>
              <div>
                <label className="text-sm text-gray-600 dark:text-gray-400 mb-1 block">录音 *</label>
                <AudioRecorder onRecorded={blob => setAudioBlob(blob)} />
              </div>
              <div>
                <label className="text-sm text-gray-600 dark:text-gray-400 mb-1 block">标题</label>
                <input className="input" placeholder="录音标题（可选）" value={audioTitle}
                  onChange={e => setAudioTitle(e.target.value)} />
              </div>
            </>
          )}

          {/* File input */}
          {type === 'file' && (
            <>
              <div>
                <label className="text-sm text-gray-600 dark:text-gray-400 mb-1 block">选择文件 *</label>
                {fileData ? (
                  <div className="flex items-center gap-3 p-3 bg-gray-50 dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-700">
                    <Paperclip className="w-5 h-5 text-gray-400 shrink-0" />
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium truncate">{fileData.name}</p>
                      <p className="text-xs text-gray-400">
                        {formatSize(fileData.size)}
                      </p>
                    </div>
                    <button type="button" onClick={() => setFileData(null)}
                      className="p-1 text-gray-400 hover:text-red-500">
                      <X className="w-4 h-4" />
                    </button>
                  </div>
                ) : (
                  <label className="block w-full py-8 border-2 border-dashed border-gray-300 dark:border-gray-600 rounded-lg text-gray-400 hover:border-indigo-400 hover:text-indigo-500 transition-colors cursor-pointer text-center">
                    <Paperclip className="w-8 h-8 mx-auto mb-2" />
                    <span className="text-sm">点击选择文件（任意格式）</span>
                    <input type="file" className="hidden"
                      onChange={e => {
                        const f = e.target.files?.[0];
                        if (f) { setFileData(f); if (!fileTitle) setFileTitle(f.name); }
                      }} />
                  </label>
                )}
              </div>
              <div>
                <label className="text-sm text-gray-600 dark:text-gray-400 mb-1 block">标题</label>
                <input className="input" placeholder="文件标题（可选）" value={fileTitle}
                  onChange={e => setFileTitle(e.target.value)} />
              </div>
            </>
          )}

          {/* Shared: comment */}
          <div>
            <label className="text-sm text-gray-600 dark:text-gray-400 mb-1 flex items-center gap-1.5">
              我的评论
              {speechSupported && (
                <VoiceInput onResult={text => setComment(prev => prev + text)} />
              )}
            </label>
            <textarea ref={commentRef} className="input" rows={2} placeholder="记录你的想法...（支持语音输入）"
              value={comment} onChange={e => setComment(e.target.value)} />
          </div>

          {/* Shared: tags */}
          <div>
            <label className="text-sm text-gray-600 dark:text-gray-400 mb-1 block">标签</label>
            <div className="flex flex-wrap gap-1.5">
              {tags.map(tag => (
                <button key={tag.id} type="button"
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
              {tags.length === 0 && <p className="text-xs text-gray-400">暂无标签，请先在"标签管理"中创建</p>}
            </div>
          </div>

          {/* Shared: time */}
          <div>
            <label className="text-sm text-gray-600 dark:text-gray-400 mb-1 block">收藏时间</label>
            <div className="flex gap-2">
              <input type="date" className="input flex-1"
                value={importedAt.split('T')[0] || ''}
                onChange={e => {
                  const time = importedAt.split('T')[1] || '00:00';
                  setImportedAt(e.target.value ? `${e.target.value}T${time}` : '');
                }} />
              <input type="time" className="input w-28"
                value={importedAt.split('T')[1] || ''}
                onChange={e => {
                  const date = importedAt.split('T')[0] || new Date().toISOString().slice(0, 10);
                  setImportedAt(e.target.value ? `${date}T${e.target.value}` : importedAt);
                }} />
            </div>
          </div>

          {/* Upload progress bar */}
          {loading && uploadProgress && <UploadProgressBar progress={uploadProgress} />}

          {error && <p className="text-red-500 text-sm">{error}</p>}
          <div className="flex gap-2 pt-2">
            <button type="submit" className="btn-primary flex-1" disabled={loading}>
              {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Check className="w-4 h-4" />}
              {loading && uploadProgress ? `上传中 ${uploadProgress.percent}%` : loading ? (type === 'link' ? '保存中...' : '保存中...') : '保存'}
            </button>
            <button type="button" onClick={onClose} className="btn-secondary" disabled={loading}>取消</button>
          </div>
        </form>
      </div>
    </div>
  );
}
