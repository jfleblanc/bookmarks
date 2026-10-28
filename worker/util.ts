/* Petits utilitaires partagés par l'API */

export class HttpError extends Error {
  constructor(public status: number, public code: string, message?: string, public extra?: Record<string, unknown>) {
    super(message || code);
  }
}

export function json(data: unknown, status = 200, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', ...headers }
  });
}

export function errorResponse(e: unknown): Response {
  if (e instanceof HttpError) return json({ error: e.code, message: e.message, ...(e.extra || {}) }, e.status);
  console.error(e);
  return json({ error: 'server_error', message: 'Une erreur inattendue est survenue.' }, 500);
}

export const now = () => Date.now();
export const DAY = 86_400_000;

export function newId(): string {
  return crypto.randomUUID();
}

/** Jeton aléatoire sûr, encodé en base64url (32 octets par défaut) */
export function randomToken(bytes = 32): string {
  const b = new Uint8Array(bytes);
  crypto.getRandomValues(b);
  return btoa(String.fromCharCode(...b)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/** Code court et lisible pour les liens de partage (sans 0/O/1/l/i) */
export function shareCode(len = 10): string {
  const alphabet = 'abcdefghjkmnpqrstuvwxyz23456789';
  const v = new Uint32Array(len);
  crypto.getRandomValues(v);
  return Array.from(v, x => alphabet[x % alphabet.length]).join('');
}

export async function sha256(text: string): Promise<string> {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return Array.from(new Uint8Array(buf), b => b.toString(16).padStart(2, '0')).join('');
}

export async function readJson<T = any>(req: Request): Promise<T> {
  const type = req.headers.get('content-type') || '';
  if (!type.includes('application/json')) throw new HttpError(415, 'json_required', 'Le contenu doit être en JSON.');
  try {
    return (await req.json()) as T;
  } catch {
    throw new HttpError(400, 'bad_json', 'Le JSON envoyé est invalide.');
  }
}

export function normalizeEmail(v: unknown): string {
  const s = String(v ?? '').trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(s) || s.length > 254) throw new HttpError(400, 'bad_email', 'Adresse courriel invalide.');
  return s;
}

export function cleanText(v: unknown, max: number): string {
  return String(v ?? '').replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '').trim().slice(0, max);
}

/* ---------- URL ---------- */

export function parseUrl(raw: unknown): URL {
  let s = String(raw ?? '').trim();
  if (!s) throw new HttpError(400, 'bad_url', 'Collez d’abord l’adresse d’un site.');
  if (!/^[a-z][a-z0-9+.-]*:\/\//i.test(s)) s = 'https://' + s;
  let u: URL;
  try {
    u = new URL(s);
  } catch {
    throw new HttpError(400, 'bad_url', 'Cette adresse n’est pas valide.');
  }
  if (!/^https?:$/.test(u.protocol) || !u.hostname.includes('.') || s.length > 2000) {
    throw new HttpError(400, 'bad_url', 'Cette adresse n’est pas valide.');
  }
  u.hash = '';
  return u;
}

/** Forme normalisée qui sert à détecter les doublons */
export function normalizeUrl(u: URL): string {
  const host = u.hostname.toLowerCase().replace(/^www\./, '');
  const params = [...u.searchParams]
    .filter(([k]) => !/^(utm_|fbclid|gclid|mc_|ref$)/i.test(k))
    .sort(([a], [b]) => a.localeCompare(b));
  const q = params.length ? '?' + new URLSearchParams(params).toString() : '';
  const port = u.port && !['80', '443'].includes(u.port) ? ':' + u.port : '';
  return host + port + u.pathname.replace(/\/+$/, '') + q;
}

export const domainOf = (u: URL) => u.hostname.toLowerCase().replace(/^www\./, '');

/** Refuse les adresses internes (protection contre les requêtes vers le réseau privé) */
export function isPublicHost(hostname: string): boolean {
  const h = hostname.toLowerCase().replace(/^\[|\]$/g, '');
  if (h === 'localhost' || h.endsWith('.localhost') || h.endsWith('.local') || h.endsWith('.internal')) return false;
  if (/^\d+\.\d+\.\d+\.\d+$/.test(h)) {
    const [a, b] = h.split('.').map(Number);
    if (a === 10 || a === 127 || a === 0 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 100 && b >= 64 && b <= 127)) return false;
  }
  if (h.includes(':')) {
    if (h === '::1' || h.startsWith('fc') || h.startsWith('fd') || h.startsWith('fe80') || h === '::') return false;
  }
  return true;
}

export function normalizeTags(v: unknown): string[] {
  const arr = Array.isArray(v) ? v : [];
  const out: string[] = [];
  for (const t of arr) {
    const s = String(t ?? '').trim().toLowerCase().replace(/^#+/, '').replace(/\s+/g, ' ').slice(0, 30);
    if (s && !out.includes(s)) out.push(s);
    if (out.length >= 20) break;
  }
  return out;
}

/* ---------- Témoins (cookies) ---------- */

export function getCookie(req: Request, name: string): string | null {
  const raw = req.headers.get('cookie') || '';
  for (const part of raw.split(';')) {
    const [k, ...v] = part.trim().split('=');
    if (k === name) return decodeURIComponent(v.join('='));
  }
  return null;
}

export function cookie(name: string, value: string, maxAgeSeconds: number, secure: boolean): string {
  return `${name}=${encodeURIComponent(value)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAgeSeconds}${secure ? '; Secure' : ''}`;
}

export function placeholders(n: number): string {
  return Array(n).fill('?').join(',');
}
