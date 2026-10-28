/*
  Aperçu généré : une fausse page web dessinée à partir du nom de domaine (comme dans le prototype).
  Toujours la même pour un domaine donné, ne pèse rien, ne demande aucun téléchargement.
*/

function hash(str: string) {
  let h = 2166136261;
  for (const c of str) { h ^= c.charCodeAt(0); h = Math.imul(h, 16777619); }
  return h >>> 0;
}
function rng(seed: number) {
  let a = seed;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t ^= t + Math.imul(t ^ (t >>> 7), 61 | t);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const esc = (s: string) => s.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!));

const cache = new Map<string, string>();

export function generatedPreview(domain: string, ratio = 0.75): string {
  const key = `${domain}|${ratio}`;
  const hit = cache.get(key);
  if (hit) return hit;
  const r = rng(hash(domain));
  const W = 400, H = Math.round(W * ratio);
  const hue = Math.floor(r() * 360), hue2 = (hue + 140 + Math.floor(r() * 80)) % 360;
  const dark = r() < 0.3;
  const bg = dark ? `hsl(${hue},22%,12%)` : `hsl(${hue},30%,96%)`;
  const fg = dark ? `hsl(${hue},20%,88%)` : `hsl(${hue},25%,18%)`;
  const soft = dark ? `hsl(${hue},16%,24%)` : `hsl(${hue},18%,86%)`;
  const acc = `hsl(${hue2},${55 + Math.floor(r() * 25)}%,${dark ? 62 : 52}%)`;
  let s = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}"><rect width="${W}" height="${H}" fill="${bg}"/>`;
  s += `<rect x="20" y="18" width="16" height="16" rx="4" fill="${acc}"/><text x="44" y="31" font-family="monospace" font-size="13" fill="${fg}">${esc(domain)}</text>`;
  for (let i = 0; i < 3; i++) s += `<rect x="${W - 150 + i * 44}" y="22" width="32" height="7" rx="3.5" fill="${soft}"/>`;
  let y = 64;
  const layout = Math.floor(r() * 3);
  if (layout === 0) {
    s += `<rect x="20" y="${y}" width="${200 + r() * 140}" height="22" rx="4" fill="${fg}"/><rect x="20" y="${y + 32}" width="${150 + r() * 120}" height="22" rx="4" fill="${fg}"/>`;
    s += `<rect x="20" y="${y + 70}" width="230" height="8" rx="4" fill="${soft}"/><rect x="20" y="${y + 86}" width="190" height="8" rx="4" fill="${soft}"/>`;
    s += `<rect x="20" y="${y + 110}" width="96" height="30" rx="15" fill="${acc}"/>`;
    y += 160;
  } else if (layout === 1) {
    const hh = Math.min(150, H * 0.35);
    s += `<rect x="20" y="${y}" width="${W - 40}" height="${hh}" rx="8" fill="${acc}"/>`;
    s += `<circle cx="${80 + r() * 200}" cy="${y + 50}" r="${30 + r() * 30}" fill="${bg}" opacity=".35"/>`;
    y += hh + 18;
    s += `<rect x="20" y="${y}" width="${180 + r() * 120}" height="18" rx="4" fill="${fg}"/>`;
    y += 40;
  } else {
    s += `<rect x="20" y="${y}" width="170" height="20" rx="4" fill="${fg}"/><rect x="20" y="${y + 30}" width="150" height="20" rx="4" fill="${fg}"/><rect x="20" y="${y + 64}" width="140" height="8" rx="4" fill="${soft}"/><rect x="20" y="${y + 80}" width="120" height="8" rx="4" fill="${soft}"/>`;
    s += `<rect x="210" y="${y}" width="170" height="130" rx="10" fill="${acc}"/><rect x="232" y="${y + 22}" width="126" height="86" rx="6" fill="${bg}" opacity=".3"/>`;
    y += 150;
  }
  const cols = r() < 0.5 ? 3 : 2, gw = (W - 40 - (cols - 1) * 12) / cols;
  while (y + 70 < H - 12) {
    const ch = 60 + Math.floor(r() * 50);
    for (let c = 0; c < cols; c++) {
      const x = 20 + c * (gw + 12);
      s += `<rect x="${x}" y="${y}" width="${gw}" height="${ch}" rx="6" fill="${soft}"/>`;
      s += `<rect x="${x + 10}" y="${y + ch - 22}" width="${gw * 0.55}" height="7" rx="3.5" fill="${c === 0 ? acc : fg}" opacity=".7"/>`;
    }
    y += ch + 14;
  }
  s += '</svg>';
  const url = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(s);
  cache.set(key, url);
  return url;
}
