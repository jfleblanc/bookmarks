import { type Ctx, requireUser, appUrl } from './auth';
import { type BookmarkRow, withTags } from './bookmarks';
import { HttpError, json, readJson, cleanText, newId, now, DAY, shareCode, placeholders } from './util';

interface CollectionRow {
  id: string;
  user_id: string;
  title: string;
  description: string;
  share_code: string;
  shared: number;
  created_at: number;
  updated_at: number;
  deleted_at: number | null;
}

function serialize(ctx: Ctx, c: CollectionRow, extra: { count?: number; covers?: string[] } = {}) {
  return {
    id: c.id,
    title: c.title,
    description: c.description,
    shared: !!c.shared,
    shareUrl: `${appUrl(ctx)}/c/${c.share_code}`,
    count: extra.count ?? 0,
    covers: extra.covers ?? [],
    createdAt: c.created_at,
    updatedAt: c.updated_at
  };
}

async function getOwned(ctx: Ctx, id: string): Promise<CollectionRow> {
  const user = requireUser(ctx);
  const c = await ctx.env.DB.prepare(`SELECT * FROM collections WHERE id = ? AND user_id = ?`).bind(id, user.id).first<CollectionRow>();
  if (!c) throw new HttpError(404, 'not_found', 'Collection introuvable.');
  return c;
}

/** Garde seulement les identifiants de signets qui appartiennent à l'utilisateur */
async function ownedBookmarkIds(ctx: Ctx, userId: string, ids: unknown): Promise<string[]> {
  const list = Array.isArray(ids) ? [...new Set(ids.map(String))].slice(0, 2000) : [];
  if (!list.length) return [];
  const ok = new Set<string>();
  for (let i = 0; i < list.length; i += 90) {
    const c = list.slice(i, i + 90);
    const { results } = await ctx.env.DB.prepare(
      `SELECT id FROM bookmarks WHERE user_id = ? AND deleted_at IS NULL AND id IN (${placeholders(c.length)})`
    ).bind(userId, ...c).all<{ id: string }>();
    results.forEach(r => ok.add(r.id));
  }
  return list.filter(id => ok.has(id));
}

async function itemsOf(ctx: Ctx, collectionId: string) {
  const { results } = await ctx.env.DB.prepare(
    `SELECT b.* FROM collection_items ci JOIN bookmarks b ON b.id = ci.bookmark_id AND b.deleted_at IS NULL
     WHERE ci.collection_id = ? ORDER BY ci.position, b.created_at`
  ).bind(collectionId).all<BookmarkRow>();
  return withTags(ctx.env, results);
}

function validTitle(v: unknown) {
  const t = cleanText(v, 120);
  if (!t) throw new HttpError(400, 'title_required', 'Le titre est obligatoire.');
  return t;
}

/* ---------- Routes (propriétaire) ---------- */

export async function list(ctx: Ctx) {
  const user = requireUser(ctx);
  const { results } = await ctx.env.DB.prepare(
    `SELECT c.*, (SELECT COUNT(*) FROM collection_items ci JOIN bookmarks b ON b.id = ci.bookmark_id AND b.deleted_at IS NULL
                  WHERE ci.collection_id = c.id) AS n
     FROM collections c WHERE c.user_id = ? AND c.deleted_at IS NULL ORDER BY c.updated_at DESC`
  ).bind(user.id).all<CollectionRow & { n: number }>();
  const covers = new Map<string, string[]>();
  if (results.length) {
    const ids = results.map(r => r.id);
    const { results: thumbs } = await ctx.env.DB.prepare(
      `SELECT ci.collection_id AS c, b.thumb_key AS k FROM collection_items ci
       JOIN bookmarks b ON b.id = ci.bookmark_id AND b.deleted_at IS NULL AND b.thumb_key IS NOT NULL
       WHERE ci.collection_id IN (${placeholders(ids.length)}) ORDER BY ci.position`
    ).bind(...ids).all<{ c: string; k: string }>();
    for (const t of thumbs) {
      const arr = covers.get(t.c) || [];
      if (arr.length < 4) arr.push(`/api/thumbs/${t.k}`);
      covers.set(t.c, arr);
    }
  }
  return json({ collections: results.map(c => serialize(ctx, c, { count: c.n, covers: covers.get(c.id) || [] })) });
}

export async function create(ctx: Ctx) {
  const user = requireUser(ctx);
  const body = await readJson<{ title?: string; description?: string; bookmarkIds?: string[] }>(ctx.req);
  const id = newId();
  const t = now();
  const ids = await ownedBookmarkIds(ctx, user.id, body.bookmarkIds);
  await ctx.env.DB.batch([
    ctx.env.DB.prepare(`INSERT INTO collections (id, user_id, title, description, share_code, shared, created_at, updated_at) VALUES (?, ?, ?, ?, ?, 0, ?, ?)`)
      .bind(id, user.id, validTitle(body.title), cleanText(body.description, 600), shareCode(), t, t),
    ...ids.map((b, i) => ctx.env.DB.prepare(`INSERT INTO collection_items (collection_id, bookmark_id, position) VALUES (?, ?, ?)`).bind(id, b, i))
  ]);
  return getOne(ctx, { id }, 201);
}

export async function getOne(ctx: Ctx, p: Record<string, string>, status = 200) {
  const c = await getOwned(ctx, p.id);
  if (c.deleted_at) throw new HttpError(404, 'not_found', 'Collection introuvable.');
  const items = await itemsOf(ctx, c.id);
  return json({ collection: serialize(ctx, c, { count: items.length }), items }, status);
}

export async function update(ctx: Ctx, p: Record<string, string>) {
  const c = await getOwned(ctx, p.id);
  if (c.deleted_at) throw new HttpError(404, 'not_found', 'Collection introuvable.');
  const body = await readJson<{ title?: string; description?: string; shared?: boolean; itemIds?: string[] }>(ctx.req);
  const stmts = [];
  if (body.title !== undefined) stmts.push(ctx.env.DB.prepare(`UPDATE collections SET title = ? WHERE id = ?`).bind(validTitle(body.title), c.id));
  if (body.description !== undefined) stmts.push(ctx.env.DB.prepare(`UPDATE collections SET description = ? WHERE id = ?`).bind(cleanText(body.description, 600), c.id));
  if (body.shared !== undefined) stmts.push(ctx.env.DB.prepare(`UPDATE collections SET shared = ? WHERE id = ?`).bind(body.shared ? 1 : 0, c.id));
  if (body.itemIds !== undefined) {
    const ids = await ownedBookmarkIds(ctx, c.user_id, body.itemIds);
    stmts.push(ctx.env.DB.prepare(`DELETE FROM collection_items WHERE collection_id = ?`).bind(c.id));
    ids.forEach((b, i) => stmts.push(ctx.env.DB.prepare(`INSERT INTO collection_items (collection_id, bookmark_id, position) VALUES (?, ?, ?)`).bind(c.id, b, i)));
  }
  stmts.push(ctx.env.DB.prepare(`UPDATE collections SET updated_at = ? WHERE id = ?`).bind(now(), c.id));
  await ctx.env.DB.batch(stmts);
  return getOne(ctx, p);
}

export async function addItems(ctx: Ctx, p: Record<string, string>) {
  const c = await getOwned(ctx, p.id);
  if (c.deleted_at) throw new HttpError(404, 'not_found', 'Collection introuvable.');
  const body = await readJson<{ bookmarkIds?: string[] }>(ctx.req);
  const ids = await ownedBookmarkIds(ctx, c.user_id, body.bookmarkIds);
  const { results } = await ctx.env.DB.prepare(`SELECT bookmark_id, position FROM collection_items WHERE collection_id = ?`).bind(c.id).all<{ bookmark_id: string; position: number }>();
  const present = new Set(results.map(r => r.bookmark_id));
  let pos = results.reduce((m, r) => Math.max(m, r.position), -1);
  const toAdd = ids.filter(id => !present.has(id));
  await ctx.env.DB.batch([
    ...toAdd.map(b => ctx.env.DB.prepare(`INSERT INTO collection_items (collection_id, bookmark_id, position) VALUES (?, ?, ?)`).bind(c.id, b, ++pos)),
    ctx.env.DB.prepare(`UPDATE collections SET updated_at = ? WHERE id = ?`).bind(now(), c.id)
  ]);
  return json({ added: toAdd.length, already: ids.length - toAdd.length });
}

export async function regenerate(ctx: Ctx, p: Record<string, string>) {
  const c = await getOwned(ctx, p.id);
  await ctx.env.DB.prepare(`UPDATE collections SET share_code = ?, updated_at = ? WHERE id = ?`).bind(shareCode(), now(), c.id).run();
  return getOne(ctx, p);
}

/** Remet un ancien lien (annulation de « Nouveau lien ») */
export async function restoreLink(ctx: Ctx, p: Record<string, string>) {
  const c = await getOwned(ctx, p.id);
  const body = await readJson<{ shareUrl?: string }>(ctx.req);
  const code = String(body.shareUrl || '').split('/c/')[1] || '';
  if (!/^[a-z0-9]{10}$/.test(code)) throw new HttpError(400, 'bad_link', 'Lien invalide.');
  const taken = await ctx.env.DB.prepare(`SELECT id FROM collections WHERE share_code = ? AND id != ?`).bind(code, c.id).first();
  if (taken) throw new HttpError(409, 'link_taken', 'Ce lien n’est plus disponible.');
  await ctx.env.DB.prepare(`UPDATE collections SET share_code = ? WHERE id = ?`).bind(code, c.id).run();
  return getOne(ctx, p);
}

export async function remove(ctx: Ctx, p: Record<string, string>) {
  const c = await getOwned(ctx, p.id);
  await ctx.env.DB.prepare(`UPDATE collections SET deleted_at = ? WHERE id = ?`).bind(now(), c.id).run();
  // Purge des collections supprimées depuis plus d'un jour
  ctx.waitUntil((async () => {
    const { results } = await ctx.env.DB.prepare(`SELECT id FROM collections WHERE user_id = ? AND deleted_at IS NOT NULL AND deleted_at < ?`)
      .bind(c.user_id, now() - DAY).all<{ id: string }>();
    for (const r of results) {
      await ctx.env.DB.batch([
        ctx.env.DB.prepare(`DELETE FROM collection_items WHERE collection_id = ?`).bind(r.id),
        ctx.env.DB.prepare(`DELETE FROM collections WHERE id = ?`).bind(r.id)
      ]);
    }
  })());
  return json({ ok: true });
}

export async function restore(ctx: Ctx, p: Record<string, string>) {
  const c = await getOwned(ctx, p.id);
  await ctx.env.DB.prepare(`UPDATE collections SET deleted_at = NULL WHERE id = ?`).bind(c.id).run();
  return getOne(ctx, p);
}

/* ---------- Page publique (lecture seule, sans compte) ---------- */

export async function publicView(ctx: Ctx, p: Record<string, string>) {
  const c = await ctx.env.DB.prepare(
    `SELECT c.* FROM collections c JOIN users u ON u.id = c.user_id
     WHERE c.share_code = ? AND c.deleted_at IS NULL AND c.shared = 1 AND u.active = 1`
  ).bind(p.code).first<CollectionRow>();
  if (!c) throw new HttpError(404, 'not_shared', 'Ce lien n’est plus actif.');
  // Les notes sont personnelles : elles ne sont jamais montrées sur la page publique
  const items = (await itemsOf(ctx, c.id)).map(({ error, status, note, ...rest }) => rest);
  return json({
    collection: { title: c.title, description: c.description, updatedAt: c.updated_at, count: items.length },
    items
  });
}
