import { ExternalLink } from 'lucide-react';
import { SITE_COOKIES } from './settingsConfig';

interface Props {
  settings: Record<string, string>;
  onChange: (settings: Record<string, string>) => void;
}

export default function SiteCookiesSettings({ settings, onChange }: Props) {
  return (
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
              onChange({ ...settings, [site.cookieKey]: e.target.value })
            }
          />
          <p className="text-xs text-gray-400">
            如何获取：在浏览器登录 {site.label} 后，打开开发者工具 → Application → Cookies，复制 Cookie 字符串粘贴到此处。
          </p>
        </div>
      ))}
    </div>
  );
}
