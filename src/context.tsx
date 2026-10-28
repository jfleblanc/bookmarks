import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import { api, setUnauthenticatedHandler, type User } from './api';

/* ---------- Session ---------- */

interface AuthValue {
  user: User | null | undefined; // undefined = en chargement
  refresh: () => Promise<User | null>;
  setUser: (u: User | null) => void;
}
const AuthContext = createContext<AuthValue>(null as any);
export const useAuth = () => useContext(AuthContext);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null | undefined>(undefined);
  const refresh = useCallback(async () => {
    try {
      const { user } = await api.get<{ user: User | null }>('/api/me');
      setUser(user);
      return user;
    } catch {
      setUser(null);
      return null;
    }
  }, []);
  useEffect(() => {
    setUnauthenticatedHandler(() => setUser(null));
    refresh();
  }, [refresh]);
  return <AuthContext.Provider value={{ user, refresh, setUser }}>{children}</AuthContext.Provider>;
}

/* ---------- Messages éphémères (toasts) ---------- */

interface ToastState {
  id: number;
  message: string;
  action?: { label: string; run: () => void };
}
type ShowToast = (message: string, action?: { label: string; run: () => void }) => void;
const ToastContext = createContext<ShowToast>(() => {});
export const useToast = () => useContext(ToastContext);

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toast, setToast] = useState<ToastState | null>(null);
  const timer = useRef<number>();
  const show = useCallback<ShowToast>((message, action) => {
    window.clearTimeout(timer.current);
    const t = { id: Date.now(), message, action };
    setToast(t);
    timer.current = window.setTimeout(() => setToast(cur => (cur?.id === t.id ? null : cur)), action ? 6000 : 2800);
  }, []);
  return (
    <ToastContext.Provider value={show}>
      {children}
      {toast && (
        <div className="toast" role="status" aria-live="polite">
          <span>{toast.message}</span>
          {toast.action && (
            <button type="button" onClick={() => { setToast(null); toast.action!.run(); }}>
              {toast.action.label}
            </button>
          )}
        </div>
      )}
    </ToastContext.Provider>
  );
}
