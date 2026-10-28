import { SERVER, call, getAuth, setAuth, clearAuth, isSavable, ApiError } from './api.js';
import { captureTab } from './capture.js';

const $ = id => document.getElementById(id);
const show = id => ['setup', 'main', 'nope'].forEach(s => ($(s).hidden = s !== id));
const fold = s => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
const normTag = t => t.trim().toLowerCase().replace(/^#+/, '').replace(/\s+/g, ' ').slice(0, 30);
const openTab = url => { chrome.tabs.create({ url }); window.close(); };

let tab = null;
let existing = null; // signet déjà enregistré pour cette page
let known = [];      // tags existants, pour l'autocomplétion
let tags = [];

/* ---------- Démarrage ---------- */
async function start() {
  [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  const auth = await getAuth();
  if (!auth) return showSetup();
  $('who').textContent = auth.email || '';
  $('logout').hidden = false;
  if (!tab || !isSavable(tab.url)) return show('nope');
  showMain();
}

function showSetup(message) {
  show('setup');
  $('who').textContent = '';
  $('logout').hidden = true;
  if (message) { $('setupErr').textContent = message; $('setupErr').hidden = false; }
  $('token').focus();
}

$('openSettings').addEventListener('click', e => { e.preventDefault(); openTab(`${SERVER}/reglages`); });
$('openApp').addEventListener('click', e => { e.preventDefault(); openTab(SERVER); });
$('logout').addEventListener('click', async () => { await clearAuth(); showSetup(); });

$('setupForm').addEventListener('submit', async e => {
  e.preventDefault();
  const token = $('token').value.trim();
  $('setupErr').hidden = true;
  if (!/^bm_[A-Za-z0-9_-]{20,}$/.test(token)) {
    $('setupErr').textContent = 'Ce n’est pas un jeton bookmarks. Il commence par « bm_ ».';
    $('setupErr').hidden = false;
    return;
  }
  try {
    const { user } = await call('GET', '/api/me', undefined, token);
    await setAuth(token, user.email);
    start();
  } catch (err) {
    $('setupErr').textContent = err.status === 401 ? 'Ce jeton n’est pas valide ou a été révoqué. Créez-en un nouveau dans Réglages.' : err.message;
    $('setupErr').hidden = false;
  }
});

/* ---------- Page courante ---------- */
async function showMain() {
  show('main');
  const url = new URL(tab.url);
  $('pageTitle').textContent = tab.title || url.hostname;
  $('pageDomain').textContent = url.hostname.replace(/^www\./, '') + url.pathname.replace(/\/$/, '');
  if (tab.favIconUrl && /^https?:/.test(tab.favIconUrl)) { $('fav').src = tab.favIconUrl; $('fav').hidden = false; }
  $('tagInput').focus();

  try {
    const [look, tagRes, colRes] = await Promise.all([
      call('GET', `/api/bookmarks/lookup?url=${encodeURIComponent(tab.url)}`),
      call('GET', '/api/tags'),
      call('GET', '/api/collections')
    ]);
    known = tagRes.tags;
    for (const c of colRes.collections) $('coll').add(new Option(c.title, c.id));
    $('collRow').hidden = !colRes.collections.length;
    if (look.item) {
      existing = look.item;
      tags = [...existing.tags];
      $('note').value = existing.note || '';
      setState('Déjà dans vos signets. Vous pouvez compléter ses tags et sa note.');
      $('submit').textContent = 'Enregistrer';
      $('shot').options[0].hidden = false;
      $('shot').value = 'keep';
      drawChips();
    }
  } catch (err) {
    if (err.status === 401) { await clearAuth(); return showSetup('Ce jeton ne fonctionne plus. Collez un nouveau jeton.'); }
    showError(err.message);
  }
}

function setState(text, done) {
  $('state').textContent = text;
  $('state').className = 'state' + (done ? ' done' : '');
  $('state').hidden = !text;
}
function showError(text) { $('addErr').textContent = text; $('addErr').hidden = !text; }

$('addForm').addEventListener('submit', async e => {
  e.preventDefault();
  commitText();
  showError('');
  $('submit').disabled = true;
  const note = $('note').value;
  const collectionId = $('coll').value;
  const shotMode = $('shot').value;
  try {
    // Capture faite par votre navigateur ; si elle échoue, le serveur la fera comme avant
    const thumb = shotMode === 'keep' ? null : await captureTab(tab, shotMode);
    const extra = thumb ? { thumb } : {};
    let id;
    if (existing) {
      await call('PATCH', `/api/bookmarks/${existing.id}`, { tags, note, ...extra });
      id = existing.id;
    } else {
      try {
        const r = await call('POST', '/api/bookmarks', { url: tab.url, tags, note, ...extra });
        id = r.item.id;
      } catch (err) {
        if (err.code !== 'duplicate') throw err;
        id = err.data.bookmark.id; // ajouté entre-temps ailleurs : on complète la fiche
        await call('PATCH', `/api/bookmarks/${id}`, { tags, note, ...extra });
      }
    }
    if (collectionId) await call('POST', `/api/collections/${collectionId}/items`, { bookmarkIds: [id] });
    $('addForm').hidden = true;
    setState(existing ? 'Signet mis à jour ✓' : (thumb ? 'Ajouté à bookmarks ✓' : 'Ajouté à bookmarks ✓ La capture se fait en arrière-plan.'), true);
    setTimeout(() => window.close(), 1600);
  } catch (err) {
    showError(err instanceof ApiError && err.status === 401 ? 'Ce jeton ne fonctionne plus. Déconnectez puis reconnectez l’extension.' : err.message);
    $('submit').disabled = false;
  }
});

// Cmd/Ctrl + Entrée depuis la note
$('note').addEventListener('keydown', e => {
  if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) { e.preventDefault(); $('addForm').requestSubmit(); }
});

/* ---------- Tags avec autocomplétion ---------- */
const input = $('tagInput');
const sugg = $('sugg');
let options = [];
let active = -1;

function drawChips() {
  $('chips').innerHTML = '';
  tags.forEach((t, i) => {
    const chip = document.createElement('span');
    chip.className = 'chip';
    chip.textContent = '#' + t;
    const x = document.createElement('button');
    x.type = 'button';
    x.textContent = '×';
    x.setAttribute('aria-label', `Retirer ${t}`);
    x.addEventListener('click', () => { tags.splice(i, 1); drawChips(); input.focus(); });
    chip.append(x);
    $('chips').append(chip);
  });
  input.placeholder = tags.length ? '' : '#…';
}
function add(raw) {
  raw.split(',').forEach(p => { const t = normTag(p); if (t && !tags.includes(t) && tags.length < 20) tags.push(t); });
  input.value = '';
  drawChips();
  suggest();
}
function commitText() { if (input.value.trim()) add(input.value); }
function suggest() {
  const q = fold(input.value.trim().replace(/^#/, ''));
  options = known
    .filter(k => !tags.includes(k.name) && (!q || fold(k.name).includes(q)))
    .sort((a, b) => (fold(a.name).startsWith(q) ? 0 : 1) - (fold(b.name).startsWith(q) ? 0 : 1) || b.count - a.count)
    .slice(0, 6)
    .map(k => ({ t: k.name, n: k.count }));
  const exact = normTag(input.value);
  if (exact && !known.some(k => k.name === exact) && !tags.includes(exact)) options.push({ t: exact, create: true });
  const open = document.activeElement === input && options.length > 0 && (q || known.length < 30);
  active = open && q ? 0 : -1;
  sugg.hidden = !open;
  input.setAttribute('aria-expanded', String(open));
  sugg.innerHTML = '';
  options.forEach((o, i) => {
    const li = document.createElement('li');
    li.setAttribute('role', 'option');
    li.setAttribute('aria-selected', String(i === active));
    if (o.create) { const s = document.createElement('span'); s.className = 'create'; s.textContent = `Créer #${o.t}`; li.append(s); }
    else { const a = document.createElement('span'); a.textContent = '#' + o.t; const n = document.createElement('span'); n.className = 'n'; n.textContent = o.n; li.append(a, n); }
    li.addEventListener('mousedown', e => { e.preventDefault(); add(o.t); });
    sugg.append(li);
  });
}
const mark = () => [...sugg.children].forEach((li, i) => li.setAttribute('aria-selected', String(i === active)));

$('tagBox').addEventListener('click', e => { if (e.target === e.currentTarget) input.focus(); });
input.addEventListener('input', () => (input.value.includes(',') ? add(input.value) : suggest()));
input.addEventListener('focus', suggest);
input.addEventListener('blur', () => setTimeout(() => { sugg.hidden = true; }, 120));
input.addEventListener('keydown', e => {
  if (e.key === 'ArrowDown' && !sugg.hidden) { e.preventDefault(); active = (active + 1) % options.length; mark(); }
  else if (e.key === 'ArrowUp' && !sugg.hidden) { e.preventDefault(); active = (active - 1 + options.length) % options.length; mark(); }
  else if (e.key === 'Enter') {
    e.preventDefault();
    if (!sugg.hidden && active >= 0 && options[active]) add(options[active].t);
    else if (input.value.trim()) add(input.value);
    else $('addForm').requestSubmit(); // Entrée sur un champ vide : ajouter
  } else if (e.key === 'Tab' && input.value.trim()) { e.preventDefault(); add(!sugg.hidden && active >= 0 ? options[active].t : input.value); }
  else if (e.key === 'Escape' && !sugg.hidden) { e.preventDefault(); sugg.hidden = true; }
  else if (e.key === 'Backspace' && !input.value && tags.length) { tags.pop(); drawChips(); suggest(); }
});

start();
