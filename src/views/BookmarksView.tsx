import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { api, ApiError, fold, isNetworkError, plural, type Bookmark, type Tag } from '../api';
import { useAuth, useOffline, useToast } from '../context';
import { addPending, filterLocal, getPending, loadSnapshot, pendingAsBookmark } from '../offline';
import { BookmarkCard, Masonry, Sentinel } from '../components/Cards';
import { TagInput } from '../components/TagInput';
import { AddToCollectionModal, EditBookmarkModal } from '../components/Dialogs';

const PAGE = 24;

export default function BookmarksView() {
  const toast = useToast();
  const { user } = useAuth();
  const { offline, refreshPending } = useOffline();
  const [params, setParams] = useSearchParams();

  // Filtres gardés dans l'adresse (?tags=css,ux&mode=or) : une vue filtrée peut être mise en favori
  const selected = useMemo(() => new Set((params.get('tags') || '').split(',').filter(Boolean)), [params]);
  const mode: 'and' | 'or' = params.get('mode') === 'or' ? 'or' : 'and';
  const filterKey = `${[...selected].sort().join(',')}|${mode}`;

  const [tags, setTags] = useState<Tag[]>([]);
  const [items, setItems] = useState<Bookmark[]>([]);
  const [total, setTotal] = useState(0);
  const [cursor, setCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const loadingMore = useRef(false);
  const reqId = useRef(0);
  const localList = useRef<Bookmark[]>([]); // hors ligne : tous les signets filtrés de la copie locale
  const urlInput = useRef<HTMLInputElement>(null);

  // À l'ouverture : curseur dans le champ d'ajout (pas sur téléphone, pour ne pas ouvrir le clavier)
  useEffect(() => {
    if (!window.matchMedia('(pointer: coarse)').matches && !urlInput.current?.value) urlInput.current?.focus();
  }, []);

  const [url, setUrl] = useState('');
  const [newTags, setNewTags] = useState<string[]>([]);
  const [newNote, setNewNote] = useState('');
  const [noteOpen, setNoteOpen] = useState(false);
  const [notice, setNotice] = useState<{ text: string; err?: boolean; dupId?: string } | null>(null);
  const [adding, setAdding] = useState(false);

  const [tagQuery, setTagQuery] = useState('');
  const [drawer, setDrawer] = useState(false);
  const [selecting, setSelecting] = useState(false);
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [editing, setEditing] = useState<Bookmark | null>(null);
  const [collecting, setCollecting] = useState<string[] | null>(null);
  const [flashId, setFlashId] = useState<string | null>(null);

  const loadTags = useCallback(() => {
    api.get<{ tags: Tag[] }>('/api/tags').then(r => setTags(r.tags)).catch(async e => {
      if (isNetworkError(e)) { const s = await loadSnapshot(user?.id); if (s) setTags(s.tags); }
    });
  }, [user?.id]);

  const query = useCallback((after?: string | null) => {
    const q = new URLSearchParams({ limit: String(PAGE) });
    if (selected.size) { q.set('tags', [...selected].join(',')); q.set('mode', mode); }
    if (after) q.set('cursor', after);
    return api.get<{ items: Bookmark[]; total: number; nextCursor: string | null }>(`/api/bookmarks?${q}`);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filterKey]);

  const reload = useCallback(async () => {
    const id = ++reqId.current;
    setLoading(true); setLoadError('');
    const pending = selected.size ? [] : (await getPending()).map(pendingAsBookmark);
    try {
      const r = await query();
      if (id !== reqId.current) return;
      setItems([...pending, ...r.items]); setTotal(r.total); setCursor(r.nextCursor);
    } catch (e) {
      if (id !== reqId.current) return;
      // Hors ligne : on affiche la copie gardée sur l'appareil, filtrée localement
      const s = isNetworkError(e) ? await loadSnapshot(user?.id) : null;
      if (s) {
        localList.current = filterLocal(s, selected, mode);
        setItems([...pending, ...localList.current.slice(0, PAGE)]);
        setTotal(localList.current.length);
        setCursor(localList.current.length > PAGE ? `local:${PAGE}` : null);
      } else {
        setLoadError(isNetworkError(e) ? 'Vous êtes hors ligne et aucune copie de vos signets n’est encore enregistrée sur cet appareil.' : e instanceof ApiError ? e.message : 'Chargement impossible.');
      }
    } finally {
      if (id === reqId.current) setLoading(false);
    }
  }, [query]);

  useEffect(() => { reload(); }, [reload]);
  useEffect(() => { loadTags(); }, [loadTags]);
  // Retour du réseau : on recharge depuis le serveur
  const wasOffline = useRef(offline);
  useEffect(() => {
    if (wasOffline.current && !offline) { reload(); loadTags(); }
    wasOffline.current = offline;
  }, [offline, reload, loadTags]);

  async function loadMore() {
    if (!cursor || loadingMore.current) return;
    if (cursor.startsWith('local:')) {
      const n = Number(cursor.slice(6));
      const more = localList.current.slice(n, n + PAGE);
      setItems(cur => [...cur, ...more]);
      setCursor(n + PAGE < localList.current.length ? `local:${n + PAGE}` : null);
      return;
    }
    loadingMore.current = true;
    const id = reqId.current;
    try {
      const r = await query(cursor);
      if (id !== reqId.current) return;
      setItems(cur => [...cur, ...r.items.filter(n => !cur.some(c => c.id === n.id))]);
      setCursor(r.nextCursor);
    } catch { /* on réessaiera au prochain défilement */ }
    finally { loadingMore.current = false; }
  }

  // Les signets en cours de traitement se mettent à jour d'eux-mêmes
  const pendingIds = items.filter(i => i.status === 'processing').map(i => i.id).join(',');
  useEffect(() => {
    if (!pendingIds) return;
    const t = window.setTimeout(async () => {
      const ids = pendingIds.split(',').slice(0, 12);
      const fresh = await Promise.all(ids.map(id => api.get<{ item: Bookmark }>(`/api/bookmarks/${id}`).then(r => r.item).catch(() => null)));
      setItems(cur => cur.map(c => fresh.find(f => f?.id === c.id) || c));
    }, 2500);
    return () => window.clearTimeout(t);
  }, [pendingIds, items]);

  // Partage depuis un téléphone (PWA) : /?url=… ou /?text=… préremplit le champ
  useEffect(() => {
    const shared = params.get('url') || (params.get('text') || '').match(/https?:\/\/\S+/)?.[0];
    if (shared) {
      setUrl(shared);
      const next = new URLSearchParams(params);
      ['url', 'text', 'title'].forEach(k => next.delete(k));
      setParams(next, { replace: true });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function flash(id: string) {
    setFlashId(null);
    window.requestAnimationFrame(() => setFlashId(id));
    window.setTimeout(() => setFlashId(cur => (cur === id ? null : cur)), 1700);
  }

  function setFilter(nextSel: Set<string>, nextMode = mode) {
    const p = new URLSearchParams(params);
    if (nextSel.size) p.set('tags', [...nextSel].join(',')); else p.delete('tags');
    if (nextMode === 'or') p.set('mode', 'or'); else p.delete('mode');
    setParams(p);
    setDrawer(false);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }
  const toggleTag = (t: string) => {
    const n = new Set(selected);
    n.has(t) ? n.delete(t) : n.add(t);
    setFilter(n);
  };

  async function add() {
    if (adding) return;
    setAdding(true); setNotice(null);
    try {
      const { item } = await api.post<{ item: Bookmark }>('/api/bookmarks', { url, tags: newTags, note: newNote });
      setUrl(''); setNewTags([]); setNewNote(''); setNoteOpen(false);
      if (selected.size) setFilter(new Set());
      setItems(cur => [item, ...cur]);
      setTotal(t => t + 1);
      loadTags();
      flash(item.id);
      toast('Signet ajouté. Extraction en cours…');
    } catch (e) {
      if (isNetworkError(e)) {
        // Hors ligne : l'ajout attend sur l'appareil et partira au retour du réseau
        if (!url.trim()) { setNotice({ text: 'Collez d’abord l’adresse d’un site.', err: true }); return; }
        const p = await addPending({ url: url.trim(), tags: newTags, note: newNote });
        setUrl(''); setNewTags([]); setNewNote(''); setNoteOpen(false);
        setItems(cur => [pendingAsBookmark(p), ...cur]);
        refreshPending();
        toast('Hors ligne : le signet partira dès que vous serez connecté.');
        return;
      }
      if (e instanceof ApiError && e.code === 'duplicate') {
        setNotice({ text: `Ce site est déjà enregistré : « ${e.data.bookmark.title || e.data.bookmark.domain} ».`, dupId: e.data.bookmark.id });
      } else {
        setNotice({ text: e instanceof ApiError ? e.message : 'Ajout impossible.', err: true });
      }
    } finally { setAdding(false); }
  }

  async function openDuplicate(id: string) {
    setNotice(null);
    try {
      const { item } = await api.get<{ item: Bookmark }>(`/api/bookmarks/${id}`);
      setEditing(item);
    } catch { toast('Ce signet est introuvable.'); }
  }

  async function remove(b: Bookmark) {
    try {
      await api.del(`/api/bookmarks/${b.id}`);
      setItems(cur => cur.filter(c => c.id !== b.id));
      setTotal(t => t - 1);
      loadTags();
      toast(`« ${b.title || b.domain} » supprimé.`, {
        label: 'Annuler',
        run: async () => { await api.post(`/api/bookmarks/${b.id}/restore`); await reload(); loadTags(); flash(b.id); }
      });
    } catch (e) { toast(e instanceof ApiError ? e.message : 'Suppression impossible.'); }
  }

  function stopSelecting() { setSelecting(false); setPicked(new Set()); }

  const visibleTags = tags.filter(t => !tagQuery.trim() || fold(t.name).includes(fold(tagQuery.trim().replace(/^#/, ''))));
  const sel = [...selected];

  return (
    <section>
      <form className="add" noValidate onSubmit={e => { e.preventDefault(); add(); }}>
        <label className="lbl" htmlFor="urlInput">URL</label>
        <input className="url-input" id="urlInput" ref={urlInput} type="url" inputMode="url" placeholder="Coller une adresse" autoComplete="off"
          value={url} onChange={e => { setUrl(e.target.value); if (notice) setNotice(null); }} />
        <span className="lbl" aria-hidden="true">TAGS</span>
        <div className="tagfield"><TagInput id="addTags" value={newTags} onChange={setNewTags} known={tags} onSubmitEmpty={add} /></div>
        {!noteOpen && <button type="button" className="ul ink note-toggle" onClick={() => setNoteOpen(true)}>+ Note</button>}
        <button className="btn btn-primary" type="submit" disabled={adding}>Ajouter ↵</button>
        {noteOpen && (
          <div className="add-note">
            <label className="lbl" htmlFor="newNote">NOTE</label>
            <textarea id="newNote" value={newNote} autoFocus maxLength={2000} rows={2}
              placeholder="Pourquoi ce site, ce qu’il faut y regarder… (visible par vous seul)"
              onChange={e => setNewNote(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) { e.preventDefault(); add(); } }} />
            <button type="button" className="clear" onClick={() => { setNoteOpen(false); setNewNote(''); }}>Retirer</button>
          </div>
        )}
        {notice && (
          <div className={`notice${notice.err ? ' err' : ''}`}>
            <span>{notice.text}</span>
            {notice.dupId && <button type="button" onClick={() => openDuplicate(notice.dupId!)}>Modifier la fiche existante</button>}
          </div>
        )}
      </form>

      <div className="wrap">
        <aside className={`side${drawer ? ' open' : ''}`} aria-label="Filtres">
          <section>
            <h2>Correspondance</h2>
            <div className="mode" role="group" aria-label="Mode de filtre">
              <button type="button" aria-pressed={mode === 'and'} onClick={() => setFilter(selected, 'and')}>ET</button>
              <span className="sep" aria-hidden="true">/</span>
              <button type="button" aria-pressed={mode === 'or'} onClick={() => setFilter(selected, 'or')}>OU</button>
            </div>
            <p className="mode-hint">{mode === 'and' ? 'Les signets qui ont tous les tags choisis.' : 'Les signets qui ont au moins un des tags choisis.'}</p>
          </section>
          <section>
            <div className="side-head">
              <h2>Index des tags</h2>
              {selected.size > 0 && <button className="clear" type="button" onClick={() => setFilter(new Set())}>Effacer</button>}
            </div>
            <input className="tag-search" type="search" placeholder="Chercher un tag" aria-label="Chercher un tag" value={tagQuery} onChange={e => setTagQuery(e.target.value)} />
            <ul className="taglist">
              {visibleTags.map(t => (
                <li key={t.name}>
                  <button type="button" aria-pressed={selected.has(t.name)} onClick={() => toggleTag(t.name)}>
                    <span>{selected.has(t.name) ? '● ' : ''}{t.name}</span><sup>{t.count}</sup>
                  </button>
                </li>
              ))}
              {!visibleTags.length && <li className="muted-li">{tags.length ? 'Aucun tag trouvé.' : 'Vos tags apparaîtront ici.'}</li>}
            </ul>
          </section>
        </aside>
        {drawer && <div className="scrim" onClick={() => setDrawer(false)} />}

        <main>
          <div className="bar">
            <div className="q">
              {sel.length ? (
                <>
                  {sel.map((t, i) => (
                    <span key={t} className="q">
                      {i > 0 && <span>{mode === 'and' ? 'ET' : 'OU'}</span>}
                      <button type="button" className="f" aria-label={`Retirer le filtre ${t}`} onClick={() => toggleTag(t)}>#{t} ×</button>
                    </span>
                  ))}
                  <span>—</span>
                </>
              ) : <span>Tous les signets —</span>}
              <span>{loading ? '…' : plural(total, 'résultat', 'résultats')}</span>
            </div>
            <div className="tools">
              <button type="button" className="filters-toggle" onClick={() => setDrawer(d => !d)}>{selected.size ? `Filtres (${selected.size})` : 'Filtres'}</button>
              {items.length > 0 && !offline && <button type="button" onClick={() => (selecting ? stopSelecting() : setSelecting(true))}>{selecting ? 'Terminer la sélection' : 'Sélectionner'}</button>}
            </div>
          </div>

          {loadError ? (
            <div className="empty"><strong>Chargement impossible</strong>{loadError} <button type="button" className="ul ink" onClick={reload}>Réessayer</button></div>
          ) : !loading && !items.length ? (
            <div className="empty">
              {selected.size
                ? <><strong>Aucun signet ne correspond</strong>{mode === 'and' && selected.size > 1 ? 'Aucun signet n’a tous ces tags. Essayez le mode OU.' : 'Retirez un filtre pour voir plus de signets.'}</>
                : <><strong>Aucun signet pour l’instant</strong>Collez une adresse dans le champ URL pour ajouter votre premier site.</>}
            </div>
          ) : (
            <Masonry items={items} render={b => (
              <BookmarkCard
                key={b.id}
                item={b}
                mode="library"
                activeTags={selected}
                onTag={toggleTag}
                selecting={selecting}
                picked={picked.has(b.id)}
                onPick={() => setPicked(p => { const n = new Set(p); n.has(b.id) ? n.delete(b.id) : n.add(b.id); return n; })}
                flash={flashId === b.id}
                actions={offline || b.status === 'pending' ? undefined : <>
                  <button type="button" onClick={() => setEditing(b)}>Modifier</button>
                  <button type="button" onClick={() => setCollecting([b.id])}>+ Collection</button>
                  <button type="button" className="del" onClick={() => remove(b)}>Supprimer</button>
                </>}
              />
            )} />
          )}
          <Sentinel onVisible={loadMore} disabled={!cursor || loading} />
          {cursor && !loading && <div className="more">{plural(total - items.length, 'autre signet', 'autres signets')} à charger…</div>}
        </main>
      </div>

      {selecting && (
        <div className="selbar">
          <span className="n">{picked.size ? plural(picked.size, 'signet sélectionné', 'signets sélectionnés') : 'Touchez des cartes pour les sélectionner'}</span>
          <button type="button" className="go" disabled={!picked.size} onClick={() => setCollecting([...picked])}>Ajouter à une collection</button>
          <button type="button" onClick={stopSelecting}>Annuler</button>
        </div>
      )}
      {editing && (
        <EditBookmarkModal
          item={editing}
          knownTags={tags}
          onClose={() => setEditing(null)}
          onSaved={b => {
            setItems(cur => cur.some(c => c.id === b.id) ? cur.map(c => (c.id === b.id ? b : c)) : [b, ...cur]);
            loadTags(); flash(b.id);
          }}
        />
      )}
      {collecting && <AddToCollectionModal ids={collecting} onClose={() => setCollecting(null)} onDone={() => { if (selecting) stopSelecting(); }} />}
    </section>
  );
}
