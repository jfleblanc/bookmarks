/*
  Test de bout en bout de l'API, sans Cloudflare : exécute le vrai Worker avec Bun
  et des substituts de D1 (SQLite de Bun), R2 (mémoire) et Queues (tableau).
  Lancer : bun test/api.test.ts
*/
import { Database } from 'bun:sqlite';
import { readFileSync, readdirSync } from 'node:fs';
import worker from '../worker/index';
import { capture } from '../worker/capture';

/* ---------- Substituts des services Cloudflare ---------- */
const sqlite = new Database(':memory:');
sqlite.exec('PRAGMA foreign_keys = ON;');
for (const f of readdirSync(new URL('../migrations/', import.meta.url)).filter(f => f.endsWith('.sql')).sort()) {
  sqlite.exec(readFileSync(new URL(`../migrations/${f}`, import.meta.url), 'utf8'));
}

const norm = (a: unknown[]) => a.map(v => (v === undefined ? null : typeof v === 'boolean' ? (v ? 1 : 0) : v));
class Stmt {
  constructor(public sql: string, public args: unknown[] = []) {}
  bind(...a: unknown[]) { return new Stmt(this.sql, a); }
  async first<T>() { return (sqlite.query(this.sql).get(...(norm(this.args) as any[])) ?? null) as T; }
  async all<T>() { return { results: sqlite.query(this.sql).all(...(norm(this.args) as any[])) as T[] }; }
  async run() { sqlite.query(this.sql).run(...(norm(this.args) as any[])); return { success: true, meta: {} }; }
  exec() { return /^\s*select/i.test(this.sql) || /returning/i.test(this.sql) ? { results: sqlite.query(this.sql).all(...(norm(this.args) as any[])) } : (sqlite.query(this.sql).run(...(norm(this.args) as any[])), { success: true }); }
}
const DB = { prepare: (sql: string) => new Stmt(sql), batch: async (s: Stmt[]) => sqlite.transaction(() => s.map(x => x.exec()))() };
const r2 = new Map<string, Uint8Array>();
const THUMBS = {
  put: async (k: string, v: Uint8Array) => { r2.set(k, v); },
  get: async (k: string) => (r2.has(k) ? { body: r2.get(k), httpMetadata: { contentType: 'image/jpeg' } } : null),
  delete: async (k: string | string[]) => { for (const x of [k].flat()) r2.delete(x); }
};
const queue: { bookmarkId: string }[] = [];
const JOBS = { send: async (m: { bookmarkId: string }) => { queue.push(m); } };
const env: any = { DB, THUMBS, JOBS, APP_URL: 'https://bm.test', ADMIN_EMAIL: 'Admin@Exemple.ca', MAIL_FROM: 'bm <no@bm.test>', DEV_MODE: '1' };

// Faux sites web pour l'extraction du titre et du favicon
const realFetch = globalThis.fetch;
globalThis.fetch = (async (input: any, init?: any) => {
  const u = String(input instanceof Request ? input.url : input);
  if (u.startsWith('https://down.example')) throw new Error('connexion refusée');
  const html = `<html><head><title>Titre de ${new URL(u).hostname}</title>
    <meta property="og:title" content="OG &amp; ${new URL(u).hostname}">
    <link rel="icon" href="/img/fav-32.png" sizes="32x32"><link rel="apple-touch-icon" href="/apple.png"></head><body>ok</body></html>`;
  return new Response(html, { headers: { 'content-type': 'text/html; charset=utf-8' } });
}) as any;
const fakeBrowser = async () => ({ newPage: async () => ({ setUserAgent: async () => {}, setViewport: async () => {}, goto: async () => {}, screenshot: async () => new Uint8Array([255, 216, 255]), close: async () => {} }) });

/* ---------- Client HTTP de test ---------- */
class Client {
  cookie = '';
  async call(method: string, path: string, body?: unknown, origin = 'https://bm.test') {
    const headers: Record<string, string> = {};
    if (this.cookie) headers.cookie = this.cookie;
    if (body !== undefined) headers['content-type'] = 'application/json';
    if (method !== 'GET') headers.origin = origin;
    const waits: Promise<unknown>[] = [];
    const res = await worker.fetch(new Request('https://bm.test' + path, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) }), env, { waitUntil: (p: Promise<unknown>) => waits.push(p), passThroughOnException() {} } as any);
    await Promise.all(waits);
    const set = res.headers.get('set-cookie');
    if (set) { const v = set.split(';')[0]; this.cookie = v.endsWith('=') ? '' : v; }
    const type = res.headers.get('content-type') || '';
    return { status: res.status, data: type.includes('json') ? await res.json() as any : await res.arrayBuffer() };
  }
  get = (p: string) => this.call('GET', p);
  post = (p: string, b: unknown = {}) => this.call('POST', p, b);
  patch = (p: string, b: unknown) => this.call('PATCH', p, b);
  del = (p: string) => this.call('DELETE', p);
}
async function runQueue() {
  while (queue.length) { const j = queue.shift()!; await capture(env, j.bookmarkId, fakeBrowser); }
}

/* ---------- Mini-framework ---------- */
let passed = 0, failed = 0;
function check(name: string, cond: unknown, detail?: unknown) {
  if (cond) { passed++; console.log('  ✓', name); }
  else { failed++; console.log('  ✗', name, detail !== undefined ? JSON.stringify(detail) : ''); }
}
async function loginAs(email: string) {
  const c = new Client();
  const r = await c.post('/api/auth/request', { email });
  const token = new URL(r.data.devLink).searchParams.get('jeton');
  const v = await c.post('/api/auth/verify', { token });
  return { c, token, verify: v };
}

/* ---------- Scénarios ---------- */
console.log('Connexion par lien magique');
const unknown = await new Client().post('/api/auth/request', { email: 'personne@exemple.ca' });
check('adresse inconnue : même réponse, aucun lien', unknown.status === 200 && !unknown.data.devLink, unknown.data);
const bad = await new Client().post('/api/auth/request', { email: 'pas-un-courriel' });
check('adresse invalide refusée', bad.status === 400);
const { c: adminC, token: adminToken, verify } = await loginAs('admin@exemple.ca');
check('premier admin créé et connecté', verify.status === 200 && adminC.cookie.startsWith('bm_session='), verify.data);
const reuse = await new Client().post('/api/auth/verify', { token: adminToken });
check('un lien ne sert qu’une fois', reuse.status === 400);
const meA = await adminC.get('/api/me');
check('/api/me renvoie le super admin', meA.data.user?.role === 'admin' && meA.data.user.email === 'admin@exemple.ca', meA.data);
const csrf = await adminC.call('POST', '/api/bookmarks', { url: 'evil.example.com' }, 'https://evil.example');
check('requête d’un autre site refusée (CSRF)', csrf.status === 403);
const anon = await new Client().get('/api/bookmarks');
check('API protégée sans session', anon.status === 401);

console.log('Signets');
const b1 = await adminC.post('/api/bookmarks', { url: 'awwwards.com', tags: ['Inspiration', '#design', 'inspiration'] });
check('ajout d’un signet', b1.status === 201 && b1.data.item.status === 'processing', b1.data);
check('tags normalisés et dédoublonnés', JSON.stringify(b1.data.item.tags.sort()) === '["design","inspiration"]', b1.data.item.tags);
const dup = await adminC.post('/api/bookmarks', { url: 'https://www.awwwards.com/?utm_source=x' });
check('doublon détecté malgré www, / et utm', dup.status === 409 && dup.data.bookmark?.id === b1.data.item.id, dup.data);
const priv = await adminC.post('/api/bookmarks', { url: 'http://192.168.0.10/admin' });
check('adresse privée refusée', priv.status === 400);
await runQueue();
const one = await adminC.get(`/api/bookmarks/${b1.data.item.id}`);
check('extraction : titre og:title décodé', one.data.item.title === 'OG & awwwards.com', one.data.item);
check('extraction : favicon 32 px préféré, adresse absolue', one.data.item.faviconUrl === 'https://awwwards.com/img/fav-32.png', one.data.item.faviconUrl);
check('capture stockée dans R2 et servie', one.data.item.status === 'ready' && one.data.item.thumbUrl?.startsWith('/api/thumbs/'));
const img = await new Client().get(one.data.item.thumbUrl);
check('vignette accessible publiquement', img.status === 200);

const urls: [string, string[]][] = [['codepen.io', ['css', 'outils']], ['developer.mozilla.org/fr/docs/Web/CSS', ['css', 'référence']], ['tympanus.net/codrops', ['inspiration', 'css']], ['https://down.example/x', ['outils']]];
const ids: string[] = [b1.data.item.id];
for (const [u, t] of urls) { const r = await adminC.post('/api/bookmarks', { url: u, tags: t }); ids.push(r.data.item.id); await new Promise(r => setTimeout(r, 2)); }
await runQueue();
const down = await adminC.get(`/api/bookmarks/${ids[4]}`);
check('site injoignable : capture quand même, titre de secours', down.data.item.status === 'ready' && down.data.item.title === 'down.example', down.data.item);

const all = await adminC.get('/api/bookmarks');
check('liste du plus récent au plus ancien', all.data.total === 5 && all.data.items[0].id === ids[4], all.data.items.map((i: any) => i.domain));
const andF = await adminC.get('/api/bookmarks?tags=css,inspiration&mode=and');
check('filtre ET', andF.data.total === 1 && andF.data.items[0].domain === 'tympanus.net', andF.data.items.map((i: any) => i.domain));
const orF = await adminC.get('/api/bookmarks?tags=design,outils&mode=or');
check('filtre OU', orF.data.total === 3, orF.data.items.map((i: any) => i.domain));
const p1 = await adminC.get('/api/bookmarks?limit=2');
const p2 = await adminC.get(`/api/bookmarks?limit=2&cursor=${p1.data.nextCursor}`);
const p3 = await adminC.get(`/api/bookmarks?limit=2&cursor=${p2.data.nextCursor}`);
const pagedIds = [...p1.data.items, ...p2.data.items, ...p3.data.items].map((i: any) => i.id);
check('pagination par curseur sans trou ni doublon', new Set(pagedIds).size === 5 && p3.data.nextCursor === null, pagedIds);
const tags = await adminC.get('/api/tags');
check('compteurs de tags', tags.data.tags.find((t: any) => t.name === 'css')?.count === 3, tags.data.tags);

const upd = await adminC.patch(`/api/bookmarks/${ids[1]}`, { title: 'CodePen perso', tags: ['js'] });
check('modification du titre et des tags', upd.data.item.title === 'CodePen perso' && upd.data.item.tags.join() === 'js', upd.data.item);
const noted = await adminC.post('/api/bookmarks', { url: 'notes.example.com', note: '  Pour le cours 3\r\n\n\n\nvoir la section grille  ' });
check('note enregistrée à la création (nettoyée)', noted.data.item.note === 'Pour le cours 3\n\nvoir la section grille', noted.data.item.note);
const noteUpd = await adminC.patch(`/api/bookmarks/${noted.data.item.id}`, { note: 'Modifiée' });
check('note modifiée', noteUpd.data.item.note === 'Modifiée');
await runQueue();
await adminC.del(`/api/bookmarks/${noted.data.item.id}`);
const tags2 = await adminC.get('/api/tags');
check('tag orphelin retiré de l’index', !tags2.data.tags.some((t: any) => t.name === 'outils' && t.count === 0));
const moved = await adminC.patch(`/api/bookmarks/${ids[1]}`, { url: 'awwwards.com' });
check('changer pour une adresse déjà enregistrée : refusé', moved.status === 409);
const newUrl = await adminC.patch(`/api/bookmarks/${ids[1]}`, { url: 'https://codepen.io/trending' });
check('nouvelle adresse : nouvelle capture lancée', newUrl.data.item.status === 'processing' && queue.length === 1);
await runQueue();

console.log('Collections');
const col = await adminC.post('/api/collections', { title: '  Ressources CSS  ', description: 'Pour le cours', bookmarkIds: [ids[2], ids[3], 'inconnu'] });
check('création avec signets (les inconnus ignorés)', col.status === 201 && col.data.items.length === 2 && col.data.collection.title === 'Ressources CSS', col.data);
const cid = col.data.collection.id;
const add = await adminC.post(`/api/collections/${cid}/items`, { bookmarkIds: [ids[3], ids[0]] });
check('ajout à une collection : doublons ignorés', add.data.added === 1 && add.data.already === 1, add.data);
const reorder = await adminC.patch(`/api/collections/${cid}`, { itemIds: [ids[0], ids[3], ids[2]] });
check('réordonner', reorder.data.items.map((i: any) => i.id).join() === [ids[0], ids[3], ids[2]].join());
const code = reorder.data.collection.shareUrl.split('/c/')[1];
const priv1 = await new Client().get(`/api/public/c/${code}`);
check('collection privée : lien inactif', priv1.status === 404);
await adminC.patch(`/api/collections/${cid}`, { shared: true });
const pub = await new Client().get(`/api/public/c/${code}`);
check('collection partagée visible sans compte', pub.status === 200 && pub.data.items.length === 3 && pub.data.collection.title === 'Ressources CSS', pub.data);
check('la page publique ne révèle pas les champs internes ni les notes', !('status' in pub.data.items[0]) && !('user_id' in pub.data.items[0]) && !('note' in pub.data.items[0]));
const regen = await adminC.post(`/api/collections/${cid}/regenerate`);
const oldGone = await new Client().get(`/api/public/c/${code}`);
check('nouveau lien : l’ancien ne fonctionne plus', oldGone.status === 404 && regen.data.collection.shareUrl.split('/c/')[1] !== code);
const back = await adminC.post(`/api/collections/${cid}/restore-link`, { shareUrl: `https://bm.test/c/${code}` });
const oldBack = await new Client().get(`/api/public/c/${code}`);
check('annuler le nouveau lien remet l’ancien', back.status === 200 && oldBack.status === 200);
const lst = await adminC.get('/api/collections');
check('liste des collections avec compteur et couvertures', lst.data.collections[0].count === 3 && lst.data.collections[0].covers.length === 3, lst.data);

console.log('Suppression et annulation');
await adminC.del(`/api/bookmarks/${ids[3]}`);
const afterDel = await adminC.get(`/api/collections/${cid}`);
const listDel = await adminC.get('/api/bookmarks');
check('signet supprimé : retiré de la liste et de la collection', afterDel.data.items.length === 2 && listDel.data.total === 4);
await adminC.post(`/api/bookmarks/${ids[3]}/restore`);
const afterRestore = await adminC.get(`/api/collections/${cid}`);
check('annuler : le signet revient à sa place dans la collection', afterRestore.data.items.map((i: any) => i.id).join() === [ids[0], ids[3], ids[2]].join());
await adminC.del(`/api/collections/${cid}`);
check('collection supprimée : lien public coupé', (await new Client().get(`/api/public/c/${code}`)).status === 404);
await adminC.post(`/api/collections/${cid}/restore`);
check('annuler : la collection et son lien reviennent', (await new Client().get(`/api/public/c/${code}`)).status === 200);

console.log('Invitations et comptes isolés');
const inv = await adminC.post('/api/admin/invites', { email: 'Etudiant@Cegep.ca' });
check('invitation créée avec un lien', inv.status === 201 && inv.data.link.startsWith('https://bm.test/invitation/'), inv.data);
const inv2 = await adminC.post('/api/admin/invites', { email: 'etudiant@cegep.ca' });
check('une seule invitation en attente par adresse', inv2.status === 409);
const invToken = inv.data.link.split('/invitation/')[1];
const preview = await new Client().get(`/api/invites/${invToken}`);
check('aperçu de l’invitation', preview.data.email === 'etudiant@cegep.ca');
const renewed = await adminC.post(`/api/admin/invites/${inv.data.invite.id}/renew`);
check('nouveau lien d’invitation : l’ancien est invalide', (await new Client().get(`/api/invites/${invToken}`)).status === 404 && renewed.data.link);
const student = new Client();
const acc = await student.post(`/api/invites/${renewed.data.link.split('/invitation/')[1]}/accept`);
check('l’invité crée son compte et est connecté', acc.status === 200 && student.cookie.startsWith('bm_session='));
const again = await new Client().post(`/api/invites/${renewed.data.link.split('/invitation/')[1]}/accept`);
check('une invitation ne sert qu’une fois', again.status === 404);
const sList = await student.get('/api/bookmarks');
check('le membre ne voit pas les signets des autres', sList.data.total === 0);
check('le membre ne peut pas lire un signet d’un autre', (await student.get(`/api/bookmarks/${ids[0]}`)).status === 404);
check('le membre ne peut pas modifier la collection d’un autre', (await student.patch(`/api/collections/${cid}`, { title: 'pirate' })).status === 404);
check('le membre n’a pas accès à l’admin', (await student.get('/api/admin/members')).status === 403);
const sb = await student.post('/api/bookmarks', { url: 'awwwards.com' });
check('chaque compte peut enregistrer le même site', sb.status === 201);
check('ajouter le signet d’un autre à sa collection : ignoré', (await student.post('/api/collections', { title: 'x', bookmarkIds: [ids[0]] })).data.items.length === 0);
const members = await adminC.get('/api/admin/members');
const sid = members.data.members.find((m: any) => m.email === 'etudiant@cegep.ca').id;
check('l’admin ne peut pas se désactiver', (await adminC.patch(`/api/admin/members/${meA.data.user.id}`, { active: false })).status === 400);
await adminC.patch(`/api/admin/members/${sid}`, { active: false });
check('membre désactivé : sa session est fermée', (await student.get('/api/me')).data.user === null);
const relog = await new Client().post('/api/auth/request', { email: 'etudiant@cegep.ca' });
check('membre désactivé : aucun lien de connexion', !relog.data.devLink);

console.log('Préférences et déconnexion');
const prefs = await adminC.patch('/api/me/prefs', { bw: true, hoverColor: false, autre: 'ignoré' });
check('préférences enregistrées (champs connus seulement)', JSON.stringify(prefs.data.prefs) === '{"bw":true,"hoverColor":false}', prefs.data);
await adminC.post('/api/auth/logout');
check('déconnexion', (await adminC.get('/api/me')).data.user === null);

let spam = 0;
for (let i = 0; i < 7; i++) if ((await new Client().post('/api/auth/request', { email: 'admin@exemple.ca' })).data.devLink) spam++;
check('limite de 5 liens par 15 minutes', spam === 4, spam); // 1 déjà utilisé plus haut

globalThis.fetch = realFetch;
console.log(`\n${passed} réussis, ${failed} échoués`);
process.exit(failed ? 1 : 0);
