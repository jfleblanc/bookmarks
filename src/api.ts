/* Client de l'API et types partagés par l'interface */

export interface User {
  id: string;
  email: string;
  role: 'admin' | 'member';
  prefs: { bw?: boolean; hoverColor?: boolean };
}

export interface Bookmark {
  id: string;
  url: string;
  domain: string;
  title: string | null;
  note?: string;
  faviconUrl: string | null;
  thumbUrl: string | null;
  thumbRatio: number;
  status?: 'processing' | 'ready' | 'error' | 'pending';
  error?: string | null;
  tags: string[];
  createdAt: number;
  updatedAt: number;
}

export interface BookmarkLite {
  id: string;
  title: string | null;
  domain: string;
  tags: string[];
}

export interface Collection {
  id: string;
  title: string;
  description: string;
  shared: boolean;
  shareUrl: string;
  count: number;
  covers: string[];
  createdAt: number;
  updatedAt: number;
}

export interface Tag {
  name: string;
  count: number;
}

export class ApiError extends Error {
  constructor(public status: number, public code: string, message: string, public data: any) {
    super(message);
  }
}

let onUnauthenticated: (() => void) | null = null;
export function setUnauthenticatedHandler(fn: () => void) {
  onUnauthenticated = fn;
}

/* État du réseau vu par l'API : faux dès qu'une requête n'aboutit pas, vrai dès qu'une réussit */
type NetListener = (reachable: boolean) => void;
const netListeners = new Set<NetListener>();
let reachable = true;
export function onReachability(fn: NetListener) { netListeners.add(fn); return () => { netListeners.delete(fn); }; }
function setReachable(v: boolean) { if (v !== reachable) { reachable = v; netListeners.forEach(f => f(v)); } }

/* Après chaque modification réussie, la copie hors ligne est remise à jour (voir offline.ts) */
let onMutation: (() => void) | null = null;
export function setMutationHandler(fn: () => void) { onMutation = fn; }

async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
  let res: Response;
  try {
    res = await fetch(path, {
      method,
      credentials: 'same-origin',
      headers: body !== undefined ? { 'content-type': 'application/json' } : undefined,
      body: body !== undefined ? JSON.stringify(body) : undefined
    });
  } catch {
    setReachable(false);
    throw new ApiError(0, 'network', 'Vous êtes hors ligne. Réessayez une fois connecté.', null);
  }
  setReachable(true);
  const data = (res.headers.get('content-type') || '').includes('json') ? await res.json() : null;
  if (!res.ok) {
    if (res.status === 401 && onUnauthenticated) onUnauthenticated();
    throw new ApiError(res.status, data?.error || 'error', data?.message || 'Une erreur est survenue.', data);
  }
  if (method !== 'GET' && !path.startsWith('/api/auth') && onMutation) onMutation();
  return data as T;
}

export const api = {
  get: <T>(p: string) => request<T>('GET', p),
  post: <T>(p: string, b: unknown = {}) => request<T>('POST', p, b),
  patch: <T>(p: string, b: unknown) => request<T>('PATCH', p, b),
  del: <T>(p: string) => request<T>('DELETE', p)
};

/* ---------- Petits utilitaires d'affichage ---------- */

export const isNetworkError = (e: unknown) => e instanceof ApiError && e.code === 'network';

export const plural = (n: number, one: string, many: string) => `${n} ${n > 1 ? many : one}`;

const pad = (n: number) => String(n).padStart(2, '0');
export function shortDate(ts: number): string {
  const d = new Date(ts);
  const today = new Date();
  const start = (x: Date) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
  const days = Math.round((start(today) - start(d)) / 86_400_000);
  if (days <= 0) return 'auj.';
  if (days === 1) return 'hier';
  return `${pad(d.getDate())}.${pad(d.getMonth() + 1)}${d.getFullYear() !== today.getFullYear() ? '.' + String(d.getFullYear()).slice(2) : ''}`;
}
export function fullDate(ts: number): string {
  const d = new Date(ts);
  return `${pad(d.getDate())}.${pad(d.getMonth() + 1)}.${String(d.getFullYear()).slice(2)}`;
}

export const normTag = (t: string) => t.trim().toLowerCase().replace(/^#+/, '').replace(/\s+/g, ' ').slice(0, 30);
export const fold = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

/** Copie dans le presse-papiers ; à défaut, sélectionne le champ pour une copie manuelle */
export async function copyText(text: string, input?: HTMLInputElement | null): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    if (input) { input.focus(); input.select(); }
    return false;
  }
}
