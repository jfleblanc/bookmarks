import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import { api, isNetworkError, onReachability, setUnauthenticatedHandler, type User } from './api';
import { clearOffline, flushPending, getPending, loadSnapshot, onSnapshot, syncNow } from './offline';

/* ---------- Session ---------- */

interface AuthValue {
  user: User | null | undefined; // undefined = en chargement
  refresh: () => Promise<User | null>;
  setUser: (u: User | null) => void;
}
const AuthContext = createContext<AuthValue>(null as any);
export const useAuth = () => useContext(AuthContext);

const USER_KEY = 'bm_user';
const rememberUser = (u: User | null) => {
  try { u ? localStorage.setItem(USER_KEY, JSON.stringify(u)) : localStorage.removeItem(USER_KEY); } catch {}
};
const rememberedUser = (): User | null => {
  try { return JSON.parse(localStorage.getItem(USER_KEY) || 'null'); } catch { return null; }
};

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUserState] = useState<User | null | undefined>(undefined);
  const setUser = useCallback((u: User | null) => {
    setUserState(prev => {
      // Déconnexion (ou session expirée) : on efface la copie gardée sur l'appareil
      if (u === null && prev) clearOffline();
      return u;
    });
    rememberUser(u);
  }, []);
  const refresh = useCallback(async () => {
    try {
      const { user } = await api.get<{ user: User | null }>('/api/me');
      setUser(user);
      return user;
    } catch (e) {
      // Hors ligne : on garde le dernier compte connu pour afficher la copie locale
      if (isNetworkError(e)) {
        const u = rememberedUser();
        setUserState(u);
        return u;
      }
      setUser(null);
      return null;
    }
  }, [setUser]);
  useEffect(() => {
    setUnauthenticatedHandler(() => setUser(null));
    refresh();
  }, [refresh, setUser]);
  return <AuthContext.Provider value={{ user, refresh, setUser }}>{children}</AuthContext.Provider>;
}

/* ---------- Hors ligne ---------- */

interface OfflineValue {
  offline: boolean;
  syncedAt: number | null;
  pendingCount: number;
  refreshPending: () => void;
}
const OfflineContext = createContext<OfflineValue>({ offline: false, syncedAt: null, pendingCount: 0, refreshPending: () => {} });
export const useOffline = () => useContext(OfflineContext);

export function OfflineProvider({ children }: { children: ReactNode }) {
  const { user } = useAuth();
  const [browserOnline, setBrowserOnline] = useState(() => navigator.onLine);
  const [reachable, setReachable] = useState(true);
  const [syncedAt, setSyncedAt] = useState<number | null>(null);
  const [pendingCount, setPendingCount] = useState(0);
  const offline = !browserOnline || !reachable;

  const refreshPending = useCallback(() => { getPending().then(p => setPendingCount(p.length)); }, []);

  useEffect(() => {
    const on = () => setBrowserOnline(true), off = () => setBrowserOnline(false);
    addEventListener('online', on); addEventListener('offline', off);
    const un1 = onReachability(setReachable);
    const un2 = onSnapshot(s => setSyncedAt(s?.syncedAt ?? null));
    loadSnapshot().then(s => setSyncedAt(s?.syncedAt ?? null));
    refreshPending();
    return () => { removeEventListener('online', on); removeEventListener('offline', off); un1(); un2(); };
  }, [refreshPending]);

  // Connecté et en ligne : on envoie les ajouts en attente, puis on met la copie à jour (au démarrage, au retour du réseau, toutes les 10 min)
  useEffect(() => {
    if (!user || !browserOnline) return;
    let alive = true;
    const run = async () => { await flushPending(); refreshPending(); if (alive) await syncNow(); };
    run();
    const t = window.setInterval(run, 10 * 60_000);
    return () => { alive = false; window.clearInterval(t); };
  }, [user, browserOnline, refreshPending]);

  return <OfflineContext.Provider value={{ offline, syncedAt, pendingCount, refreshPending }}>{children}</OfflineContext.Provider>;
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
