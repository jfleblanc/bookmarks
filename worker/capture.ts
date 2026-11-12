import type { Env } from './env';
import type { BookmarkRow } from './bookmarks';
import { isPublicHost, now } from './util';

/* Traitement en arrière-plan d'un signet : titre, favicon, puis capture d'écran (Browser Rendering). */

const UA = 'Mozilla/5.0 (compatible; bookmarks/1.0; +capture de vignettes)';

const ENTITIES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', laquo: '«', raquo: '»', rsquo: '’', lsquo: '‘', ndash: '–', mdash: '—', hellip: '…', eacute: 'é', egrave: 'è', agrave: 'à', ccedil: 'ç' };
function decode(s: string) {
  return s
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16)))
    .replace(/&([a-z]+);/gi, (m, n) => ENTITIES[n.toLowerCase()] ?? m)
    .replace(/\s+/g, ' ')
    .trim();
}

function attr(tag: string, name: string): string | null {
  const m = tag.match(new RegExp(`\\b${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s>]+))`, 'i'));
  return m ? (m[1] ?? m[2] ?? m[3] ?? '') : null;
}

export function parseHtmlMeta(html: string, baseUrl: string) {
  const head = html.slice(0, 300_000);
  let title: string | null = null;
  let favicon: string | null = null;
  let image: string | null = null;
  let iconScore = -1;

  for (const tag of head.match(/<meta\b[^>]*>/gi) || []) {
    const key = (attr(tag, 'property') || attr(tag, 'name') || '').toLowerCase();
    if ((key === 'og:title' || key === 'twitter:title') && !title) {
      const c = attr(tag, 'content');
      if (c) title = decode(c);
    }
    if ((key === 'og:image' || key === 'og:image:secure_url' || key === 'twitter:image') && !image) {
      const c = attr(tag, 'content');
      if (c) { try { image = new URL(decode(c), baseUrl).href; } catch {} }
    }
  }
  if (!title) {
    const m = head.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
    if (m) title = decode(m[1]);
  }
  for (const tag of head.match(/<link\b[^>]*>/gi) || []) {
    const rel = (attr(tag, 'rel') || '').toLowerCase();
    if (!/\bicon\b/.test(rel)) continue;
    const href = attr(tag, 'href');
    if (!href) continue;
    // Préfère une icône d'environ 32 px, puis les SVG, puis le reste
    const sizes = attr(tag, 'sizes') || '';
    const size = Number(sizes.split('x')[0]) || 0;
    let score = 1;
    if (/\.svg(\?|$)/i.test(href) || (attr(tag, 'type') || '').includes('svg')) score = 3;
    if (size >= 32 && size <= 64) score = 4;
    if (rel.includes('apple-touch-icon')) score = Math.max(score, 2);
    if (score > iconScore) {
      try { favicon = new URL(decode(href), baseUrl).href; iconScore = score; } catch {}
    }
  }
  if (!favicon) {
    try { favicon = new URL('/favicon.ico', baseUrl).href; } catch {}
  }
  if (title) title = title.slice(0, 300);
  return { title: title || null, favicon, image: image && /^https?:/.test(image) ? image : null };
}

async function fetchMeta(url: string) {
  const res = await fetch(url, {
    redirect: 'follow',
    headers: { 'user-agent': UA, accept: 'text/html,application/xhtml+xml;q=0.9,*/*;q=0.5', 'accept-language': 'fr-CA,fr;q=0.9,en;q=0.8' },
    signal: AbortSignal.timeout(10_000)
  });
  const finalUrl = res.url || url;
  if (!isPublicHost(new URL(finalUrl).hostname)) throw new Error('Redirection vers une adresse privée');
  const type = res.headers.get('content-type') || '';
  if (!type.includes('html')) {
    res.body?.cancel();
    return { title: null, favicon: new URL('/favicon.ico', finalUrl).href, image: null, ok: res.ok };
  }
  // Lit au plus 1 Mo
  const reader = res.body!.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  while (size < 1_000_000) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    size += value.length;
  }
  reader.cancel().catch(() => {});
  const buf = new Uint8Array(size);
  let o = 0;
  for (const c of chunks) { buf.set(c, o); o += c.length; }
  const html = new TextDecoder('utf-8', { fatal: false }).decode(buf);
  return { ...parseHtmlMeta(html, finalUrl), ok: res.ok };
}

/** Ouvre un navigateur à la demande et le réutilise pour tout le lot */
export type BrowserGetter = () => Promise<any | null>;

/** Pages de refus des protections anti-robots (Cloudflare, Akamai, DataDome…) : on ne les garde jamais comme vignette */
const BLOCKED = /^(4\d\d|5\d\d)\b|forbidden|access denied|accès refusé|just a moment|attention required|un instant|are you a robot|êtes-vous un robot|captcha|verify you are human|vérifiez que vous êtes humain|request blocked|pardon our interruption|bot detection/i;

export function looksBlocked(status: number, title: string, text: string) {
  if (status >= 400) return true;
  const t = (title || '').trim();
  const body = (text || '').replace(/\s+/g, ' ').trim();
  if (BLOCKED.test(t)) return true;
  // page presque vide qui ne contient qu'un message de refus
  return body.length < 600 && BLOCKED.test(body.slice(0, 300));
}

type Shot = { img: Uint8Array | null; blocked: boolean };

async function screenshot(getBrowser: BrowserGetter, url: string): Promise<Shot> {
  const browser = await getBrowser();
  if (!browser) return { img: null, blocked: false };
  const page = await browser.newPage();
  try {
    await page.setUserAgent('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36');
    // Mise en page d'un écran de 1280 × 960, rendue à 40 % : une image de 512 × 384 (environ 30 à 50 Ko)
    await page.setViewport({ width: 1280, height: 960, deviceScaleFactor: 0.4 });
    const res = await page.goto(url, { waitUntil: 'networkidle2', timeout: 20_000 }).catch(() => null);
    await new Promise(r => setTimeout(r, 800));
    let title = '', text = '';
    try { ({ title, text } = await page.evaluate(() => ({ title: document.title, text: document.body?.innerText?.slice(0, 2000) || '' }))); } catch {}
    if (looksBlocked(res?.status?.() ?? 0, title, text)) return { img: null, blocked: true };
    return { img: (await page.screenshot({ type: 'jpeg', quality: 75 })) as Uint8Array, blocked: false };
  } finally {
    await page.close().catch(() => {});
  }
}

/** Plan B : l'image d'aperçu que le site fournit lui-même pour les partages (og:image), recadrée au format des vignettes */
async function previewImage(getBrowser: BrowserGetter, image: string): Promise<Uint8Array | null> {
  if (!isPublicHost(new URL(image).hostname)) return null;
  const browser = await getBrowser();
  if (!browser) return null;
  const page = await browser.newPage();
  try {
    await page.setViewport({ width: 1280, height: 960, deviceScaleFactor: 0.4 });
    const src = image.replace(/&/g, '&amp;').replace(/"/g, '&quot;');
    await page.setContent(`<!doctype html><html><body style="margin:0;background:#eee"><img id="i" src="${src}" referrerpolicy="no-referrer" style="display:block;width:1280px;height:960px;object-fit:cover"></body></html>`, { waitUntil: 'networkidle0', timeout: 15_000 }).catch(() => {});
    const ok = await page.evaluate(() => { const i = document.getElementById('i') as HTMLImageElement; return i.complete && i.naturalWidth > 32; }).catch(() => false);
    if (!ok) return null;
    return (await page.screenshot({ type: 'jpeg', quality: 75 })) as Uint8Array;
  } finally {
    await page.close().catch(() => {});
  }
}

/** Identifiant d'une vidéo YouTube (watch, youtu.be, shorts, live, embed), sinon null */
export function youtubeId(raw: string): string | null {
  let u: URL;
  try { u = new URL(raw); } catch { return null; }
  const host = u.hostname.replace(/^(www|m|music)\./, '');
  let id: string | null = null;
  if (host === 'youtu.be') id = u.pathname.split('/')[1] || null;
  else if (host === 'youtube.com' || host === 'youtube-nocookie.com') {
    if (u.pathname === '/watch') id = u.searchParams.get('v');
    else id = u.pathname.match(/^\/(?:shorts|live|embed|v)\/([^/?#]+)/)?.[1] || null;
  }
  return id && /^[A-Za-z0-9_-]{11}$/.test(id) ? id : null;
}

/** La vignette officielle de la vidéo, en 16:9 sans bandes noires (aucun navigateur nécessaire) */
async function youtubeThumb(id: string): Promise<{ img: Uint8Array; ratio: number } | null> {
  for (const name of ['hq720.jpg', 'maxresdefault.jpg', 'mqdefault.jpg']) {
    try {
      const res = await fetch(`https://i.ytimg.com/vi/${id}/${name}`, { headers: { accept: 'image/*' } });
      if (!res.ok || !(res.headers.get('content-type') || '').startsWith('image/')) continue;
      const img = new Uint8Array(await res.arrayBuffer());
      if (img.length > 1500) return { img, ratio: 0.5625 };
    } catch { /* essaie la taille suivante */ }
  }
  return null;
}

/** Titre de la vidéo par oEmbed, si la page ne l'a pas donné */
async function youtubeTitle(url: string): Promise<string | null> {
  try {
    const res = await fetch(`https://www.youtube.com/oembed?format=json&url=${encodeURIComponent(url)}`);
    if (!res.ok) return null;
    const j = await res.json<{ title?: string }>();
    return j.title?.trim() || null;
  } catch { return null; }
}

export async function capture(env: Env, bookmarkId: string, getBrowser: BrowserGetter, opts: { metaOnly?: boolean } = {}) {
  const b = await env.DB.prepare(`SELECT * FROM bookmarks WHERE id = ?`).bind(bookmarkId).first<BookmarkRow>();
  if (!b || b.deleted_at) return;
  const url = b.url;

  let meta: { title: string | null; favicon: string | null; image: string | null; ok: boolean } | null = null;
  let metaError: string | null = null;
  try {
    if (!isPublicHost(new URL(url).hostname)) throw new Error('Adresse privée');
    meta = await fetchMeta(url);
  } catch (e) {
    metaError = e instanceof Error ? e.message : String(e);
  }

  const ytId = youtubeId(url);
  if (ytId && meta) {
    meta.title = meta.title?.replace(/\s*[-–]\s*YouTube\s*$/i, '').trim() || null;
    if (!meta.title || /^youtube$/i.test(meta.title)) meta.title = await youtubeTitle(url);
  }

  let thumbKey: string | null = null;
  let ratio = 0.75;
  if (!opts.metaOnly) try {
    let img: Uint8Array | null = null;
    // Vidéo YouTube : l'image choisie par la chaîne, plus belle qu'une capture de la page
    const yt = ytId ? await youtubeThumb(ytId) : null;
    if (yt) { img = yt.img; ratio = yt.ratio; }
    const shot = img ? { img, blocked: false } : await screenshot(getBrowser, url);
    img = shot.img;
    // Site qui refuse les robots : on prend son image d'aperçu officielle, sinon l'app dessine un aperçu
    if (!img && shot.blocked && meta?.image) img = await previewImage(getBrowser, meta.image).catch(() => null);
    if (img) {
      thumbKey = `${crypto.randomUUID()}.jpg`;
      await env.THUMBS.put(thumbKey, img, { httpMetadata: { contentType: 'image/jpeg' } });
    }
  } catch (e) {
    console.error('Capture d’écran impossible', url, e);
  }

  // Le signet a peut-être changé pendant le traitement (adresse modifiée, supprimé)
  const fresh = await env.DB.prepare(`SELECT url, title, thumb_key, deleted_at FROM bookmarks WHERE id = ?`).bind(bookmarkId)
    .first<{ url: string; title: string | null; thumb_key: string | null; deleted_at: number | null }>();
  if (!fresh || fresh.deleted_at || fresh.url !== url) {
    if (thumbKey) await env.THUMBS.delete(thumbKey);
    return;
  }

  const failed = !meta && !thumbKey && !(opts.metaOnly && fresh.thumb_key);
  const fallbackTitle = new URL(url).hostname.replace(/^www\./, '');
  await env.DB.prepare(
    `UPDATE bookmarks SET title = ?, favicon_url = COALESCE(?, favicon_url), thumb_key = COALESCE(?, thumb_key),
       thumb_ratio = COALESCE(?, thumb_ratio), status = ?, error = ?, updated_at = ? WHERE id = ?`
  ).bind(
    fresh.title || meta?.title || fallbackTitle,
    meta?.favicon ?? null,
    thumbKey,
    thumbKey ? ratio : null,
    failed ? 'error' : 'ready',
    failed ? `Impossible de joindre ce site${metaError ? ` (${metaError})` : ''}.` : null,
    now(),
    bookmarkId
  ).run();

  if (thumbKey && fresh.thumb_key && fresh.thumb_key !== thumbKey) await env.THUMBS.delete(fresh.thumb_key);
}
