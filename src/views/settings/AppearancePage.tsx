import { useEffect, useState } from 'react';
import { api, type Bookmark, type User } from '../../api';
import { useAuth, useToast } from '../../context';
import { Subhead } from './SettingsLayout';

export default function AppearancePage() {
  const { user, setUser } = useAuth();
  const toast = useToast();
  const [sample, setSample] = useState<Bookmark | null>(null);
  const bw = !!user?.prefs?.bw;
  const hoverColor = user?.prefs?.hoverColor !== false;

  useEffect(() => {
    api.get<{ items: Bookmark[] }>('/api/bookmarks?limit=10').then(r => setSample(r.items.find(i => i.thumbUrl) || null)).catch(() => {});
  }, []);

  async function save(change: Partial<User['prefs']>) {
    if (!user) return;
    const prefs = { bw, hoverColor, ...change };
    setUser({ ...user, prefs }); // affichage immédiat
    try {
      const r = await api.patch<{ prefs: User['prefs'] }>('/api/me/prefs', prefs);
      setUser({ ...user, prefs: r.prefs });
    } catch {
      setUser(user);
      toast('Le réglage n’a pas pu être enregistré.');
    }
  }

  const preview = (gray: boolean) => (
    <span className={`choice-preview${gray ? ' gray' : ''}`}>
      {sample?.thumbUrl ? <img src={sample.thumbUrl} alt="" /> : <span className="choice-blank" />}
    </span>
  );

  return (
    <>
      <Subhead title="Vignettes">
        Une préférence de votre compte, sur tous vos appareils. Elle change seulement ce que vous voyez : les collections partagées s’affichent toujours en couleur pour les visiteurs.
      </Subhead>
      <div className="choice-grid" role="radiogroup" aria-label="Couleur des vignettes">
        <button type="button" role="radio" aria-checked={!bw} className="choice" onClick={() => bw && save({ bw: false })}>
          {preview(false)}
          <span className="choice-label"><span className="radio-dot" />Couleur</span>
        </button>
        <button type="button" role="radio" aria-checked={bw} className="choice" onClick={() => !bw && save({ bw: true })}>
          {preview(true)}
          <span className="choice-label"><span className="radio-dot" />Noir et blanc</span>
        </button>
      </div>

      <label className={`check${bw ? '' : ' disabled'}`}>
        <input type="checkbox" checked={bw && hoverColor} disabled={!bw} onChange={e => save({ hoverColor: e.target.checked })} />
        <span>
          <strong>Couleur au survol</strong>
          <small>{bw ? 'La vignette reprend ses couleurs quand vous passez la souris sur la carte ou que vous y naviguez au clavier.' : 'Disponible avec les vignettes en noir et blanc.'}</small>
        </span>
      </label>
    </>
  );
}
