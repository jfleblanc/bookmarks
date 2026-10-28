import { type Ctx, requireUser, publicUser, appUrl } from './auth';
import { type BookmarkRow, withTags } from './bookmarks';
import { json, now } from './util';

/* Copie complète du compte, pour l'utilisation hors ligne (une seule requête). */
export async function sync(ctx: Ctx) {
  const user = requireUser(ctx);
  const db = ctx.env.DB;
  const [{ results: rows }, { results: cols }, { results: items }] = await Promise.all([
    db.prepare(`SELECT * FROM bookmarks WHERE user_id = ? AND deleted_at IS NULL ORDER BY created_at DESC, id DESC`).bind(user.id).all<BookmarkRow>(),
    db.prepare(`SELECT * FROM collections WHERE user_id = ? AND deleted_at IS NULL ORDER BY updated_at DESC`).bind(user.id).all<any>(),
    db.prepare(
      `SELECT ci.collection_id AS c, ci.bookmark_id AS b FROM collection_items ci
       JOIN collections c ON c.id = ci.collection_id AND c.user_id = ? AND c.deleted_at IS NULL
       JOIN bookmarks b ON b.id = ci.bookmark_id AND b.deleted_at IS NULL
       ORDER BY ci.collection_id, ci.position`
    ).bind(user.id).all<{ c: string; b: string }>()
  ]);
  const bookmarks = await withTags(ctx.env, rows);
  const counts = new Map<string, number>();
  for (const b of bookmarks) for (const t of b.tags) counts.set(t, (counts.get(t) || 0) + 1);
  const byCol = new Map<string, string[]>();
  for (const it of items) byCol.set(it.c, [...(byCol.get(it.c) || []), it.b]);
  const thumbOf = new Map(bookmarks.map(b => [b.id, b.thumbUrl]));
  return json({
    syncedAt: now(),
    user: publicUser(user),
    bookmarks,
    tags: [...counts].map(([name, count]) => ({ name, count })).sort((a, b) => a.name.localeCompare(b.name)),
    collections: cols.map(c => {
      const ids = byCol.get(c.id) || [];
      return {
        id: c.id,
        title: c.title,
        description: c.description,
        shared: !!c.shared,
        shareUrl: `${appUrl(ctx)}/c/${c.share_code}`,
        count: ids.length,
        covers: ids.map(id => thumbOf.get(id)).filter(Boolean).slice(0, 4),
        createdAt: c.created_at,
        updatedAt: c.updated_at,
        itemIds: ids
      };
    })
  });
}
