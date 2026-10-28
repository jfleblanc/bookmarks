import type { Env } from './env';
import { type Ctx, requireUser } from './auth';
import {
  HttpError, json, readJson, parseUrl, normalizeUrl, domainOf, isPublicHost, normalizeTags, cleanText, newId, now, DAY, placeholders
} from './util';

export interface BookmarkRow {
  id: string;
  user_id: string;
  url: string;
  norm_url: string;
  domain: string;
  title: string | null;
  note: string;
  favicon_url: string | null;
  thumb_key: string | null;
  thumb_ratio: number;
  status: 'processing' | 'ready' | 'error';
  error: string | null;
  created_at: number;
  updated_at: number;
  deleted_at: number | null;
}

export function serialize(b: BookmarkRow, tags: string[]) {
  return {
    id: b.id,
    url: b.url,
    domain: b.domain,
    title: b.title,
    note: b.note || '',
    faviconUrl: b.favicon_url,
    thumbUrl: b.thumb_key ? `/api/thumbs/${b.thumb_key}` : null,
    thumbRatio: b.thumb_ratio,
    status: b.status,
    error: b.error,
    tags,
    createdAt: b.created_at,
    updatedAt: b.updated_at
  };
}
export type Bookmark = ReturnType<typeof serialize>;

/** Note personnelle : texte libre, sauts de ligne conservés, 2000 caractères au plus */
function cleanNote(v: unknown): string {
  return String(v ?? '').replace(/\r\n?/g, '\n').replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '').replace(/\n{3,}/g, '\n\n').trim().slice(0, 2000);
}

/** Charge les tags d'une liste de signets (une seule requête) */
export async function tagsFor(env: Env, ids: string[]): Promise<Map<string, string[]>> {
  const map = new Map<string, string[]>(ids.map(id => [id, []]));
  if (!ids.length) return map;
  for (let i = 0; i < ids.length; i += 90) {
    const chunk = ids.slice(i, i + 90);
    const { results } = await env.DB.prepare(
      `SELECT bt.bookmark_id AS b, t.name AS n FROM bookmark_tags bt JOIN tags t ON t.id = bt.tag_id
       WHERE bt.bookmark_id IN (${placeholders(chunk.length)}) ORDER BY t.name`
    ).bind(...chunk).all<{ b: string; n: string }>();
    for (const r of results) map.get(r.b)?.push(r.n);
  }
  return map;
}

export async function withTags(env: Env, rows: BookmarkRow[]) {
  const tags = await tagsFor(env, rows.map(r => r.id));
  return rows.map(r => serialize(r, tags.get(r.id) || []));
}

function setTagsStatements(env: Env, userId: string, bookmarkId: string, tags: string[]) {
  const s = [
    ...tags.map(t => env.DB.prepare(`INSERT OR IGNORE INTO tags (id, user_id, name) VALUES (?, ?, ?)`).bind(newId(), userId, t)),
    env.DB.prepare(`DELETE FROM bookmark_tags WHERE bookmark_id = ?`).bind(bookmarkId),
    ...tags.map(t => env.DB.prepare(
      `INSERT OR IGNORE INTO bookmark_tags (bookmark_id, tag_id) SELECT ?, id FROM tags WHERE user_id = ? AND name = ?`
    ).bind(bookmarkId, userId, t)),
    env.DB.prepare(`DELETE FROM tags WHERE user_id = ? AND id NOT IN (SELECT tag_id FROM bookmark_tags)`).bind(userId)
  ];
  return s;
}

async function getOwned(ctx: Ctx, id: string): Promise<BookmarkRow> {
  const user = requireUser(ctx);
  const b = await ctx.env.DB.prepare(`SELECT * FROM bookmarks WHERE id = ? AND user_id = ?`).bind(id, user.id).first<BookmarkRow>();
  if (!b) throw new HttpError(404, 'not_found', 'Signet introuvable.');
  return b;
}

/** Supprime définitivement les signets mis à la corbeille depuis plus d'un jour */
async function purgeDeleted(env: Env, userId: string, extraIds: string[] = []) {
  const { results } = await env.DB.prepare(
    `SELECT id, thumb_key FROM bookmarks WHERE user_id = ? AND deleted_at IS NOT NULL AND deleted_at < ?`
  ).bind(userId, now() - DAY).all<{ id: string; thumb_key: string | null }>();
  const extra = extraIds.length
    ? (await env.DB.prepare(`SELECT id, thumb_key FROM bookmarks WHERE user_id = ? AND id IN (${placeholders(extraIds.length)})`)
        .bind(userId, ...extraIds).all<{ id: string; thumb_key: string | null }>()).results
    : [];
  const rows = [...results, ...extra.filter(e => !results.some(r => r.id === e.id))];
  const ids = rows.map(r => r.id);
  if (!ids.length) return;
  const keys = rows.map(r => r.thumb_key).filter(Boolean) as string[];
  for (let i = 0; i < ids.length; i += 90) {
    const c = ids.slice(i, i + 90);
    await env.DB.batch([
      env.DB.prepare(`DELETE FROM bookmark_tags WHERE bookmark_id IN (${placeholders(c.length)})`).bind(...c),
      env.DB.prepare(`DELETE FROM collection_items WHERE bookmark_id IN (${placeholders(c.length)})`).bind(...c),
      env.DB.prepare(`DELETE FROM bookmarks WHERE id IN (${placeholders(c.length)})`).bind(...c)
    ]);
  }
  await env.DB.prepare(`DELETE FROM tags WHERE user_id = ? AND id NOT IN (SELECT tag_id FROM bookmark_tags)`).bind(userId).run();
  if (keys.length) await env.THUMBS.delete(keys);
}

/* ---------- Routes ---------- */

export async function list(ctx: Ctx) {
  const user = requireUser(ctx);
  const q = ctx.url.searchParams;
  const tags = normalizeTags((q.get('tags') || '').split(',').filter(Boolean));
  const mode = q.get('mode') === 'or' ? 'or' : 'and';
  const limit = Math.min(Math.max(Number(q.get('limit')) || 24, 1), 100);
  const cursor = q.get('cursor');

  let where = `b.user_id = ? AND b.deleted_at IS NULL`;
  const binds: unknown[] = [user.id];
  if (tags.length) {
    where += ` AND b.id IN (SELECT bt.bookmark_id FROM bookmark_tags bt JOIN tags t ON t.id = bt.tag_id
               WHERE t.user_id = ? AND t.name IN (${placeholders(tags.length)})
               GROUP BY bt.bookmark_id ${mode === 'and' ? 'HAVING COUNT(DISTINCT t.name) = ?' : ''})`;
    binds.push(user.id, ...tags);
    if (mode === 'and') binds.push(tags.length);
  }
  const total = await ctx.env.DB.prepare(`SELECT COUNT(*) AS n FROM bookmarks b WHERE ${where}`).bind(...binds).first<{ n: number }>();

  let pageWhere = where;
  const pageBinds = [...binds];
  if (cursor) {
    const [ts, id] = cursor.split('_');
    pageWhere += ` AND (b.created_at < ? OR (b.created_at = ? AND b.id < ?))`;
    pageBinds.push(Number(ts), Number(ts), id || '');
  }
  const { results } = await ctx.env.DB.prepare(
    `SELECT b.* FROM bookmarks b WHERE ${pageWhere} ORDER BY b.created_at DESC, b.id DESC LIMIT ?`
  ).bind(...pageBinds, limit + 1).all<BookmarkRow>();

  const page = results.slice(0, limit);
  const last = page[page.length - 1];
  return json({
    items: await withTags(ctx.env, page),
    total: total?.n ?? 0,
    nextCursor: results.length > limit && last ? `${last.created_at}_${last.id}` : null
  });
}

/** Liste légère de tous les signets (pour choisir ceux d'une collection) */
export async function listLite(ctx: Ctx) {
  const user = requireUser(ctx);
  const { results } = await ctx.env.DB.prepare(
    `SELECT * FROM bookmarks WHERE user_id = ? AND deleted_at IS NULL ORDER BY created_at DESC LIMIT 5000`
  ).bind(user.id).all<BookmarkRow>();
  const tags = await tagsFor(ctx.env, results.map(r => r.id));
  return json({ items: results.map(r => ({ id: r.id, title: r.title, domain: r.domain, tags: tags.get(r.id) || [] })) });
}

/** Ce site est-il déjà enregistré ? (utilisé par l'extension) */
export async function lookup(ctx: Ctx) {
  const user = requireUser(ctx);
  let norm: string;
  try {
    norm = normalizeUrl(parseUrl(ctx.url.searchParams.get('url')));
  } catch {
    return json({ item: null });
  }
  const b = await ctx.env.DB.prepare(`SELECT * FROM bookmarks WHERE user_id = ? AND norm_url = ? AND deleted_at IS NULL`)
    .bind(user.id, norm).first<BookmarkRow>();
  if (!b) return json({ item: null });
  const [item] = await withTags(ctx.env, [b]);
  return json({ item });
}

export async function getOne(ctx: Ctx, p: Record<string, string>) {
  const b = await getOwned(ctx, p.id);
  if (b.deleted_at) throw new HttpError(404, 'not_found', 'Signet introuvable.');
  const [item] = await withTags(ctx.env, [b]);
  return json({ item });
}

/** Vignette envoyée par l'extension (capture faite dans le navigateur de la personne) : JPEG seulement, 400 Ko au plus */
async function storeClientThumb(env: Env, data: unknown): Promise<string | null> {
  if (data === undefined || data === null || data === '') return null;
  const m = typeof data === 'string' ? data.match(/^data:image\/jpeg;base64,([A-Za-z0-9+/=]+)$/) : null;
  if (!m || m[1].length > 560_000) throw new HttpError(400, 'bad_thumb', 'La vignette envoyée est invalide.');
  let bytes: Uint8Array;
  try { bytes = Uint8Array.from(atob(m[1]), c => c.charCodeAt(0)); } catch { throw new HttpError(400, 'bad_thumb', 'La vignette envoyée est invalide.'); }
  if (bytes.length < 200 || bytes[0] !== 0xff || bytes[1] !== 0xd8 || bytes[2] !== 0xff) throw new HttpError(400, 'bad_thumb', 'La vignette envoyée est invalide.');
  const key = `${crypto.randomUUID()}.jpg`;
  await env.THUMBS.put(key, bytes, { httpMetadata: { contentType: 'image/jpeg' } });
  return key;
}

export async function create(ctx: Ctx) {
  const user = requireUser(ctx);
  const body = await readJson<{ url?: string; tags?: string[]; note?: string; thumb?: string }>(ctx.req);
  const u = parseUrl(body.url);
  if (!isPublicHost(u.hostname)) throw new HttpError(400, 'bad_url', 'Cette adresse pointe vers un réseau privé.');
  const norm = normalizeUrl(u);
  const dup = await ctx.env.DB.prepare(`SELECT id, title, domain, deleted_at FROM bookmarks WHERE user_id = ? AND norm_url = ?`)
    .bind(user.id, norm).first<{ id: string; title: string | null; domain: string; deleted_at: number | null }>();
  if (dup && !dup.deleted_at) {
    throw new HttpError(409, 'duplicate', 'Ce site est déjà enregistré.', { bookmark: { id: dup.id, title: dup.title, domain: dup.domain } });
  }
  if (dup) await purgeDeleted(ctx.env, user.id, [dup.id]);

  const id = newId();
  const t = now();
  const tags = normalizeTags(body.tags);
  const thumbKey = await storeClientThumb(ctx.env, body.thumb);
  await ctx.env.DB.batch([
    ctx.env.DB.prepare(
      `INSERT INTO bookmarks (id, user_id, url, norm_url, domain, note, thumb_key, thumb_ratio, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, 0.75, 'processing', ?, ?)`
    ).bind(id, user.id, u.href, norm, domainOf(u), cleanNote(body.note), thumbKey, t, t),
    ...setTagsStatements(ctx.env, user.id, id, tags)
  ]);
  // Avec une vignette fournie, le serveur ne va chercher que le titre et le favicon (pas de navigateur)
  await ctx.env.JOBS.send(thumbKey ? { bookmarkId: id, metaOnly: true } : { bookmarkId: id });
  const row = await ctx.env.DB.prepare(`SELECT * FROM bookmarks WHERE id = ?`).bind(id).first<BookmarkRow>();
  return json({ item: serialize(row!, tags) }, 201);
}

export async function update(ctx: Ctx, p: Record<string, string>) {
  const b = await getOwned(ctx, p.id);
  if (b.deleted_at) throw new HttpError(404, 'not_found', 'Signet introuvable.');
  const body = await readJson<{ url?: string; title?: string; tags?: string[]; note?: string; thumb?: string }>(ctx.req);
  const stmts = [];
  let recapture = false;
  const thumbKey = await storeClientThumb(ctx.env, body.thumb);
  if (thumbKey) stmts.push(ctx.env.DB.prepare(`UPDATE bookmarks SET thumb_key = ?, thumb_ratio = 0.75 WHERE id = ?`).bind(thumbKey, b.id));
  if (body.note !== undefined) stmts.push(ctx.env.DB.prepare(`UPDATE bookmarks SET note = ? WHERE id = ?`).bind(cleanNote(body.note), b.id));

  if (body.url !== undefined) {
    const u = parseUrl(body.url);
    if (!isPublicHost(u.hostname)) throw new HttpError(400, 'bad_url', 'Cette adresse pointe vers un réseau privé.');
    const norm = normalizeUrl(u);
    if (norm !== b.norm_url) {
      const dup = await ctx.env.DB.prepare(`SELECT id, title, domain, deleted_at FROM bookmarks WHERE user_id = ? AND norm_url = ? AND id != ?`)
        .bind(b.user_id, norm, b.id).first<{ id: string; title: string | null; domain: string; deleted_at: number | null }>();
      if (dup && !dup.deleted_at) throw new HttpError(409, 'duplicate', `Cette adresse est déjà utilisée par « ${dup.title || dup.domain} ».`, { bookmark: dup });
      if (dup) await purgeDeleted(ctx.env, b.user_id, [dup.id]);
      stmts.push(ctx.env.DB.prepare(`UPDATE bookmarks SET url = ?, norm_url = ?, domain = ?, status = 'processing', error = NULL WHERE id = ?`)
        .bind(u.href, norm, domainOf(u), b.id));
      recapture = true;
    }
  }
  if (body.title !== undefined) {
    const title = cleanText(body.title, 300);
    // Un titre vide laisse l'extraction automatique le remplir
    stmts.push(ctx.env.DB.prepare(`UPDATE bookmarks SET title = ? WHERE id = ?`).bind(title || (recapture ? null : b.title), b.id));
  } else if (recapture) {
    stmts.push(ctx.env.DB.prepare(`UPDATE bookmarks SET title = NULL WHERE id = ?`).bind(b.id));
  }
  if (body.tags !== undefined) stmts.push(...setTagsStatements(ctx.env, b.user_id, b.id, normalizeTags(body.tags)));
  stmts.push(ctx.env.DB.prepare(`UPDATE bookmarks SET updated_at = ? WHERE id = ?`).bind(now(), b.id));
  await ctx.env.DB.batch(stmts);
  if (thumbKey && b.thumb_key) await ctx.env.THUMBS.delete(b.thumb_key).catch(() => {});
  if (recapture) await ctx.env.JOBS.send(thumbKey ? { bookmarkId: b.id, metaOnly: true } : { bookmarkId: b.id });
  return getOne(ctx, p);
}

export async function recapture(ctx: Ctx, p: Record<string, string>) {
  const b = await getOwned(ctx, p.id);
  if (b.deleted_at) throw new HttpError(404, 'not_found', 'Signet introuvable.');
  await ctx.env.DB.prepare(`UPDATE bookmarks SET status = 'processing', error = NULL, updated_at = ? WHERE id = ?`).bind(now(), b.id).run();
  await ctx.env.JOBS.send({ bookmarkId: b.id });
  return getOne(ctx, p);
}

export async function remove(ctx: Ctx, p: Record<string, string>) {
  const b = await getOwned(ctx, p.id);
  await ctx.env.DB.prepare(`UPDATE bookmarks SET deleted_at = ? WHERE id = ?`).bind(now(), b.id).run();
  ctx.waitUntil(purgeDeleted(ctx.env, b.user_id));
  return json({ ok: true });
}

export async function restore(ctx: Ctx, p: Record<string, string>) {
  const b = await getOwned(ctx, p.id);
  await ctx.env.DB.prepare(`UPDATE bookmarks SET deleted_at = NULL WHERE id = ?`).bind(b.id).run();
  return getOne(ctx, p);
}

export async function listTags(ctx: Ctx) {
  const user = requireUser(ctx);
  const { results } = await ctx.env.DB.prepare(
    `SELECT t.name AS name, COUNT(b.id) AS count FROM tags t
     JOIN bookmark_tags bt ON bt.tag_id = t.id
     JOIN bookmarks b ON b.id = bt.bookmark_id AND b.deleted_at IS NULL
     WHERE t.user_id = ? GROUP BY t.id ORDER BY t.name`
  ).bind(user.id).all<{ name: string; count: number }>();
  return json({ tags: results });
}

export async function thumb(ctx: Ctx, p: Record<string, string>) {
  if (!/^[a-f0-9-]{36}\.(jpg|png|webp)$/.test(p.key)) throw new HttpError(404, 'not_found', 'Image introuvable.');
  const obj = await ctx.env.THUMBS.get(p.key);
  if (!obj) throw new HttpError(404, 'not_found', 'Image introuvable.');
  return new Response(obj.body, {
    headers: {
      'content-type': obj.httpMetadata?.contentType || 'image/jpeg',
      'cache-control': 'public, max-age=31536000, immutable'
    }
  });
}
