import { useCallback, useEffect, useState } from 'react';
import { plural } from '../../api';
import { useAuth, useOffline, useToast } from '../../context';
import {
  AVG_THUMB_KB, THUMB_CACHE, askPersistence, clearOffline, downloadThumbs, getThumbMode, loadSnapshot, setThumbMode, storageInfo, syncNow, type ThumbMode
} from '../../offline';
import { generatedPreview } from '../../preview';
import { Subhead } from './SettingsLayout';

const size = (bytes: number) => (bytes < 1e9 ? `${Math.max(0.1, bytes / 1e6).toFixed(bytes < 1e7 ? 1 : 0)} Mo` : `${(bytes / 1e9).toFixed(1)} Go`);
const when = (ts: number) => new Date(ts).toLocaleString('fr-CA', { day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit' });

/** Ce que cet appareil garde pour consulter bookmarks sans connexion */
export default function OfflinePage() {
  const { user } = useAuth();
  const { offline, syncedAt } = useOffline();
  const toast = useToast();
  const [mode, setMode] = useState<ThumbMode>(getThumbMode);
  const [info, setInfo] = useState<Awaited<ReturnType<typeof storageInfo>> | null>(null);
  const [counts, setCounts] = useState({ bookmarks: 0, thumbs: 0, collections: 0 });
  const [progress, setProgress] = useState<[number, number] | null>(null);
  const [confirmClear, setConfirmClear] = useState(false);

  const refresh = useCallback(async () => {
    setInfo(await storageInfo());
    const s = await loadSnapshot(user?.id);
    setCounts({ bookmarks: s?.bookmarks.length || 0, thumbs: s?.bookmarks.filter(b => b.thumbUrl).length || 0, collections: s?.collections.length || 0 });
  }, [user?.id]);
  useEffect(() => { refresh(); }, [refresh, syncedAt]);

  async function download() {
    setProgress([0, 0]);
    await syncNow();
    if (getThumbMode() === 'captures') await downloadThumbs((d, t) => setProgress([d, t]));
    setProgress(null);
    refresh();
    toast('Copie hors ligne à jour.');
  }
  async function choose(m: ThumbMode) {
    if (m === mode) return;
    setThumbMode(m);
    setMode(m);
    if (m === 'captures') {
      await askPersistence();
      if (!offline) download();
    } else {
      if ('caches' in window) await caches.delete(THUMB_CACHE).catch(() => {});
      refresh();
      toast('Captures retirées de l’appareil. Les aperçus générés les remplacent hors ligne.');
    }
  }
  async function clearAll() {
    await clearOffline();
    setConfirmClear(false);
    refresh();
    toast('Copie effacée de cet appareil. Elle sera refaite à la prochaine connexion.');
  }

  const estimate = counts.thumbs * AVG_THUMB_KB * 1000;
  const pct = info?.quota ? Math.min(100, Math.max(0.5, (info.usage / info.quota) * 100)) : 0;

  return (
    <>
      <Subhead
        title="Copie hors ligne"
        action={<button type="button" className="btn-s" disabled={offline || !!progress} onClick={download}>
          {progress ? (progress[1] ? `Téléchargement… ${progress[0]} / ${progress[1]}` : 'Mise à jour…') : 'Mettre à jour maintenant'}
        </button>}
      >
        Cet appareil garde une copie de vos signets, tags, notes et collections pour les consulter sans connexion. Les sites ajoutés hors ligne attendent et partent dès que le réseau revient. La copie se met à jour toute seule à l’ouverture et toutes les 10 minutes.
      </Subhead>
      <div className="box">
        <div className="box-row">
          <span className="box-main">
            <strong>{syncedAt ? `Copie du ${when(syncedAt)}` : 'Pas encore de copie sur cet appareil'}</strong>
            <small>{plural(counts.bookmarks, 'signet', 'signets')} · {plural(counts.collections, 'collection', 'collections')}</small>
          </span>
          <span className={`label${syncedAt ? ' ok' : ''}`}>{offline ? 'hors ligne' : syncedAt ? 'à jour' : 'à faire'}</span>
        </div>
      </div>

      <Subhead title="Vignettes hors ligne">Un choix propre à cet appareil.</Subhead>
      <div className="choice-grid" role="radiogroup" aria-label="Vignettes hors ligne">
        <button type="button" role="radio" aria-checked={mode === 'captures'} className="choice" onClick={() => choose('captures')}>
          <span className="choice-label"><span className="radio-dot" />Captures réelles</span>
          <small>Les vraies images de vos signets. Environ {size(estimate)} pour {plural(counts.thumbs, 'capture', 'captures')} (≈ {AVG_THUMB_KB} Ko chacune).</small>
        </button>
        <button type="button" role="radio" aria-checked={mode === 'previews'} className="choice" onClick={() => choose('previews')}>
          <span className="choice-label"><span className="radio-dot" />Aperçus générés</span>
          <small>Aucun espace : une page dessinée d’après le domaine, comme celle-ci.</small>
          <img className="choice-img" src={generatedPreview('exemple.ca')} alt="" width={96} height={72} />
        </button>
      </div>

      <Subhead title="Stockage" />
      {info && (
        <div className="storage">
          <div className="meter" role="img" aria-label={`${size(info.usage)} utilisés sur ${size(info.quota)}`}><span style={{ width: `${pct}%` }} /></div>
          <p className="form-note">
            {size(info.usage)} utilisés{info.quota ? ` sur ${size(info.quota)} permis par le navigateur` : ''} · {plural(info.count, 'capture', 'captures')} sur l’appareil
          </p>
          <p className="form-note">
            {info.persisted
              ? <><span className="label ok">protégé</span> Le navigateur ne videra pas cette copie, même si l’espace manque.</>
              : <><span className="label">effaçable</span> Le navigateur peut vider cette copie si l’appareil manque d’espace. Choisir « Captures réelles » demande de la protéger.</>}
          </p>
        </div>
      )}

      <Subhead title="Zone de danger" danger />
      <div className="box danger">
        <div className="box-row">
          <span className="box-main">
            <strong>Effacer la copie de cet appareil</strong>
            <small>Retire les signets et les captures gardés ici. Vos données en ligne ne changent pas, et la copie sera refaite à la prochaine connexion.</small>
          </span>
          {confirmClear
            ? <span className="row-actions"><button type="button" className="btn-s danger" onClick={clearAll}>Confirmer</button><button type="button" className="btn-s" onClick={() => setConfirmClear(false)}>Annuler</button></span>
            : <button type="button" className="btn-s danger" onClick={() => setConfirmClear(true)}>Effacer la copie</button>}
        </div>
      </div>
    </>
  );
}
