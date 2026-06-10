import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { AlertCircle, CheckCircle2, Info, X } from 'lucide-react';

type ToastType = 'success' | 'error' | 'info';

interface ToastInput {
  type?: ToastType;
  title: string;
  message?: string;
  durationMs?: number;
}

interface Toast extends Required<Omit<ToastInput, 'message'>> {
  id: number;
  message?: string;
}

interface ToastContextValue {
  showToast: (toast: ToastInput) => number;
  dismissToast: (id: number) => void;
  success: (title: string, message?: string) => number;
  error: (title: string, message?: string) => number;
  info: (title: string, message?: string) => number;
}

const ToastContext = createContext<ToastContextValue | null>(null);

export function useToast() {
  const context = useContext(ToastContext);
  if (!context) throw new Error('useToast must be used within ToastProvider');
  return context;
}

const toastStyle = {
  success: {
    icon: CheckCircle2,
    tone: 'border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-900 dark:bg-emerald-950 dark:text-emerald-200',
    iconTone: 'text-emerald-500 dark:text-emerald-300',
  },
  error: {
    icon: AlertCircle,
    tone: 'border-red-200 bg-red-50 text-red-700 dark:border-red-900 dark:bg-red-950 dark:text-red-200',
    iconTone: 'text-red-500 dark:text-red-300',
  },
  info: {
    icon: Info,
    tone: 'border-blue-200 bg-blue-50 text-blue-700 dark:border-blue-900 dark:bg-blue-950 dark:text-blue-200',
    iconTone: 'text-blue-500 dark:text-blue-300',
  },
};

function ToastItem({ toast, onClose }: { toast: Toast; onClose: () => void }) {
  const style = toastStyle[toast.type];
  const Icon = style.icon;

  return (
    <div
      role="status"
      className={`pointer-events-auto flex w-full items-start gap-3 rounded-lg border px-3 py-3 shadow-lg shadow-gray-900/10 backdrop-blur ${style.tone}`}
    >
      <Icon className={`mt-0.5 h-4 w-4 shrink-0 ${style.iconTone}`} />
      <div className="min-w-0 flex-1">
        <p className="text-sm font-medium leading-5">{toast.title}</p>
        {toast.message && (
          <p className="mt-0.5 text-xs leading-5 opacity-85">{toast.message}</p>
        )}
      </div>
      <button
        type="button"
        onClick={onClose}
        className="rounded-md p-1 opacity-60 transition-opacity hover:opacity-100"
        aria-label="关闭通知"
      >
        <X className="h-3.5 w-3.5" />
      </button>
    </div>
  );
}

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const nextId = useRef(1);
  const timers = useRef<Map<number, number>>(new Map());

  const dismissToast = useCallback((id: number) => {
    const timer = timers.current.get(id);
    if (timer) window.clearTimeout(timer);
    timers.current.delete(id);
    setToasts(current => current.filter(toast => toast.id !== id));
  }, []);

  const showToast = useCallback((input: ToastInput) => {
    const id = nextId.current++;
    const toast: Toast = {
      id,
      type: input.type || 'info',
      title: input.title,
      message: input.message,
      durationMs: input.durationMs ?? 3600,
    };

    setToasts(current => [toast, ...current].slice(0, 4));

    if (toast.durationMs > 0) {
      const timer = window.setTimeout(() => dismissToast(id), toast.durationMs);
      timers.current.set(id, timer);
    }

    return id;
  }, [dismissToast]);

  useEffect(() => () => {
    timers.current.forEach(timer => window.clearTimeout(timer));
    timers.current.clear();
  }, []);

  const value = useMemo<ToastContextValue>(() => ({
    showToast,
    dismissToast,
    success: (title, message) => showToast({ type: 'success', title, message }),
    error: (title, message) => showToast({ type: 'error', title, message, durationMs: 5200 }),
    info: (title, message) => showToast({ type: 'info', title, message }),
  }), [dismissToast, showToast]);

  return (
    <ToastContext.Provider value={value}>
      {children}
      <div className="pointer-events-none fixed right-4 top-4 z-[80] flex w-[min(24rem,calc(100vw-2rem))] flex-col gap-2">
        {toasts.map(toast => (
          <ToastItem
            key={toast.id}
            toast={toast}
            onClose={() => dismissToast(toast.id)}
          />
        ))}
      </div>
    </ToastContext.Provider>
  );
}
