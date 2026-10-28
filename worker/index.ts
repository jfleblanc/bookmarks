import type { Env, CaptureJob } from './env';
import { Router } from './router';
import { type Ctx, loadUser, requestLogin, verifyLogin, logout, me, updatePrefs, getInvite, acceptInvite, appUrl } from './auth';
import * as admin from './admin';
import * as bm from './bookmarks';
import * as col from './collections';
import * as tokens from './tokens';
import { capture } from './capture';
import { HttpError, json, errorResponse } from './util';

const api = new Router<Ctx>()
  // Compte et connexion
  .post('/api/auth/request', requestLogin)
  .post('/api/auth/verify', verifyLogin)
  .post('/api/auth/logout', logout)
  .get('/api/me', me)
  .patch('/api/me/prefs', updatePrefs)
  .get('/api/invites/:token', getInvite)
  .post('/api/invites/:token/accept', acceptInvite)
  // Admin
  .get('/api/admin/members', admin.listMembers)
  .patch('/api/admin/members/:id', admin.updateMember)
  .get('/api/admin/invites', admin.listInvites)
  .post('/api/admin/invites', admin.createInvite)
  .post('/api/admin/invites/:id/renew', admin.renewInvite)
  .delete('/api/admin/invites/:id', admin.cancelInvite)
  // Signets
  .get('/api/bookmarks', bm.list)
  .get('/api/bookmarks/lite', bm.listLite)
  .get('/api/bookmarks/lookup', bm.lookup)
  .post('/api/bookmarks', bm.create)
  .get('/api/bookmarks/:id', bm.getOne)
  .patch('/api/bookmarks/:id', bm.update)
  .delete('/api/bookmarks/:id', bm.remove)
  .post('/api/bookmarks/:id/recapture', bm.recapture)
  .post('/api/bookmarks/:id/restore', bm.restore)
  .get('/api/tags', bm.listTags)
  .get('/api/thumbs/:key', bm.thumb)
  // Collections
  .get('/api/collections', col.list)
  .post('/api/collections', col.create)
  .get('/api/collections/:id', (c, p) => col.getOne(c, p))
  .patch('/api/collections/:id', col.update)
  .delete('/api/collections/:id', col.remove)
  .post('/api/collections/:id/items', col.addItems)
  .post('/api/collections/:id/regenerate', col.regenerate)
  .post('/api/collections/:id/restore-link', col.restoreLink)
  .post('/api/collections/:id/restore', col.restore)
  // Jetons personnels (extension de navigateur)
  .get('/api/tokens', tokens.list)
  .post('/api/tokens', tokens.create)
  .delete('/api/tokens/:id', tokens.revoke)
  // Page partagée (publique)
  .get('/api/public/c/:code', col.publicView);

/* Ce qu'un jeton personnel a le droit de faire : ajouter et compléter des signets, rien d'autre
   (pas de suppression, pas d'admin, pas de gestion des jetons ni du partage). */
const TOKEN_ROUTES = new Set([
  'GET /api/me',
  'GET /api/tags',
  'GET /api/bookmarks/lookup',
  'GET /api/bookmarks/:id',
  'POST /api/bookmarks',
  'PATCH /api/bookmarks/:id',
  'GET /api/collections',
  'POST /api/collections/:id/items'
]);

const SECURITY_HEADERS: Record<string, string> = {
  'x-content-type-options': 'nosniff',
  'referrer-policy': 'strict-origin-when-cross-origin'
};

async function handleApi(req: Request, env: Env, ctxExec: ExecutionContext): Promise<Response> {
  const url = new URL(req.url);
  const ctx: Ctx = { req, env, url, user: null, via: null, waitUntil: p => ctxExec.waitUntil(p), cookies: [] };
  const usesToken = req.headers.has('authorization');
  let res: Response;
  try {
    // Protection CSRF : les requêtes qui modifient des données doivent venir de l'app elle-même.
    // Une requête avec jeton n'utilise pas le témoin de session : un autre site ne peut pas la forger.
    if (!usesToken && !['GET', 'HEAD', 'OPTIONS'].includes(req.method)) {
      const origin = req.headers.get('origin');
      const allowed = new Set([url.origin, new URL(appUrl(ctx)).origin]);
      if (origin && !allowed.has(origin)) throw new HttpError(403, 'bad_origin', 'Requête refusée.');
    }
    const m = api.match(req.method, url.pathname);
    if (!m) throw new HttpError(404, 'not_found', 'Adresse d’API inconnue.');
    if (m === 'method') throw new HttpError(405, 'method_not_allowed', 'Méthode non permise.');
    ctx.user = await loadUser(ctx);
    if (usesToken && !ctx.user) throw new HttpError(401, 'invalid_token', 'Ce jeton n’est plus valide. Reconnectez l’extension depuis Réglages.');
    if (ctx.via === 'token' && !TOKEN_ROUTES.has(m.route)) throw new HttpError(403, 'token_scope', 'Action non permise avec un jeton d’extension.');
    res = await m.handler(ctx, m.params);
  } catch (e) {
    res = errorResponse(e);
  }
  const headers = new Headers(res.headers);
  for (const [k, v] of Object.entries(SECURITY_HEADERS)) headers.set(k, v);
  for (const c of ctx.cookies) headers.append('set-cookie', c);
  return new Response(res.body, { status: res.status, headers });
}

export default {
  async fetch(req: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(req.url);
    if (url.pathname.startsWith('/api/')) return handleApi(req, env, ctx);
    if (env.ASSETS) return env.ASSETS.fetch(req);
    return json({ error: 'not_found' }, 404);
  },

  async queue(batch: MessageBatch<CaptureJob>, env: Env): Promise<void> {
    let browser: any = null;
    let tried = false;
    const getBrowser = async () => {
      if (browser || tried) return browser;
      tried = true;
      if (!env.BROWSER) return null;
      try {
        const puppeteer = (await import('@cloudflare/puppeteer')).default;
        browser = await puppeteer.launch(env.BROWSER as any);
      } catch (e) {
        console.error('Impossible de lancer le navigateur', e);
      }
      return browser;
    };
    try {
      for (const msg of batch.messages) {
        try {
          await capture(env, msg.body.bookmarkId, getBrowser);
          msg.ack();
        } catch (e) {
          console.error('Traitement du signet échoué', msg.body.bookmarkId, e);
          msg.retry();
        }
      }
    } finally {
      if (browser) await browser.close().catch(() => {});
    }
  }
} satisfies ExportedHandler<Env, CaptureJob>;
