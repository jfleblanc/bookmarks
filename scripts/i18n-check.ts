// Vérifie que chaque texte passé à t() / plural() a sa traduction anglaise.
// Usage : bun scripts/i18n-check.ts [fichiers…]   (par défaut : tout src/)
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { EN } from '../src/locales/en';

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap(f => {
    const p = join(dir, f);
    if (statSync(p).isDirectory()) return f === 'locales' ? [] : walk(p);
    return /\.(tsx?|js)$/.test(f) ? [p] : [];
  });
}
const files = process.argv.length > 2 ? process.argv.slice(2) : walk('src');
const str = String.raw`'((?:[^'\\]|\\.)*)'|"((?:[^"\\]|\\.)*)"`;
const unesc = (s: string) => s.replace(/\\(.)/g, '$1');
let missing = 0;
for (const f of files) {
  const src = readFileSync(f, 'utf8');
  const keys: string[] = [];
  for (const m of src.matchAll(new RegExp(String.raw`\bt\(\s*(?:${str})`, 'g'))) keys.push(unesc(m[1] ?? m[2]));
  for (const m of src.matchAll(new RegExp(String.raw`\bplural\([^,]+,\s*(?:${str})\s*,\s*(?:${str})`, 'g'))) keys.push(unesc(m[1] ?? m[2]), unesc(m[3] ?? m[4]));
  for (const k of keys) if (!(k in EN)) { console.log(`${f}: ${JSON.stringify(k)}`); missing++; }
  // texte français resté en dur dans du JSX (heuristique)
  for (const m of src.matchAll(/>([^<>{}\n]*[a-zàâçéèêëîïôûùüÿœ][^<>{}\n]*)</gi)) {
    const txt = m[1].trim();
    if (txt.length > 2 && /[a-zA-Zà-ÿ]{3}/.test(txt) && !/^[\w.-]+$/.test(txt)) { console.log(`${f}: texte en dur ? ${JSON.stringify(txt)}`); }
  }
}
console.log(missing ? `${missing} traduction(s) manquante(s)` : 'Toutes les traductions sont présentes.');
