import { useState, useEffect } from 'react';
import { api } from '../api/client';
import { useAuth } from '../context/AuthContext';
import { Save, ExternalLink } from 'lucide-react';

interface SiteCookieEntry {
  domain: string;
  label: string;
  hint: string;
  helpUrl: string;
  cookieKey: string;
}

const SITE_COOKIES: SiteCookieEntry[] = [
  {
    domain: 'zhihu.com',
    label: '知乎',
    hint: '填入 z_c0 Cookie 值（格式：z_c0=2|xxx...）',
    helpUrl: 'https://www.zhihu.com',
    cookieKey: 'cookie:zhihu.com',
  },
];

export default function SettingsPage() {
  const { user } = useAuth();
  const [settings, setSettings] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState('');

  const isAdmin = user?.id === 1;

  useEffect(() => {
    if (!isAdmin) return;
    api.getSettings().then(setSettings).catch(() => {});
  }, [isAdmin]);

  const handleSave = async () => {
    setSaving(true);
    setError('');
    try {
      await api.updateSettings(settings);
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    } catch (e: any) {
      setError(e.message || '保存失败');
    } finally {
      setSaving(false);
    }
  };

  if (!isAdmin) {
    return (
      <div className="text-center py-20 text-gray-500">
        仅管理员可访问设置页面
      </div>
    );
  }

  return (
    <div className="max-w-2xl space-y-6">
      <div>
        <h1 className="text-xl font-bold">系统设置</h1>
        <p className="text-sm text-gray-500 mt-1">管理员专用配置</p>
      </div>

      {/* Site Cookies */}
      <div className="rounded-xl border p-5 space-y-4">
        <div>
          <h2 className="font-semibold">站点 Cookie 配置</h2>
          <p className="text-sm text-gray-500 mt-0.5">
            部分网站（如知乎）需要登录后才能提取内容。在此填入对应网站的 Cookie，LinkBox 将使用它来抓取内容。
          </p>
        </div>

        {SITE_COOKIES.map((site) => (
          <div key={site.domain} className="space-y-1.5">
            <div className="flex items-center gap-2">
              <label className="text-sm font-medium">{site.label}</label>
              <a
                href={site.helpUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="text-xs text-indigo-500 flex items-center gap-0.5 hover:underline"
              >
                <ExternalLink className="w-3 h-3" />
                打开网站
              </a>
            </div>
            <textarea
              rows={3}
              className="w-full text-xs font-mono rounded-lg border px-3 py-2 bg-gray-50 dark:bg-gray-800 focus:outline-none focus:ring-2 focus:ring-indigo-500 resize-none"
              placeholder={site.hint}
              value={settings[site.cookieKey] || ''}
              onChange={(e) =>
                setSettings((prev) => ({ ...prev, [site.cookieKey]: e.target.value }))
              }
            />
            <p className="text-xs text-gray-400">
              如何获取：在浏览器登录 {site.label} 后，打开开发者工具 → Application → Cookies，复制 Cookie 字符串粘贴到此处。
            </p>
          </div>
        ))}
      </div>

      {error && (
        <div className="text-sm text-red-600 bg-red-50 dark:bg-red-900/20 rounded-lg px-4 py-2">
          {error}
        </div>
      )}

      <button
        onClick={handleSave}
        disabled={saving}
        className="btn-primary flex items-center gap-2"
      >
        <Save className="w-4 h-4" />
        {saving ? '保存中…' : saved ? '已保存 ✓' : '保存设置'}
      </button>
    </div>
  );
}
