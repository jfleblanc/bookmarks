import { useEffect, useState } from 'react';
import { api, type Bookmark, type User } from '../api';
import { useAuth, useToast } from '../context';
import { Switch } from '../components/Modal';
import { Thumb } from '../components/Cards';
import { ExtensionSettings } from '../components/ExtensionSettings';

export default function SettingsView() {
  const { user, setUser } = useAuth();
  const toast = useToast();
  const [sample, setSample] = useState<Bookmark[]>([]);
  const bw = !!user?.prefs?.bw;
  const hoverColor = user?.prefs?.hoverColor !== false;

  useEffect(() => {
    api.get<{ items: Bookmark[] }>('/api/bookmarks?limit=5').then(r => setSample(r.items.filter(i => i.thumbUrl))).catch(() => {});
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

  return (
    <section>
      <div className="vhead"><h1>Réglages</h1></div>
      <div className="set">
        <section>
          <h2>Vignettes</h2>
          <p className="note">Une préférence de votre compte. Elle change seulement ce que vous voyez : les collections partagées s’affichent toujours en couleur pour les visiteurs.</p>
          <div className="field">
            <Switch checked={bw} onChange={v => save({ bw: v })} label="Vignettes en noir et blanc" />
            <p className="note">Les captures de vos signets et de vos collections s’affichent en niveaux de gris.</p>
          </div>
          <div className="field">
            <Switch checked={bw && hoverColor} disabled={!bw} onChange={v => save({ hoverColor: v })} label="Couleur au survol" />
            <p className="note">{bw ? 'La vignette reprend ses couleurs quand vous passez la souris sur la carte ou que vous y naviguez au clavier.' : 'Disponible quand les vignettes en noir et blanc sont activées.'}</p>
          </div>
          {sample.length > 0 && (
            <>
              <div className="pv">
                {sample.map(b => <figure className="card" key={b.id}><Thumb item={b} /><figcaption>{b.domain}</figcaption></figure>)}
              </div>
              <p className="note">Aperçu : passez la souris sur une vignette pour tester.</p>
            </>
          )}
        </section>
        <ExtensionSettings />
        <section>
          <h2>Compte</h2>
          <p className="note">Connecté avec <strong>{user?.email}</strong>. Pour vous reconnecter, vous recevez un lien par courriel : il n’y a pas de mot de passe.</p>
        </section>
      </div>
    </section>
  );
}
