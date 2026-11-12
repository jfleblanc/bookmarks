// Interface bilingue : le texte français sert de clé, l'anglais vient du dictionnaire (src/locales/en.ts).
// Langue : choix du compte, sinon celui de l'appareil, sinon la langue du navigateur.
import { EN } from './locales/en';

export type Lang = 'fr' | 'en';
const KEY = 'bm_lang';

export function browserLang(): Lang {
  const langs = (typeof navigator !== 'undefined' && (navigator.languages?.length ? navigator.languages : [navigator.language])) || [];
  for (const l of langs) {
    const base = (l || '').slice(0, 2).toLowerCase();
    if (base === 'fr') return 'fr';
    if (base === 'en') return 'en';
  }
  return 'en';
}

function stored(): Lang | null {
  try { const v = localStorage.getItem(KEY); return v === 'fr' || v === 'en' ? v : null; } catch { return null; }
}

let current: Lang = stored() || browserLang();
const listeners = new Set<(l: Lang) => void>();
applyDocument();

export const getLang = () => current;
export const locale = () => (current === 'fr' ? 'fr-CA' : 'en-CA');

/** Change la langue de l'interface (et la retient sur cet appareil) */
export function setLang(l: Lang) {
  try { localStorage.setItem(KEY, l); } catch {}
  if (l === current) return;
  current = l;
  applyDocument();
  listeners.forEach(fn => fn(l));
}
export function onLang(fn: (l: Lang) => void) { listeners.add(fn); return () => { listeners.delete(fn); }; }

function applyDocument() {
  if (typeof document === 'undefined') return;
  document.documentElement.lang = current;
}

/** Traduit un texte français ; {nom} est remplacé par vars.nom */
export function t(fr: string, vars?: Record<string, string | number>): string {
  let s = current === 'en' ? (EN[fr] ?? fr) : fr;
  if (vars) s = s.replace(/\{(\w+)\}/g, (m, k) => (k in vars ? String(vars[k]) : m));
  return s;
}

/** « 3 signets » / « 3 bookmarks » : forme française donnée, anglais tiré du dictionnaire */
export function plural(n: number, one: string, many: string) {
  return `${n} ${t(n > 1 || (current === 'en' && n === 0) ? many : one)}`;
}
