/*
  Mode hors ligne.
  - Une copie complète du compte (signets, tags, collections) est gardée dans IndexedDB et remise à jour
    au démarrage, après chaque modification et au retour du réseau.
  - Les captures sont gardées dans le cache du navigateur (Cache Storage, « bm-thumbs »), ou remplacées
    par des aperçus générés selon le réglage de l'appareil.
  - Les ajouts faits hors ligne attendent dans une file et partent au retour du réseau.
*/
import { api, ApiError, setMutationHandler, type Bookmark, type Collection, type Tag, type User } from './api';

export interface OfflineCollection extends Collection { itemIds: string[] }
export interface Snapshot {
  syncedAt: number;
  user: User;
  bookmarks: Bookmark[];
  tags: Tag[];
  collections: OfflineCollection[];
}
export interface PendingAdd { id: string; url: string; tags: string[]; note: string; createdAt: number }

export const THUMB_CACHE = 'bm-thumbs';
export const AVG_THUMB_KB = 40; // taille moyenne d'une capture (512 × 384, JPEG)

/* ---------- Stockage clé-valeur (IndexedDB) ---------- */
let dbp: Promise<IDBDatabase> | null = null;
function db(): Promise<IDBDatabase> {
  if (!dbp) {
    dbp = new Promise((resolve, reject) => {
      const req = indexedDB.open('bookmarks-offline', 1);
      req.onupgradeneeded = () => req.result.createObjectStore('kv');
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  }
  return dbp;
}
async function kv<T>(mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest): Promise<T> {
  const d = await db();
  return new Promise((resolve, reject) => {
    const req = fn(d.transaction('kv', mode).objectStore('kv'));
    req.onsuccess = () => resolve(req.result as T);
    req.onerror = () => reject(req.error);
  });
}
const kvGet = <T>(k: string) => kv<T | undefined>('readonly', s => s.get(k)).catch(() => undefined);
const kvSet = (k: string, v: unknown) => kv('readwrite', s => s.put(v, k)).catch(() => undefined);
const kvDel = (k: string) => kv('readwrite', s => s.delete(k)).catch(() => undefined);

/* ---------- Copie du compte ---------- */
let snap: Snapshot | null | undefined;
const listeners = new Set<(s: Snapshot | null) => void>();
export function onSnapshot(fn: (s: Snapshot | null) => void) { listeners.add(fn); return () => { listeners.delete(fn); }; }
const emit = () => listeners.forEach(f => f(snap ?? null));

export async function loadSnapshot(userId?: string): Promise<Snapshot | null> {
  if (snap === undefined) snap = (await kvGet<Snapshot>('snapshot')) ?? null;
  if (snap && userId && snap.user.id !== userId) return null;
  return snap;
}

let syncing: Promise<Snapshot | null> | null = null;
export function syncNow(): Promise<Snapshot | null> {
  if (syncing) return syncing;
  syncing = (async () => {
    try {
      const s = await api.get<Snapshot>('/api/sync');
      snap = s;
      await kvSet('snapshot', s);
      emit();
      if (getThumbMode() === 'captures') downloadThumbs().catch(() => {});
      return s;
    } catch {
      return snap ?? null;
    } finally {
      syncing = null;
    }
  })();
  return syncing;
}

let timer: number | undefined;
export function scheduleSync(delay = 3000) {
  window.clearTimeout(timer);
  timer = window.setTimeout(() => { syncNow(); }, delay);
}
setMutationHandler(() => scheduleSync());

/** Efface tout ce qui est gardé sur l'appareil (à la déconnexion, ou depuis Réglages) */
export async function clearOffline() {
  snap = null;
  await kvDel('snapshot');
  await kvDel('pending');
  if ('caches' in window) await caches.delete(THUMB_CACHE).catch(() => {});
  emit();
}

/* ---------- Requêtes locales ---------- */
export function filterLocal(s: Snapshot, selected: Set<string>, mode: 'and' | 'or'): Bookmark[] {
  const sel = [...selected];
  return s.bookmarks.filter(b => !sel.length || (mode === 'and' ? sel.every(t => b.tags.includes(t)) : sel.some(t => b.tags.includes(t))));
}
export function localCollection(s: Snapshot, id: string) {
  const c = s.collections.find(x => x.id === id);
  if (!c) return null;
  const byId = new Map(s.bookmarks.map(b => [b.id, b]));
  return { collection: c as Collection, items: c.itemIds.map(i => byId.get(i)).filter(Boolean) as Bookmark[] };
}

/* ---------- Captures sur l'appareil ---------- */
export type ThumbMode = 'captures' | 'previews';
export function getThumbMode(): ThumbMode {
  try { return localStorage.getItem('bm_offline_thumbs') === 'previews' ? 'previews' : 'captures'; } catch { return 'captures'; }
}
export function setThumbMode(m: ThumbMode) {
  try { localStorage.setItem('bm_offline_thumbs', m); } catch {}
}

let downloading: Promise<void> | null = null;
export function downloadThumbs(onProgress?: (done: number, total: number) => void): Promise<void> {
  if (downloading) return downloading;
  downloading = (async () => {
    if (!('caches' in window) || !snap) return;
    const cache = await caches.open(THUMB_CACHE);
    const wanted = new Set(snap.bookmarks.map(b => b.thumbUrl).filter(Boolean) as string[]);
    const have = new Set((await cache.keys()).map(r => new URL(r.url).pathname));
    // Retire les captures des signets supprimés
    for (const p of have) if (!wanted.has(p)) await cache.delete(p);
    const todo = [...wanted].filter(u => !have.has(u));
    let done = 0;
    onProgress?.(0, todo.length);
    const worker = async () => {
      while (todo.length) {
        const u = todo.shift()!;
        try {
          const res = await fetch(u, { credentials: 'same-origin' });
          if (res.ok) await cache.put(u, res);
        } catch {
          return; // hors ligne : on reprendra plus tard
        }
        onProgress?.(++done, done + todo.length);
      }
    };
    await Promise.all([worker(), worker(), worker(), worker()]);
  })().finally(() => { downloading = null; });
  return downloading;
}

export async function storageInfo() {
  let count = 0;
  if ('caches' in window) {
    try { count = (await (await caches.open(THUMB_CACHE)).keys()).length; } catch {}
  }
  let usage = 0, quota = 0, persisted = false;
  try {
    const est = await navigator.storage.estimate();
    usage = est.usage || 0;
    quota = est.quota || 0;
    persisted = await navigator.storage.persisted();
  } catch {}
  return { count, usage, quota, persisted };
}
export async function askPersistence() {
  try { return await navigator.storage.persist(); } catch { return false; }
}

/* ---------- Ajouts faits hors ligne ---------- */
export async function getPending(): Promise<PendingAdd[]> { return (await kvGet<PendingAdd[]>('pending')) || []; }
export async function addPending(p: Omit<PendingAdd, 'id' | 'createdAt'>) {
  const list = await getPending();
  const item = { ...p, id: `pending-${Date.now()}`, createdAt: Date.now() };
  await kvSet('pending', [item, ...list]);
  return item;
}
export async function removePending(id: string) { await kvSet('pending', (await getPending()).filter(p => p.id !== id)); }

/** Envoie les ajouts en attente. Renvoie le nombre envoyé. */
export async function flushPending(): Promise<number> {
  const list = await getPending();
  let sent = 0;
  for (const p of [...list].reverse()) {
    try {
      await api.post('/api/bookmarks', { url: p.url, tags: p.tags, note: p.note });
      await removePending(p.id);
      sent++;
    } catch (e) {
      if (e instanceof ApiError && e.code === 'network') break;
      await removePending(p.id); // doublon ou adresse refusée : inutile de réessayer
    }
  }
  return sent;
}

export function pendingAsBookmark(p: PendingAdd): Bookmark {
  let domain = p.url;
  try { domain = new URL(/^https?:\/\//i.test(p.url) ? p.url : `https://${p.url}`).hostname.replace(/^www\./, ''); } catch {}
  return { id: p.id, url: p.url, domain, title: null, note: p.note, faviconUrl: null, thumbUrl: null, thumbRatio: 0.75, status: 'pending', tags: p.tags, createdAt: p.createdAt, updatedAt: p.createdAt };
}
