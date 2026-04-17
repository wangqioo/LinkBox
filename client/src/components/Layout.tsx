import { ReactNode, useState } from 'react';
import { useAuth } from '../context/AuthContext';
import { Link, useLocation } from 'react-router-dom';
import { Link2, Bookmark, Tags, Settings, LogOut, Moon, Sun, Menu } from 'lucide-react';

export default function Layout({ children }: { children: ReactNode }) {
  const { user, logout } = useAuth();
  const location = useLocation();
  const [dark, setDark] = useState(() => {
    if (typeof window !== 'undefined') {
      return document.documentElement.classList.contains('dark');
    }
    return false;
  });
  const [sidebarOpen, setSidebarOpen] = useState(false);

  const toggleDark = () => {
    document.documentElement.classList.toggle('dark');
    setDark(!dark);
  };

  const navItems = [
    { to: '/', icon: Bookmark, label: '我的链接' },
    { to: '/tags', icon: Tags, label: '标签管理' },
    ...(user?.id === 1 ? [{ to: '/settings', icon: Settings, label: '系统设置' }] : []),
  ];

  const NavContent = () => (
    <>
      <div className="flex items-center gap-3 px-4 py-5 border-b">
        <div className="w-8 h-8 bg-indigo-600 rounded-lg flex items-center justify-center shrink-0">
          <Link2 className="w-4 h-4 text-white" />
        </div>
        <span className="font-bold text-lg">LinkBox</span>
      </div>
      <nav className="flex-1 p-3 space-y-1">
        {navItems.map(item => (
          <Link
            key={item.to}
            to={item.to}
            onClick={() => setSidebarOpen(false)}
            className={`flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-colors ${
              location.pathname === item.to
                ? 'bg-indigo-50 dark:bg-indigo-950 text-indigo-600 dark:text-indigo-400'
                : 'text-gray-600 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-800'
            }`}
          >
            <item.icon className="w-4 h-4" />
            {item.label}
          </Link>
        ))}
      </nav>
      <div className="p-3 border-t space-y-1">
        <button onClick={toggleDark} className="flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm w-full text-gray-600 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-800">
          {dark ? <Sun className="w-4 h-4" /> : <Moon className="w-4 h-4" />}
          {dark ? '浅色模式' : '深色模式'}
        </button>
        <button onClick={logout} className="flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm w-full text-gray-600 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-800">
          <LogOut className="w-4 h-4" />
          退出 ({user?.username})
        </button>
      </div>
    </>
  );

  return (
    <div className="min-h-screen flex">
      {/* Desktop sidebar */}
      <aside className="hidden md:flex w-60 border-r flex-col shrink-0 bg-white dark:bg-gray-900 sticky top-0 h-screen">
        <NavContent />
      </aside>
      {/* Mobile sidebar overlay */}
      {sidebarOpen && (
        <div className="md:hidden fixed inset-0 z-50 flex">
          <div className="absolute inset-0 bg-black/40" onClick={() => setSidebarOpen(false)} />
          <aside className="relative w-60 bg-white dark:bg-gray-900 flex flex-col z-10 shadow-xl">
            <NavContent />
          </aside>
        </div>
      )}
      {/* Main content */}
      <div className="flex-1 flex flex-col min-w-0">
        <header className="md:hidden flex items-center gap-3 px-4 py-3 border-b bg-white dark:bg-gray-900 sticky top-0 z-40">
          <button onClick={() => setSidebarOpen(true)} className="btn-ghost p-1.5">
            <Menu className="w-5 h-5" />
          </button>
          <span className="font-bold">LinkBox</span>
        </header>
        <main className="flex-1 p-4 md:p-6 max-w-6xl w-full mx-auto">
          {children}
        </main>
      </div>
    </div>
  );
}
