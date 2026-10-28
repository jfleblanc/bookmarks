import { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { api, fullDate, plural, type Bookmark } from '../api';
import { Ribbon } from '../components/Ribbon';
import { BookmarkCard, Masonry } from '../components/Cards';

/* Page publique d'une collection partagée : lecture seule, toujours en couleur, sans compte */
export default function PublicCollectionView() {
  const { code = '' } = useParams();
  const [data, setData] = useState<{ collection: { title: string; description: string; updatedAt: number; count: number }; items: Bookmark[] } | null>(null);
  const [gone, setGone] = useState(false);

  useEffect(() => {
    api.get<typeof data>(`/api/public/c/${encodeURIComponent(code)}`).then(setData).catch(() => setGone(true));
  }, [code]);

  useEffect(() => {
    if (data) document.title = `${data.collection.title} · bookmarks`;
    return () => { document.title = 'bookmarks'; };
  }, [data]);

  return (
    <div className="page ext">
      <div className="logo"><Ribbon /></div>
      {gone ? (
        <div className="narrow">
          <h1>Ce lien n’est plus actif</h1>
          <p>La personne qui a partagé cette collection l’a rendue privée ou a changé son lien.</p>
        </div>
      ) : !data ? <p className="note pad">Chargement…</p> : (
        <>
          <div className="pub-head">
            <p className="eyebrow">Collection partagée · {plural(data.collection.count, 'site', 'sites')} · mise à jour le {fullDate(data.collection.updatedAt)}</p>
            <h1>{data.collection.title}</h1>
            {data.collection.description && <p className="cdesc">{data.collection.description}</p>}
          </div>
          <div className="cgrid-wrap">
            {data.items.length
              ? <Masonry items={data.items} render={b => <BookmarkCard key={b.id} item={b} mode="public" />} />
              : <div className="empty"><strong>Cette collection est vide pour l’instant.</strong></div>}
          </div>
          <p className="pub-foot">Partagé avec bookmarks</p>
        </>
      )}
    </div>
  );
}
