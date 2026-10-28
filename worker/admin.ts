import { type Ctx, requireAdmin, inviteLink, INVITE_TTL } from './auth';
import { HttpError, json, readJson, normalizeEmail, randomToken, sha256, newId, now } from './util';

export async function listMembers(ctx: Ctx) {
  requireAdmin(ctx);
  const { results } = await ctx.env.DB.prepare(
    `SELECT u.id, u.email, u.role, u.active, u.created_at,
            (SELECT COUNT(*) FROM bookmarks b WHERE b.user_id = u.id AND b.deleted_at IS NULL) AS bookmarks
     FROM users u ORDER BY u.role = 'admin' DESC, u.created_at`
  ).all();
  return json({ members: results.map((m: any) => ({ ...m, active: !!m.active })) });
}

export async function updateMember(ctx: Ctx, params: Record<string, string>) {
  const admin = requireAdmin(ctx);
  const body = await readJson<{ active?: boolean }>(ctx.req);
  const target = await ctx.env.DB.prepare(`SELECT id, role FROM users WHERE id = ?`).bind(params.id).first<{ id: string; role: string }>();
  if (!target) throw new HttpError(404, 'not_found', 'Membre introuvable.');
  if (target.id === admin.id || target.role === 'admin') throw new HttpError(400, 'cannot_change_admin', 'Le compte super admin ne peut pas être désactivé.');
  const active = body.active ? 1 : 0;
  const stmts = [ctx.env.DB.prepare(`UPDATE users SET active = ? WHERE id = ?`).bind(active, target.id)];
  // Désactiver ferme toutes les sessions et invalide les liens de connexion en attente
  if (!active) {
    stmts.push(ctx.env.DB.prepare(`DELETE FROM sessions WHERE user_id = ?`).bind(target.id));
    stmts.push(ctx.env.DB.prepare(`DELETE FROM login_tokens WHERE user_id = ?`).bind(target.id));
  }
  await ctx.env.DB.batch(stmts);
  return json({ ok: true, active: !!active });
}

export async function listInvites(ctx: Ctx) {
  requireAdmin(ctx);
  const { results } = await ctx.env.DB.prepare(
    `SELECT id, email, created_at, expires_at FROM invites WHERE status = 'pending' ORDER BY created_at DESC`
  ).all();
  return json({ invites: results.map((i: any) => ({ ...i, expired: i.expires_at < now() })) });
}

export async function createInvite(ctx: Ctx) {
  const admin = requireAdmin(ctx);
  const body = await readJson<{ email?: string }>(ctx.req);
  const email = normalizeEmail(body.email);
  const user = await ctx.env.DB.prepare(`SELECT id FROM users WHERE email = ?`).bind(email).first();
  if (user) throw new HttpError(409, 'already_member', 'Cette adresse a déjà un compte.');
  const pending = await ctx.env.DB.prepare(`SELECT id, expires_at FROM invites WHERE email = ? AND status = 'pending'`).bind(email).first<{ id: string; expires_at: number }>();
  if (pending && pending.expires_at > now()) {
    throw new HttpError(409, 'invite_pending', 'Une invitation est déjà en attente pour cette adresse. Utilisez « Nouveau lien » dans la liste.', { inviteId: pending.id });
  }
  if (pending) await ctx.env.DB.prepare(`UPDATE invites SET status = 'cancelled' WHERE id = ?`).bind(pending.id).run();
  const token = randomToken();
  const id = newId();
  const expiresAt = now() + INVITE_TTL;
  await ctx.env.DB.prepare(`INSERT INTO invites (id, email, token_hash, created_by, created_at, expires_at) VALUES (?, ?, ?, ?, ?, ?)`)
    .bind(id, email, await sha256(token), admin.id, now(), expiresAt).run();
  // Le lien n'est montré qu'une fois : seul son hachage est conservé
  return json({ invite: { id, email, expires_at: expiresAt }, link: inviteLink(ctx, token) }, 201);
}

export async function renewInvite(ctx: Ctx, params: Record<string, string>) {
  requireAdmin(ctx);
  const token = randomToken();
  const expiresAt = now() + INVITE_TTL;
  const row = await ctx.env.DB.prepare(
    `UPDATE invites SET token_hash = ?, created_at = ?, expires_at = ? WHERE id = ? AND status = 'pending' RETURNING id, email`
  ).bind(await sha256(token), now(), expiresAt, params.id).first<{ id: string; email: string }>();
  if (!row) throw new HttpError(404, 'not_found', 'Invitation introuvable.');
  return json({ invite: { id: row.id, email: row.email, expires_at: expiresAt }, link: inviteLink(ctx, token) });
}

export async function cancelInvite(ctx: Ctx, params: Record<string, string>) {
  requireAdmin(ctx);
  await ctx.env.DB.prepare(`UPDATE invites SET status = 'cancelled' WHERE id = ? AND status = 'pending'`).bind(params.id).run();
  return json({ ok: true });
}
