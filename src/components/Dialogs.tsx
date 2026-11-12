import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api, ApiError, fold, plural, type Bookmark, type BookmarkLite, type Collection, type Tag } from '../api';
import { useToast } from '../context';
import { Modal } from './Modal';
import { TagInput } from './TagInput';
import { t } from '../i18n';

/* ---------- Modifier un signet ---------- */

export function EditBookmarkModal({ item, knownTags, onClose, onSaved }: {
  item: Bookmark; knownTags: Tag[]; onClose: () => void; onSaved: (b: Bookmark) => void;
}) {
  const [url, setUrl] = useState(item.url);
  const [title, setTitle] = useState(item.title || '');
  const [tags, setTags] = useState(item.tags);
  const [note, setNote] = useState(item.note || '');
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const toast = useToast();

  async function save() {
    setBusy(true); setErr('');
    try {
      const { item: b } = await api.patch<{ item: Bookmark }>(`/api/bookmarks/${item.id}`, { url, title, tags, note });
      onSaved(b); onClose(); toast(t('Modifications enregistrées.'));
    } catch (e) {
      setErr(e instanceof ApiError ? e.message : t('Enregistrement impossible.'));
    } finally { setBusy(false); }
  }
  async function recapture() {
    try {
      const { item: b } = await api.post<{ item: Bookmark }>(`/api/bookmarks/${item.id}/recapture`);
      onSaved(b); onClose(); toast(t('Nouvelle capture en cours…'));
    } catch (e) { setErr(e instanceof ApiError ? e.message : t('Action impossible.')); }
  }

  return (
    <Modal title={t('Modifier')} onClose={onClose} onSubmit={save}>
      <label><span className="lbl">URL</span><input className="plain mono" value={url} onChange={e => setUrl(e.target.value)} autoComplete="off" /></label>
      <label><span className="lbl">{t('TITRE')}</span><input className="plain" value={title} placeholder={item.domain} onChange={e => setTitle(e.target.value)} autoComplete="off" data-autofocus /></label>
      <div><span className="lbl">TAGS</span><div className="tagbox"><TagInput id="editTags" value={tags} onChange={setTags} known={knownTags} /></div></div>
      <label><span className="lbl">NOTE</span><textarea className="plain" value={note} onChange={e => setNote(e.target.value)} placeholder={t('Pourquoi ce site, ce qu’il faut y regarder… (visible par vous seul)')} maxLength={2000} /></label>
      {err && <div className="err">{err}</div>}
      <div className="row spread">
        <button type="button" className="ul ink" onClick={recapture}>{t('Refaire la capture')}</button>
        <span className="row">
          <button type="button" className="btn" onClick={onClose}>{t('Annuler')}</button>
          <button type="submit" className="btn btn-primary" disabled={busy}>{t('Enregistrer')}</button>
        </span>
      </div>
    </Modal>
  );
}

/* ---------- Ajouter des signets à une collection ---------- */

export function AddToCollectionModal({ ids, onClose, onDone }: { ids: string[]; onClose: () => void; onDone?: () => void }) {
  const [collections, setCollections] = useState<Collection[] | null>(null);
  const [title, setTitle] = useState('');
  const [err, setErr] = useState('');
  const toast = useToast();
  const navigate = useNavigate();

  useEffect(() => {
    api.get<{ collections: Collection[] }>('/api/collections').then(r => setCollections(r.collections)).catch(() => setCollections([]));
  }, []);

  async function addTo(c: Collection) {
    try {
      const r = await api.post<{ added: number; already: number }>(`/api/collections/${c.id}/items`, { bookmarkIds: ids });
      onClose(); onDone?.();
      const added = r.added ? plural(r.added, 'signet ajouté', 'signets ajoutés') : '';
      toast(
        !r.added ? t('Déjà dans « {title} ».', { title: c.title })
          : !r.already ? t('{bookmarks} à « {title} ».', { bookmarks: added, title: c.title })
          : r.already > 1 ? t('{bookmarks} à « {title} » ({n} déjà présents).', { bookmarks: added, title: c.title, n: r.already })
          : t('{bookmarks} à « {title} » ({n} déjà présent).', { bookmarks: added, title: c.title, n: r.already }),
        { label: t('Voir'), run: () => navigate(`/collections/${c.id}`) }
      );
    } catch (e) { setErr(e instanceof ApiError ? e.message : t('Ajout impossible.')); }
  }
  async function createAndAdd() {
    if (!title.trim()) { setErr(t('Donnez un titre à la nouvelle collection.')); return; }
    try {
      const r = await api.post<{ collection: Collection }>('/api/collections', { title, bookmarkIds: ids });
      onClose(); onDone?.();
      toast(t('{bookmarks} à « {title} ».', { bookmarks: plural(ids.length, 'signet ajouté', 'signets ajoutés'), title: r.collection.title }), { label: t('Voir'), run: () => navigate(`/collections/${r.collection.id}`) });
    } catch (e) { setErr(e instanceof ApiError ? e.message : t('Création impossible.')); }
  }

  return (
    <Modal title={t('Ajouter à une collection')} sub={plural(ids.length, 'signet', 'signets')} onClose={onClose} onSubmit={createAndAdd}>
      {collections === null ? <p className="note">{t('Chargement…')}</p> : collections.length > 0 && (
        <ul className="choices">
          {collections.map(c => (
            <li key={c.id}>
              <button type="button" onClick={() => addTo(c)}><span>{c.title}</span><span className="n">{plural(c.count, 'signet', 'signets')}</span></button>
            </li>
          ))}
        </ul>
      )}
      <div className="newc">
        <label><span className="lbl">{t('NOUVELLE COLLECTION')}</span><input className="plain" value={title} onChange={e => setTitle(e.target.value)} placeholder={t('Titre de la collection')} autoComplete="off" maxLength={120} /></label>
        <button type="submit" className="btn btn-primary">{t('Créer et ajouter')}</button>
      </div>
      {err && <div className="err">{err}</div>}
      <div className="row"><button type="button" className="btn" onClick={onClose}>{t('Annuler')}</button></div>
    </Modal>
  );
}

/* ---------- Créer ou modifier une collection ---------- */

export function CollectionFormModal({ collection, onClose, onSaved }: {
  collection?: Collection; onClose: () => void; onSaved: (c: Collection) => void;
}) {
  const [title, setTitle] = useState(collection?.title || '');
  const [description, setDescription] = useState(collection?.description || '');
  const [err, setErr] = useState('');
  async function save() {
    if (!title.trim()) { setErr(t('Le titre est obligatoire.')); return; }
    try {
      const r = collection
        ? await api.patch<{ collection: Collection }>(`/api/collections/${collection.id}`, { title, description })
        : await api.post<{ collection: Collection }>('/api/collections', { title, description });
      onSaved(r.collection); onClose();
    } catch (e) { setErr(e instanceof ApiError ? e.message : t('Enregistrement impossible.')); }
  }
  return (
    <Modal title={collection ? t('Modifier la collection') : t('Nouvelle collection')} onClose={onClose} onSubmit={save}>
      <label><span className="lbl">{t('TITRE')}</span><input className="plain" value={title} onChange={e => setTitle(e.target.value)} placeholder={t('Ex. : Ressources pour le projet final')} maxLength={120} autoComplete="off" /></label>
      <label><span className="lbl">DESCRIPTION</span><textarea className="plain" value={description} onChange={e => setDescription(e.target.value)} placeholder={t('À quoi sert cette collection, pour qui')} maxLength={600} /></label>
      {err && <div className="err">{err}</div>}
      <div className="row">
        <button type="button" className="btn" onClick={onClose}>{t('Annuler')}</button>
        <button type="submit" className="btn btn-primary">{collection ? t('Enregistrer') : t('Créer')}</button>
      </div>
    </Modal>
  );
}

/* ---------- Choisir les signets d'une collection ---------- */

export function PickerModal({ selectedIds, onClose, onSave }: { selectedIds: string[]; onClose: () => void; onSave: (ids: string[]) => void }) {
  const [all, setAll] = useState<BookmarkLite[] | null>(null);
  const [checked, setChecked] = useState(() => new Set(selectedIds));
  const [q, setQ] = useState('');
  useEffect(() => {
    api.get<{ items: BookmarkLite[] }>('/api/bookmarks/lite').then(r => setAll(r.items)).catch(() => setAll([]));
  }, []);
  const visible = useMemo(() => {
    const f = fold(q.trim());
    return (all || []).filter(b => !f || fold(`${b.title || ''} ${b.domain} ${b.tags.map(t => '#' + t).join(' ')}`).includes(f));
  }, [all, q]);
  function save() {
    // Garde l'ordre actuel, puis ajoute les nouveaux à la fin
    const kept = selectedIds.filter(id => checked.has(id));
    const added = [...checked].filter(id => !selectedIds.includes(id));
    onSave([...kept, ...added]);
  }
  return (
    <Modal title={t('Signets de la collection')} sub={t('Cochez les signets à inclure. Décocher retire le signet de la collection, pas de vos signets.')} onClose={onClose} onSubmit={save}>
      <input className="plain" type="search" value={q} onChange={e => setQ(e.target.value)} placeholder={t('Filtrer par titre, domaine ou #tag')} aria-label={t('Filtrer les signets')} autoComplete="off" />
      {all === null ? <p className="note">{t('Chargement…')}</p> : (
        <ul className="picklist">
          {visible.map(b => (
            <li key={b.id}>
              <label>
                <input type="checkbox" checked={checked.has(b.id)} onChange={e => {
                  const n = new Set(checked);
                  e.target.checked ? n.add(b.id) : n.delete(b.id);
                  setChecked(n);
                }} />
                <span><span className="t">{b.title || b.domain}</span><span className="d">{b.domain}{b.tags.length ? ' · ' + b.tags.map(t => '#' + t).join(' ') : ''}</span></span>
              </label>
            </li>
          ))}
          {!visible.length && <li className="note">{t('Aucun signet ne correspond.')}</li>}
        </ul>
      )}
      <div className="row">
        <button type="button" className="btn" onClick={onClose}>{t('Annuler')}</button>
        <button type="submit" className="btn btn-primary">{t('Enregistrer')}</button>
      </div>
    </Modal>
  );
}
