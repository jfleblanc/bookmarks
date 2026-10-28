import { useCallback, useEffect, useState } from 'react';
import { plural } from '../api';
import { useAuth, useOffline, useToast } from '../context';
import {
  AVG_THUMB_KB, THUMB_CACHE, askPersistence, clearOffline, downloadThumbs, getThumbMode, loadSnapshot, setThumbMode, storageInfo, syncNow, type ThumbMode
} from '../offline';
import { generatedPreview } from '../preview';

const mb = (bytes: number) => (bytes < 1e9 ? `${Math.max(0.1, bytes / 1e6).toFixed(bytes < 1e7 ? 1 : 0)} Mo` : `${(bytes / 1e9).toFixed(1)} Go`);

/** Réglages : ce que l'appareil garde pour l'utilisation hors ligne */
export function OfflineSettings() {
  const { user } = useAuth();
  const { offline, syncedAt } = useOffline();
  const toast = useToast();
  const [mode, setMode] = useState<ThumbMode>(getThumbMode);
  const [info, setInfo] = useState<Awaited<ReturnType<typeof storageInfo>> | null>(null);
  const [counts, setCounts] = useState({ bookmarks: 0, thumbs: 0 });
  const [progress, setProgress] = useState<[number, number] | null>(null);

  const refresh = useCallback(async () => {
    setInfo(await storageInfo());
    const s = await loadSnapshot(user?.id);
    setCounts({ bookmarks: s?.bookmarks.length || 0, thumbs: s?.bookmarks.filter(b => b.thumbUrl).length || 0 });
  }, [user?.id]);
  useEffect(() => { refresh(); }, [refresh, syncedAt]);

  async function download() {
    setProgress([0, 0]);
    await syncNow();
    await downloadThumbs((d, t) => setProgress([d, t]));
    setProgress(null);
    refresh();
    toast('Copie hors ligne à jour.');
  }
  async function choose(m: ThumbMode) {
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
    refresh();
    toast('Copie effacée de cet appareil. Elle sera refaite à la prochaine connexion.');
  }

  const estimate = counts.thumbs * AVG_THUMB_KB * 1000;
  const sample = counts.bookmarks ? 'exemple.ca' : 'bookmarks.jfleblanc.com';

  return (
    <section>
      <h2>Hors ligne <span className="h-note">sur cet appareil</span></h2>
      <p className="note">bookmarks garde une copie de vos signets, tags, notes et collections sur cet appareil, pour les consulter sans connexion. Les sites ajoutés hors ligne attendent et partent dès que le réseau revient.</p>
      <p className="status-line">
        {syncedAt ? <>Copie du {new Date(syncedAt).toLocaleString('fr-CA', { day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit' })} · {plural(counts.bookmarks, 'signet', 'signets')}</> : 'Pas encore de copie sur cet appareil.'}
      </p>

      <div className="field">
        <span className="lbl">VIGNETTES HORS LIGNE</span>
        <div className="opts">
          <button type="button" className="opt" aria-pressed={mode === 'captures'} onClick={() => choose('captures')}>
            Captures réelles
            <small>environ {mb(estimate)} pour {plural(counts.thumbs, 'capture', 'captures')} (≈ {AVG_THUMB_KB} Ko chacune)</small>
          </button>
          <button type="button" className="opt with-img" aria-pressed={mode === 'previews'} onClick={() => choose('previews')}>
            <img src={generatedPreview(sample)} alt="" width={64} height={48} />
            <span>Aperçus générés<small>aucun espace : une page dessinée d’après le domaine</small></span>
          </button>
        </div>
      </div>

      {info && (
        <p className="status-line">
          Sur l’appareil : {plural(info.count, 'capture', 'captures')} · {mb(info.usage)} utilisés{info.quota ? ` · ${mb(info.quota)} permis` : ''}
          {' · '}<span className={`pill${info.persisted ? ' ok' : ''}`}>{info.persisted ? 'protégé' : 'effaçable si l’espace manque'}</span>
        </p>
      )}
      <div className="cactions">
        <button type="button" className="ul ink" disabled={offline || !!progress} onClick={download}>
          {progress ? `Téléchargement… ${progress[0]} / ${progress[1]}` : 'Mettre à jour maintenant'}
        </button>
        <button type="button" className="ul danger" onClick={clearAll}>Effacer la copie de cet appareil</button>
      </div>
      <p className="note">Se déconnecter efface aussi cette copie.</p>
    </section>
  );
}
