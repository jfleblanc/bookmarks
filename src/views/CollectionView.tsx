import { useCallback, useEffect, useRef, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { api, ApiError, copyText, isNetworkError, plural, shortDate, type Bookmark, type Collection } from '../api';
import { useAuth, useOffline, useToast } from '../context';
import { loadSnapshot, localCollection } from '../offline';
import { BookmarkCard, Masonry } from '../components/Cards';
import { CollectionFormModal, PickerModal } from '../components/Dialogs';
import { Switch } from '../components/Modal';

export default function CollectionView() {
  const { id } = useParams();
  const navigate = useNavigate();
  const toast = useToast();
  const { user } = useAuth();
  const { offline } = useOffline();
  const [col, setCol] = useState<Collection | null>(null);
  const [items, setItems] = useState<Bookmark[]>([]);
  const [error, setError] = useState('');
  const [editing, setEditing] = useState(false);
  const [picking, setPicking] = useState(false);
  const linkInput = useRef<HTMLInputElement>(null);

  const apply = (r: { collection: Collection; items: Bookmark[] }) => { setCol(r.collection); setItems(r.items); };

  const load = useCallback(() => {
    api.get<{ collection: Collection; items: Bookmark[] }>(`/api/collections/${id}`)
      .then(apply)
      .catch(async e => {
        const s = isNetworkError(e) ? await loadSnapshot(user?.id) : null;
        const local = s && id ? localCollection(s, id) : null;
        if (local) apply(local);
        else setError(e instanceof ApiError && e.status === 404 ? 'Cette collection n’existe pas ou a été supprimée.' : isNetworkError(e) ? 'Vous êtes hors ligne et cette collection n’est pas dans la copie de l’appareil.' : 'Chargement impossible.');
      });
  }, [id, user?.id, offline]);
  useEffect(() => { load(); }, [load]);

  async function patch(body: Record<string, unknown>) {
    try {
      apply(await api.patch(`/api/collections/${id}`, body));
      return true;
    } catch (e) {
      toast(e instanceof ApiError ? e.message : 'Modification impossible.');
      return false;
    }
  }

  async function toggleShare(v: boolean) {
    if (await patch({ shared: v })) toast(v ? 'Partage activé. Le lien fonctionne.' : 'Partage désactivé. Le lien ne fonctionne plus.');
  }
  async function copy() {
    if (!col) return;
    toast((await copyText(col.shareUrl, linkInput.current)) ? 'Lien copié.' : 'Lien sélectionné. Copiez-le avec Ctrl+C ou Cmd+C.');
  }
  async function regenerate() {
    if (!col) return;
    const old = col.shareUrl;
    try {
      apply(await api.post(`/api/collections/${id}/regenerate`));
      toast('Nouveau lien créé. L’ancien ne fonctionne plus.', {
        label: 'Annuler',
        run: async () => { try { apply(await api.post(`/api/collections/${id}/restore-link`, { shareUrl: old })); } catch { toast('L’ancien lien n’a pas pu être remis.'); } }
      });
    } catch { toast('Action impossible.'); }
  }
  async function remove() {
    if (!col) return;
    try {
      await api.del(`/api/collections/${id}`);
      navigate('/collections');
      toast(`Collection « ${col.title} » supprimée. Vos signets sont intacts.`, {
        label: 'Annuler',
        run: async () => { await api.post(`/api/collections/${id}/restore`); navigate(`/collections/${id}`); }
      });
    } catch { toast('Suppression impossible.'); }
  }
  function move(bid: string, dir: -1 | 1) {
    const ids = items.map(i => i.id);
    const i = ids.indexOf(bid), j = i + dir;
    if (j < 0 || j >= ids.length) return;
    [ids[i], ids[j]] = [ids[j], ids[i]];
    setItems(ids.map(x => items.find(it => it.id === x)!));
    patch({ itemIds: ids });
  }
  async function takeOut(b: Bookmark) {
    const before = items.map(i => i.id);
    if (await patch({ itemIds: before.filter(x => x !== b.id) })) {
      toast('Signet retiré de la collection.', { label: 'Annuler', run: () => patch({ itemIds: before }) });
    }
  }

  if (error) return <section><div className="crumb"><Link to="/collections">← Collections</Link></div><div className="empty"><strong>Introuvable</strong>{error}</div></section>;
  if (!col) return <section><p className="note pad">Chargement…</p></section>;

  return (
    <section>
      <div className="crumb"><Link to="/collections">← Collections</Link></div>
      <div className="vhead">
        <h1>{col.title}</h1>
        <span className="mrow"><span>{plural(items.length, 'signet', 'signets')}</span><span>modifiée {shortDate(col.updatedAt)}</span></span>
      </div>
      <p className={`cdesc${col.description ? '' : ' faint'}`}>{col.description || 'Pas de description.'}</p>
      {!offline && <><div className="cactions">
        <button type="button" className="ul ink" onClick={() => setEditing(true)}>Modifier le titre et la description</button>
        <button type="button" className="ul ink" onClick={() => setPicking(true)}>Ajouter ou retirer des signets</button>
        <button type="button" className="ul danger" onClick={remove}>Supprimer la collection</button>
      </div>
      <div className="share">
        <Switch checked={col.shared} onChange={toggleShare} label={col.shared ? 'Partage activé' : 'Partage désactivé'} />
        <input className="linkbox" ref={linkInput} readOnly value={col.shareUrl} aria-label="Lien de partage" disabled={!col.shared} />
        <button type="button" className="btn btn-primary" onClick={copy} disabled={!col.shared}>Copier le lien</button>
        {col.shared && <a className="ul ink" href={col.shareUrl} target="_blank" rel="noopener noreferrer">Voir comme visiteur ↗</a>}
        <button type="button" className="ul ink" onClick={regenerate}>Nouveau lien</button>
        <p className="hint">{col.shared
          ? 'Toute personne qui a ce lien peut voir la collection, sans compte. Elle ne peut rien modifier.'
          : 'Le lien ne fonctionne pas tant que le partage est désactivé. Vous seul voyez cette collection.'}</p>
      </div></>}
      <div className="cgrid-wrap">
        {items.length ? (
          <Masonry items={items} render={b => (
            <BookmarkCard key={b.id} item={b} mode="owner" actions={offline ? undefined : <>
              <button type="button" onClick={() => move(b.id, -1)}>Monter</button>
              <button type="button" onClick={() => move(b.id, 1)}>Descendre</button>
              <button type="button" className="del" onClick={() => takeOut(b)}>Retirer</button>
            </>} />
          )} />
        ) : (
          <div className="empty"><strong>Collection vide</strong>Ajoutez des signets avec « Ajouter ou retirer des signets », ou depuis vos signets avec « + Collection ».</div>
        )}
      </div>
      {editing && <CollectionFormModal collection={col} onClose={() => setEditing(false)} onSaved={() => { load(); toast('Collection mise à jour.'); }} />}
      {picking && <PickerModal selectedIds={items.map(i => i.id)} onClose={() => setPicking(false)} onSave={async ids => { setPicking(false); if (await patch({ itemIds: ids })) toast('Collection mise à jour.'); }} />}
    </section>
  );
}
