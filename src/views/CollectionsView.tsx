import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { api, ApiError, isNetworkError, plural, shortDate, type Collection } from '../api';
import { useAuth, useOffline, useToast } from '../context';
import { loadSnapshot } from '../offline';
import { generatedPreview } from '../preview';
import { CollectionFormModal } from '../components/Dialogs';

export default function CollectionsView() {
  const [list, setList] = useState<Collection[] | null>(null);
  const [error, setError] = useState('');
  const [creating, setCreating] = useState(false);
  const navigate = useNavigate();
  const toast = useToast();
  const { user } = useAuth();
  const { offline } = useOffline();

  useEffect(() => {
    api.get<{ collections: Collection[] }>('/api/collections')
      .then(r => setList(r.collections))
      .catch(async e => {
        const s = isNetworkError(e) ? await loadSnapshot(user?.id) : null;
        if (s) setList(s.collections);
        else setError(e instanceof ApiError ? e.message : 'Chargement impossible.');
      });
  }, [user?.id, offline]);

  return (
    <section>
      <div className="vhead">
        <h1>Collections</h1>
        {!offline && <button className="btn btn-primary" type="button" onClick={() => setCreating(true)}>Nouvelle collection</button>}
      </div>
      {error ? <div className="empty"><strong>Chargement impossible</strong>{error}</div>
        : list === null ? <p className="note pad">Chargement…</p>
        : !list.length ? (
          <div className="empty"><strong>Aucune collection</strong>Regroupez des signets dans une collection pour les partager avec un lien. Créez-en une ici, ou utilisez « Sélectionner » dans vos signets.</div>
        ) : (
          <div className="coll-grid">
            {list.map(c => (
              <Link key={c.id} to={`/collections/${c.id}`} className="coll-card">
                <div className="cover" aria-hidden="true">
                  {[0, 1, 2, 3].map(i => (c.covers[i] ? <img key={i} src={c.covers[i]} alt="" loading="lazy" onError={e => { e.currentTarget.src = generatedPreview(c.covers[i]); }} /> : <span key={i} />))}
                </div>
                <h2>{c.title}</h2>
                {c.description && <p className="clamp">{c.description}</p>}
                <span className="mrow">
                  <span>{plural(c.count, 'signet', 'signets')}</span>
                  <span className={`pill${c.shared ? ' ok' : ''}`}>{c.shared ? 'partagée' : 'privée'}</span>
                  <span>modifiée {shortDate(c.updatedAt)}</span>
                </span>
              </Link>
            ))}
          </div>
        )}
      {creating && (
        <CollectionFormModal
          onClose={() => setCreating(false)}
          onSaved={c => { navigate(`/collections/${c.id}`); toast('Collection créée. Ajoutez-y des signets.'); }}
        />
      )}
    </section>
  );
}
