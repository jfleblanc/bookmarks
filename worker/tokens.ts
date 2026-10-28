import { type Ctx, requireUser } from './auth';
import { HttpError, json, readJson, cleanText, randomToken, sha256, newId, now } from './util';

/* Jetons personnels : créés depuis Réglages, montrés une seule fois, révocables. */

const MAX_TOKENS = 20;

/** La gestion des jetons exige une vraie session : un jeton ne peut pas créer d'autres jetons */
function requireSession(ctx: Ctx) {
  const user = requireUser(ctx);
  if (ctx.via !== 'session') throw new HttpError(403, 'session_required', 'Action possible seulement depuis le site.');
  return user;
}

export async function list(ctx: Ctx) {
  const user = requireSession(ctx);
  const { results } = await ctx.env.DB.prepare(
    `SELECT id, name, created_at, last_used_at FROM api_tokens WHERE user_id = ? ORDER BY created_at DESC`
  ).bind(user.id).all();
  return json({ tokens: results });
}

export async function create(ctx: Ctx) {
  const user = requireSession(ctx);
  const body = await readJson<{ name?: string }>(ctx.req);
  const name = cleanText(body.name, 60) || 'Navigateur';
  const count = await ctx.env.DB.prepare(`SELECT COUNT(*) AS n FROM api_tokens WHERE user_id = ?`).bind(user.id).first<{ n: number }>();
  if (count && count.n >= MAX_TOKENS) throw new HttpError(400, 'too_many_tokens', 'Trop de navigateurs connectés. Révoquez-en un d’abord.');
  const token = `bm_${randomToken(32)}`;
  const id = newId();
  await ctx.env.DB.prepare(`INSERT INTO api_tokens (id, user_id, name, token_hash, created_at) VALUES (?, ?, ?, ?, ?)`)
    .bind(id, user.id, name, await sha256(token), now()).run();
  return json({ token: { id, name, created_at: now(), last_used_at: null }, secret: token }, 201);
}

export async function revoke(ctx: Ctx, p: Record<string, string>) {
  const user = requireSession(ctx);
  await ctx.env.DB.prepare(`DELETE FROM api_tokens WHERE id = ? AND user_id = ?`).bind(p.id, user.id).run();
  return json({ ok: true });
}
