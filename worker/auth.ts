import type { Env, User } from './env';
import { HttpError, json, readJson, normalizeEmail, randomToken, sha256, newId, now, DAY, getCookie, cookie } from './util';

export interface Ctx {
  req: Request;
  env: Env;
  url: URL;
  user: User | null;
  /** Comment la requête est authentifiée : session du site, ou jeton personnel (extension) */
  via: 'session' | 'token' | null;
  waitUntil: (p: Promise<unknown>) => void;
  cookies: string[];
}

export function bearerToken(req: Request): string | null {
  const m = (req.headers.get('authorization') || '').match(/^Bearer\s+(bm_[A-Za-z0-9_-]{20,})$/);
  return m ? m[1] : null;
}

const SESSION_COOKIE = 'bm_session';
const SESSION_DAYS = 60;
const LOGIN_LINK_MINUTES = 15;
const INVITE_DAYS = 7;

const isSecure = (ctx: Ctx) => ctx.url.protocol === 'https:';

/* ---------- Sessions ---------- */

export async function loadUser(ctx: Ctx): Promise<User | null> {
  // Jeton personnel (extension) : la requête n'utilise jamais le témoin de session
  if (ctx.req.headers.has('authorization')) {
    const bearer = bearerToken(ctx.req);
    if (!bearer) return null;
    const hash = await sha256(bearer);
    const row = await ctx.env.DB.prepare(
      `SELECT u.*, t.id AS t_id, t.last_used_at AS t_used FROM api_tokens t JOIN users u ON u.id = t.user_id WHERE t.token_hash = ?`
    ).bind(hash).first<User & { t_id: string; t_used: number | null }>();
    if (!row || !row.active) return null;
    if (!row.t_used || now() - row.t_used > 3_600_000) {
      ctx.waitUntil(ctx.env.DB.prepare(`UPDATE api_tokens SET last_used_at = ? WHERE id = ?`).bind(now(), row.t_id).run());
    }
    ctx.via = 'token';
    const { t_id, t_used, ...user } = row;
    return user as User;
  }
  const token = getCookie(ctx.req, SESSION_COOKIE);
  if (!token) return null;
  const hash = await sha256(token);
  const row = await ctx.env.DB.prepare(
    `SELECT u.*, s.expires_at AS s_exp FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.token_hash = ?`
  ).bind(hash).first<User & { s_exp: number }>();
  if (!row || row.s_exp < now() || !row.active) return null;
  // Prolonge la session si elle a plus d'une journée
  const fresh = now() + SESSION_DAYS * DAY;
  if (fresh - row.s_exp > DAY) {
    ctx.waitUntil(ctx.env.DB.prepare(`UPDATE sessions SET expires_at = ? WHERE token_hash = ?`).bind(fresh, hash).run());
    ctx.cookies.push(cookie(SESSION_COOKIE, token, SESSION_DAYS * 86400, isSecure(ctx)));
  }
  const { s_exp, ...user } = row;
  ctx.via = 'session';
  return user as User;
}

async function createSession(ctx: Ctx, userId: string) {
  const token = randomToken();
  await ctx.env.DB.prepare(`INSERT INTO sessions (token_hash, user_id, created_at, expires_at) VALUES (?, ?, ?, ?)`)
    .bind(await sha256(token), userId, now(), now() + SESSION_DAYS * DAY).run();
  ctx.cookies.push(cookie(SESSION_COOKIE, token, SESSION_DAYS * 86400, isSecure(ctx)));
}

export function requireUser(ctx: Ctx): User {
  if (!ctx.user) throw new HttpError(401, 'unauthenticated', 'Connectez-vous pour continuer.');
  return ctx.user;
}

export function requireAdmin(ctx: Ctx): User {
  const u = requireUser(ctx);
  if (u.role !== 'admin') throw new HttpError(403, 'forbidden', 'Réservé au super admin.');
  return u;
}

/* ---------- Courriel (Resend) ---------- */

export async function sendMail(env: Env, to: string, subject: string, html: string, text: string) {
  if (!env.RESEND_API_KEY) {
    console.log(`[courriel non envoyé : RESEND_API_KEY absente] À : ${to} — ${subject}\n${text}`);
    return;
  }
  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { authorization: `Bearer ${env.RESEND_API_KEY}`, 'content-type': 'application/json' },
    body: JSON.stringify({ from: env.MAIL_FROM, to: [to], subject, html, text })
  });
  if (!res.ok) console.error('Resend a refusé le courriel', res.status, await res.text());
}

function loginEmail(link: string, code: string) {
  const spaced = `${code.slice(0, 3)} ${code.slice(3)}`;
  const text = `Bonjour,\n\nVotre code de connexion à bookmarks : ${spaced}\nTapez-le dans la fenêtre où vous l’avez demandé.\n\nOu cliquez ce lien : ${link}\n\nLe code et le lien fonctionnent une seule fois et expirent dans ${LOGIN_LINK_MINUTES} minutes.\nSi vous n’avez rien demandé, ignorez ce courriel.`;
  const html = `<div style="font-family:Helvetica,Arial,sans-serif;font-size:16px;line-height:1.5;color:#0d0d0d;max-width:480px">
    <p>Bonjour,</p>
    <p>Votre code de connexion à <strong>bookmarks</strong> :</p>
    <p style="font-family:Menlo,Consolas,monospace;font-size:32px;font-weight:700;letter-spacing:6px;margin:8px 0 4px">${spaced}</p>
    <p style="color:#5e5e5e;font-size:14px;margin-top:0">Tapez-le dans la fenêtre où vous l’avez demandé.</p>
    <p>Ou, sur cet appareil :</p>
    <p><a href="${link}" style="display:inline-block;background:#0d0d0d;color:#ffffff;padding:12px 20px;text-decoration:none;font-weight:600">Me connecter</a></p>
    <p style="color:#5e5e5e;font-size:14px">Le code et le lien fonctionnent une seule fois et expirent dans ${LOGIN_LINK_MINUTES} minutes. Si vous n’avez rien demandé, ignorez ce courriel.</p>
  </div>`;
  return { text, html };
}

/** Code à 6 chiffres, tiré au hasard de façon sûre */
function sixDigits(): string {
  const v = new Uint32Array(1);
  crypto.getRandomValues(v);
  return String(v[0] % 1_000_000).padStart(6, '0');
}
const codeHash = (userId: string, code: string) => sha256(`${userId}:${code}`);

/* ---------- Connexion par lien magique ---------- */

export async function requestLogin(ctx: Ctx) {
  const body = await readJson<{ email?: string }>(ctx.req);
  const email = normalizeEmail(body.email);
  const { env } = ctx;

  let user = await env.DB.prepare(`SELECT * FROM users WHERE email = ?`).bind(email).first<User>();

  // Premier démarrage : le compte super admin est créé à sa première demande de connexion
  if (!user && env.ADMIN_EMAIL && email === env.ADMIN_EMAIL.trim().toLowerCase()) {
    const count = await env.DB.prepare(`SELECT COUNT(*) AS n FROM users`).first<{ n: number }>();
    if (!count || count.n === 0) {
      const id = newId();
      await env.DB.prepare(`INSERT INTO users (id, email, role, active, created_at) VALUES (?, ?, 'admin', 1, ?)`).bind(id, email, now()).run();
      user = await env.DB.prepare(`SELECT * FROM users WHERE id = ?`).bind(id).first<User>();
    }
  }

  let devLink: string | undefined;
  let devCode: string | undefined;
  if (user && user.active) {
    // Limite : 5 liens par 15 minutes pour une même adresse
    const recent = await env.DB.prepare(`SELECT COUNT(*) AS n FROM login_tokens WHERE user_id = ? AND created_at > ?`)
      .bind(user.id, now() - LOGIN_LINK_MINUTES * 60_000).first<{ n: number }>();
    if (!recent || recent.n < 5) {
      const token = randomToken();
      const code = sixDigits();
      await env.DB.prepare(`INSERT INTO login_tokens (token_hash, user_id, created_at, expires_at, code_hash) VALUES (?, ?, ?, ?, ?)`)
        .bind(await sha256(token), user.id, now(), now() + LOGIN_LINK_MINUTES * 60_000, await codeHash(user.id, code)).run();
      const link = `${appUrl(ctx)}/connexion/lien?jeton=${encodeURIComponent(token)}`;
      const { text, html } = loginEmail(link, code);
      ctx.waitUntil(sendMail(env, email, `${code} : votre code de connexion à bookmarks`, html, text));
      if (env.DEV_MODE === '1') { devLink = link; devCode = code; }
    }
  }
  // Toujours la même réponse : on ne révèle pas qui a un compte
  return json({ ok: true, ...(devLink ? { devLink, devCode } : {}) });
}

export async function verifyLogin(ctx: Ctx) {
  const body = await readJson<{ token?: string }>(ctx.req);
  const token = String(body.token || '');
  if (!token) throw new HttpError(400, 'invalid_link', 'Ce lien de connexion n’est pas valide.');
  const hash = await sha256(token);
  // Marque le jeton comme utilisé de façon atomique : un seul appel peut réussir
  const res = await ctx.env.DB.prepare(
    `UPDATE login_tokens SET used_at = ? WHERE token_hash = ? AND used_at IS NULL AND expires_at > ? RETURNING user_id`
  ).bind(now(), hash, now()).first<{ user_id: string }>();
  if (!res) throw new HttpError(400, 'invalid_link', 'Ce lien a expiré ou a déjà servi. Demandez-en un nouveau.');
  const user = await ctx.env.DB.prepare(`SELECT * FROM users WHERE id = ? AND active = 1`).bind(res.user_id).first<User>();
  if (!user) throw new HttpError(403, 'inactive', 'Ce compte est désactivé.');
  await createSession(ctx, user.id);
  // Nettoyage opportuniste des jetons et sessions expirés
  ctx.waitUntil(ctx.env.DB.batch([
    ctx.env.DB.prepare(`DELETE FROM login_tokens WHERE expires_at < ?`).bind(now() - DAY),
    ctx.env.DB.prepare(`DELETE FROM sessions WHERE expires_at < ?`).bind(now())
  ]));
  return json({ ok: true });
}

/** Connexion avec le code reçu par courriel, dans la fenêtre où il a été demandé */
export async function verifyCode(ctx: Ctx) {
  const body = await readJson<{ email?: string; code?: string }>(ctx.req);
  const email = normalizeEmail(body.email);
  const code = String(body.code || '').replace(/\D/g, '');
  const fail = () => new HttpError(400, 'invalid_code', 'Ce code est incorrect ou a expiré. Vérifiez le dernier courriel reçu, ou demandez un nouveau code.');
  if (code.length !== 6) throw fail();
  const user = await ctx.env.DB.prepare(`SELECT * FROM users WHERE email = ? AND active = 1`).bind(email).first<User>();
  if (!user) throw fail();
  const hash = await codeHash(user.id, code);
  // 5 essais par code : au-delà, le code ne fonctionne plus (le lien du courriel reste valide)
  const used = await ctx.env.DB.prepare(
    `UPDATE login_tokens SET used_at = ? WHERE user_id = ? AND code_hash = ? AND used_at IS NULL AND expires_at > ? AND attempts < 5 RETURNING token_hash`
  ).bind(now(), user.id, hash, now()).first();
  if (!used) {
    await ctx.env.DB.prepare(`UPDATE login_tokens SET attempts = attempts + 1 WHERE user_id = ? AND used_at IS NULL AND expires_at > ?`)
      .bind(user.id, now()).run();
    throw fail();
  }
  await createSession(ctx, user.id);
  return json({ ok: true });
}

export async function logout(ctx: Ctx) {
  const token = getCookie(ctx.req, SESSION_COOKIE);
  if (token) await ctx.env.DB.prepare(`DELETE FROM sessions WHERE token_hash = ?`).bind(await sha256(token)).run();
  ctx.cookies.push(cookie(SESSION_COOKIE, '', 0, isSecure(ctx)));
  return json({ ok: true });
}

/* ---------- Compte ---------- */

export function publicUser(u: User) {
  let prefs = {};
  try { prefs = JSON.parse(u.prefs || '{}'); } catch {}
  return { id: u.id, email: u.email, role: u.role, prefs };
}

export async function me(ctx: Ctx) {
  return json({ user: ctx.user ? publicUser(ctx.user) : null });
}

export async function updatePrefs(ctx: Ctx) {
  const user = requireUser(ctx);
  const body = await readJson<Record<string, unknown>>(ctx.req);
  let prefs: Record<string, unknown> = {};
  try { prefs = JSON.parse(user.prefs || '{}'); } catch {}
  if ('bw' in body) prefs.bw = !!body.bw;
  if ('hoverColor' in body) prefs.hoverColor = !!body.hoverColor;
  await ctx.env.DB.prepare(`UPDATE users SET prefs = ? WHERE id = ?`).bind(JSON.stringify(prefs), user.id).run();
  return json({ prefs });
}

/* ---------- Invitations (côté invité) ---------- */

export const INVITE_TTL = INVITE_DAYS * DAY;

export function appUrl(ctx: Ctx): string {
  const v = (ctx.env.APP_URL || '').replace(/\/+$/, '');
  return v.startsWith('http') ? v : ctx.url.origin;
}

export function inviteLink(ctx: Ctx, token: string) {
  return `${appUrl(ctx)}/invitation/${encodeURIComponent(token)}`;
}

async function findInvite(ctx: Ctx, token: string) {
  return ctx.env.DB.prepare(`SELECT * FROM invites WHERE token_hash = ?`).bind(await sha256(token))
    .first<{ id: string; email: string; status: string; expires_at: number; created_by: string }>();
}

export async function getInvite(ctx: Ctx, params: Record<string, string>) {
  const inv = await findInvite(ctx, params.token);
  if (!inv || inv.status !== 'pending' || inv.expires_at < now()) {
    throw new HttpError(404, 'invalid_invite', 'Cette invitation n’est plus valide.');
  }
  return json({ email: inv.email, expiresAt: inv.expires_at });
}

export async function acceptInvite(ctx: Ctx, params: Record<string, string>) {
  const inv = await findInvite(ctx, params.token);
  if (!inv || inv.status !== 'pending' || inv.expires_at < now()) {
    throw new HttpError(404, 'invalid_invite', 'Cette invitation n’est plus valide.');
  }
  const existing = await ctx.env.DB.prepare(`SELECT id FROM users WHERE email = ?`).bind(inv.email).first<{ id: string }>();
  if (existing) throw new HttpError(409, 'already_member', 'Cette adresse a déjà un compte. Connectez-vous avec un lien par courriel.');
  // Accepte l'invitation une seule fois, même si deux requêtes arrivent en même temps
  const claimed = await ctx.env.DB.prepare(`UPDATE invites SET status = 'accepted' WHERE id = ? AND status = 'pending' RETURNING id`).bind(inv.id).first();
  if (!claimed) throw new HttpError(404, 'invalid_invite', 'Cette invitation n’est plus valide.');
  const id = newId();
  await ctx.env.DB.prepare(`INSERT INTO users (id, email, role, active, invited_by, created_at) VALUES (?, ?, 'member', 1, ?, ?)`)
    .bind(id, inv.email, inv.created_by, now()).run();
  await createSession(ctx, id);
  return json({ ok: true });
}
