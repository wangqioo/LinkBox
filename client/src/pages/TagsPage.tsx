import { useState, useEffect } from 'react';
import { api } from '../api/client';
import { Plus, Pencil, Trash2, Check, X, Tags } from 'lucide-react';
import { useToast } from '../context/ToastContext';

interface Tag { id: number; name: string; color: string; link_count: number; created_at: string; }

const COLORS = [
  '#6366f1', '#8b5cf6', '#a855f7', '#ec4899', '#f43f5e',
  '#ef4444', '#f97316', '#f59e0b', '#eab308', '#84cc16',
  '#22c55e', '#10b981', '#14b8a6', '#06b6d4', '#0ea5e9',
  '#3b82f6', '#2563eb', '#4f46e5', '#7c3aed', '#9333ea',
  '#c026d3', '#db2777', '#e11d48', '#dc2626', '#ea580c',
  '#d97706', '#ca8a04', '#65a30d', '#16a34a', '#059669',
  '#0d9488', '#0891b2', '#0284c7', '#1d4ed8', '#4338ca',
  '#6b7280', '#78716c',
];

export default function TagsPage() {
  const toast = useToast();
  const [tags, setTags] = useState<Tag[]>([]);
  const [newName, setNewName] = useState('');
  const [newColor, setNewColor] = useState(COLORS[0]);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [editName, setEditName] = useState('');
  const [editColor, setEditColor] = useState('');
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [savingId, setSavingId] = useState<number | null>(null);
  const [deletingId, setDeletingId] = useState<number | null>(null);

  const fetchTags = async () => {
    setLoading(true);
    try {
      setTags(await api.getTags());
    } catch (e) {
      toast.error('标签加载失败', e instanceof Error ? e.message : '请稍后重试');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { fetchTags(); }, []);

  const handleAdd = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newName.trim() || creating) return;
    setCreating(true);
    try {
      await api.addTag(newName.trim(), newColor);
      toast.success('标签已创建', newName.trim());
      setNewName('');
      setNewColor(COLORS[Math.floor(Math.random() * COLORS.length)]);
      await fetchTags();
    } catch (e) {
      toast.error('创建标签失败', e instanceof Error ? e.message : '请稍后重试');
    } finally {
      setCreating(false);
    }
  };

  const startEdit = (tag: Tag) => {
    setEditingId(tag.id);
    setEditName(tag.name);
    setEditColor(tag.color);
  };

  const saveEdit = async () => {
    if (!editingId || !editName.trim() || savingId) return;
    setSavingId(editingId);
    try {
      await api.updateTag(editingId, { name: editName.trim(), color: editColor });
      toast.success('标签已更新', editName.trim());
      setEditingId(null);
      await fetchTags();
    } catch (e) {
      toast.error('更新标签失败', e instanceof Error ? e.message : '请稍后重试');
    } finally {
      setSavingId(null);
    }
  };

  const handleDelete = async (id: number) => {
    if (!confirm('删除标签后，相关链接的标签会被移除。确定？')) return;
    setDeletingId(id);
    try {
      await api.deleteTag(id);
      toast.success('标签已删除');
      await fetchTags();
    } catch (e) {
      toast.error('删除标签失败', e instanceof Error ? e.message : '请稍后重试');
    } finally {
      setDeletingId(null);
    }
  };

  return (
    <div>
      <div className="mb-6">
        <h1 className="text-xl font-bold">标签管理</h1>
        <p className="text-sm text-gray-500">{tags.length} 个标签</p>
      </div>

      {/* Add new tag */}
      <form onSubmit={handleAdd} className="card p-4 mb-6">
        <label className="text-sm font-medium mb-3 block">创建新标签</label>
        <div className="grid grid-cols-[repeat(auto-fill,1.5rem)] gap-1.5 mb-3">
          {COLORS.map(c => (
            <button key={c} type="button" onClick={() => setNewColor(c)}
              className={`w-6 h-6 rounded-full transition-transform ${newColor === c ? 'scale-125 ring-2 ring-offset-2 ring-gray-300 dark:ring-offset-gray-900' : ''}`}
              style={{ backgroundColor: c }} />
          ))}
        </div>
        <div className="flex gap-2">
          <input className="input flex-1" placeholder="标签名称" value={newName} onChange={e => setNewName(e.target.value)} />
          <button type="submit" disabled={creating || !newName.trim()} className="btn-primary shrink-0">
            <Plus className="w-4 h-4" /> {creating ? '创建中…' : '创建'}
          </button>
        </div>
      </form>

      {/* Tags list */}
      {loading ? (
        <div className="text-center py-10 text-gray-400">加载中...</div>
      ) : tags.length === 0 ? (
        <div className="text-center py-16 text-gray-400">
          <Tags className="w-10 h-10 mx-auto mb-3 opacity-50" />
          <p>还没有标签，在上方创建一个吧</p>
        </div>
      ) : (
        <div className="space-y-2">
          {tags.map(tag => (
            <div key={tag.id} className="card p-4 flex items-center gap-3">
              {editingId === tag.id ? (
                <>
                  <div className="w-full space-y-2">
                    <div className="grid grid-cols-[repeat(auto-fill,1.25rem)] gap-1">
                      {COLORS.map(c => (
                        <button key={c} type="button" onClick={() => setEditColor(c)}
                          className={`w-5 h-5 rounded-full transition-transform ${editColor === c ? 'scale-125 ring-2 ring-offset-1 ring-gray-300 dark:ring-offset-gray-900' : ''}`}
                          style={{ backgroundColor: c }} />
                      ))}
                    </div>
                    <input className="input" value={editName} onChange={e => setEditName(e.target.value)}
                      onKeyDown={e => e.key === 'Enter' && saveEdit()} autoFocus />
                  </div>
                  <button onClick={saveEdit} disabled={savingId === tag.id} className="btn-ghost p-1.5 text-green-600">
                    <Check className="w-4 h-4" />
                  </button>
                  <button onClick={() => setEditingId(null)} disabled={savingId === tag.id} className="btn-ghost p-1.5">
                    <X className="w-4 h-4" />
                  </button>
                </>
              ) : (
                <>
                  <span className="w-4 h-4 rounded-full shrink-0" style={{ backgroundColor: tag.color }} />
                  <span className="font-medium text-sm flex-1">{tag.name}</span>
                  <span className="text-xs text-gray-400">{tag.link_count} 条链接</span>
                  <button onClick={() => startEdit(tag)} disabled={deletingId === tag.id} className="btn-ghost p-1.5">
                    <Pencil className="w-3.5 h-3.5" />
                  </button>
                  <button onClick={() => handleDelete(tag.id)} disabled={deletingId === tag.id} className="btn-ghost p-1.5 text-red-500">
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
