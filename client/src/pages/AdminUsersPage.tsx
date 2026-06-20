import { useEffect, useMemo, useState } from 'react';
import { api, type AdminUserDetail, type AdminUserSummary } from '../api/client';
import { useAuth } from '../context/AuthContext';
import { AlertCircle, Loader2, RefreshCcw, UserRound } from 'lucide-react';
import { getItemTypeLabel } from '../components/itemDisplay';

const ADMIN_TYPE_KEYS = ['link', 'article', 'video', 'text', 'image', 'audio', 'document'];

function formatDate(value?: string | null) {
  if (!value) return '-';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString('zh-CN', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function typeSummary(stats: Record<string, number>) {
  return ADMIN_TYPE_KEYS
    .map(key => `${getItemTypeLabel(key) || key} ${stats[key] || 0}`)
    .join(' / ');
}

export default function AdminUsersPage() {
  const { user } = useAuth();
  const [users, setUsers] = useState<AdminUserSummary[]>([]);
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [detail, setDetail] = useState<AdminUserDetail | null>(null);
  const [loadingUsers, setLoadingUsers] = useState(true);
  const [loadingDetail, setLoadingDetail] = useState(false);
  const [error, setError] = useState('');

  const isAdmin = user?.id === 1;
  const totals = useMemo(() => ({
    users: users.length,
    items: users.reduce((sum, item) => sum + item.item_count, 0),
    tags: users.reduce((sum, item) => sum + item.tag_count, 0),
  }), [users]);

  const loadUsers = async () => {
    setLoadingUsers(true);
    setError('');
    try {
      const rows = await api.getAdminUsers();
      setUsers(rows);
      setSelectedId((current) => current || rows[0]?.id || null);
    } catch (e: any) {
      setError(e.message || '加载用户失败');
    } finally {
      setLoadingUsers(false);
    }
  };

  useEffect(() => {
    if (isAdmin) loadUsers();
  }, [isAdmin]);

  useEffect(() => {
    if (!isAdmin || !selectedId) {
      setDetail(null);
      return;
    }
    setLoadingDetail(true);
    setError('');
    api.getAdminUser(selectedId)
      .then(setDetail)
      .catch((e: any) => setError(e.message || '加载用户详情失败'))
      .finally(() => setLoadingDetail(false));
  }, [isAdmin, selectedId]);

  if (!isAdmin) {
    return (
      <div className="text-center py-20 text-gray-500">
        仅管理员可访问用户管理页面
      </div>
    );
  }

  return (
    <div className="space-y-5">
      <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
        <div>
          <h1 className="text-xl font-bold">用户管理</h1>
          <p className="text-sm text-gray-500 mt-1">查看所有用户的信息和使用情况</p>
        </div>
        <button type="button" onClick={loadUsers} className="btn-secondary self-start" disabled={loadingUsers}>
          <RefreshCcw className={`w-4 h-4 ${loadingUsers ? 'animate-spin' : ''}`} />
          刷新
        </button>
      </div>

      {error && (
        <div className="flex items-center gap-2 rounded-lg bg-red-50 px-4 py-2 text-sm text-red-600 dark:bg-red-900/20">
          <AlertCircle className="w-4 h-4" />
          {error}
        </div>
      )}

      <div className="grid gap-3 md:grid-cols-3">
        <div className="card p-4">
          <p className="text-sm text-gray-500">用户数</p>
          <p className="mt-1 text-2xl font-semibold">{totals.users}</p>
        </div>
        <div className="card p-4">
          <p className="text-sm text-gray-500">总记录</p>
          <p className="mt-1 text-2xl font-semibold">{totals.items}</p>
        </div>
        <div className="card p-4">
          <p className="text-sm text-gray-500">总标签</p>
          <p className="mt-1 text-2xl font-semibold">{totals.tags}</p>
        </div>
      </div>

      <div className="grid gap-5 lg:grid-cols-[minmax(0,1.35fr)_minmax(320px,0.85fr)]">
        <div className="card overflow-hidden">
          <div className="border-b px-4 py-3 font-semibold">用户列表</div>
          {loadingUsers ? (
            <div className="flex items-center justify-center gap-2 py-12 text-gray-500">
              <Loader2 className="w-4 h-4 animate-spin" />
              加载中
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-gray-50 text-left text-xs text-gray-500 dark:bg-gray-800">
                  <tr>
                    <th className="px-4 py-3 font-medium">用户</th>
                    <th className="px-4 py-3 font-medium">记录</th>
                    <th className="px-4 py-3 font-medium">类型分布</th>
                    <th className="px-4 py-3 font-medium">最近使用</th>
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {users.map((item) => (
                    <tr
                      key={item.id}
                      className={`cursor-pointer hover:bg-gray-50 dark:hover:bg-gray-800 ${
                        selectedId === item.id ? 'bg-indigo-50/70 dark:bg-indigo-950/30' : ''
                      }`}
                      onClick={() => setSelectedId(item.id)}
                    >
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-2 font-medium">
                          <UserRound className="w-4 h-4 text-gray-400" />
                          {item.username}
                          {item.id === 1 && <span className="rounded bg-indigo-100 px-1.5 py-0.5 text-xs text-indigo-700 dark:bg-indigo-950 dark:text-indigo-300">管理员</span>}
                        </div>
                        <div className="mt-1 text-xs text-gray-400">ID {item.id} · 注册 {formatDate(item.created_at)}</div>
                      </td>
                      <td className="px-4 py-3">
                        <div>{item.item_count} 条</div>
                        <div className="mt-1 text-xs text-gray-400">标签 {item.tag_count} · 处理中 {item.processing_count} · 错误 {item.error_count}</div>
                      </td>
                      <td className="px-4 py-3 text-gray-600 dark:text-gray-300">{typeSummary(item.by_type)}</td>
                      <td className="px-4 py-3 whitespace-nowrap text-gray-600 dark:text-gray-300">{formatDate(item.last_used_at)}</td>
                    </tr>
                  ))}
                  {!users.length && (
                    <tr>
                      <td colSpan={4} className="px-4 py-10 text-center text-gray-500">暂无用户</td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          )}
        </div>

        <aside className="card overflow-hidden">
          <div className="border-b px-4 py-3 font-semibold">用户详情</div>
          {loadingDetail ? (
            <div className="flex items-center justify-center gap-2 py-12 text-gray-500">
              <Loader2 className="w-4 h-4 animate-spin" />
              加载中
            </div>
          ) : detail ? (
            <div className="space-y-4 p-4">
              <div>
                <div className="text-lg font-semibold">{detail.user.username}</div>
                <div className="text-xs text-gray-400">ID {detail.user.id} · 注册 {formatDate(detail.user.created_at)}</div>
              </div>
              <div className="grid grid-cols-2 gap-3 text-sm">
                <div className="rounded-lg border p-3">
                  <div className="text-gray-500">记录</div>
                  <div className="mt-1 text-xl font-semibold">{detail.stats.item_count}</div>
                </div>
                <div className="rounded-lg border p-3">
                  <div className="text-gray-500">标签</div>
                  <div className="mt-1 text-xl font-semibold">{detail.stats.tag_count}</div>
                </div>
              </div>
              <div>
                <h2 className="text-sm font-semibold">类型分布</h2>
                <div className="mt-2 grid grid-cols-2 gap-2 text-sm">
                  {ADMIN_TYPE_KEYS.map(key => (
                    <div key={key} className="flex justify-between rounded-lg bg-gray-50 px-3 py-2 dark:bg-gray-800">
                      <span className="text-gray-500">{getItemTypeLabel(key) || key}</span>
                      <span className="font-medium">{detail.stats.by_type[key] || 0}</span>
                    </div>
                  ))}
                </div>
              </div>
              <div>
                <h2 className="text-sm font-semibold">最近记录</h2>
                <div className="mt-2 max-h-[420px] space-y-2 overflow-y-auto pr-1">
                  {detail.recent_items.map((item) => (
                    <div key={item.id} className="rounded-lg border p-3 text-sm">
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0 font-medium truncate">{item.title || item.url || `记录 ${item.id}`}</div>
                        <span className="shrink-0 rounded bg-gray-100 px-1.5 py-0.5 text-xs text-gray-600 dark:bg-gray-800 dark:text-gray-300">
                          {getItemTypeLabel(item.type) || item.type || '链接'}
                        </span>
                      </div>
                      <div className="mt-1 text-xs text-gray-400">{formatDate(item.imported_at || item.created_at)}</div>
                    </div>
                  ))}
                  {!detail.recent_items.length && (
                    <div className="rounded-lg border px-3 py-8 text-center text-sm text-gray-500">暂无记录</div>
                  )}
                </div>
              </div>
            </div>
          ) : (
            <div className="py-12 text-center text-sm text-gray-500">请选择用户</div>
          )}
        </aside>
      </div>
    </div>
  );
}
