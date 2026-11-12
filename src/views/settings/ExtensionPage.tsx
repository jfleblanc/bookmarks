import { useCallback, useEffect, useRef, useState } from 'react';
import { api, ApiError, copyText, fullDate } from '../../api';
import { useToast } from '../../context';
import { Icon } from '../../components/Icons';
import { Subhead } from './SettingsLayout';

interface Token { id: string; name: string; created_at: number; last_used_at: number | null }

const EXT_VERSION = '1.2';

function guessName() {
  const ua = navigator.userAgent;
  const browser = (navigator as any).brave ? 'Brave' : /Edg\//.test(ua) ? 'Edge' : /Chrome\//.test(ua) ? 'Chrome' : 'Navigateur';
  const os = /Mac OS X/.test(ua) ? 'Mac' : /Windows/.test(ua) ? 'Windows' : /Linux/.test(ua) ? 'Linux' : /CrOS/.test(ua) ? 'Chromebook' : '';
  return os ? `${browser} sur ${os}` : browser;
}

/** L'extension Chrome / Brave et ses jetons, présentés comme les clés SSH de GitHub */
export default function ExtensionPage() {
  const toast = useToast();
  const [tokens, setTokens] = useState<Token[] | null>(null);
  const [adding, setAdding] = useState(false);
  const [name, setName] = useState(guessName);
  const [secret, setSecret] = useState<string | null>(null);
  const [err, setErr] = useState('');
  const [confirmId, setConfirmId] = useState<string | null>(null);
  const input = useRef<HTMLInputElement>(null);

  const load = useCallback(() => {
    api.get<{ tokens: Token[] }>('/api/tokens').then(r => setTokens(r.tokens)).catch(() => setTokens([]));
  }, []);
  useEffect(() => { load(); }, [load]);

  async function create() {
    setErr('');
    if (!name.trim()) { setErr('Donnez un nom à ce navigateur.'); return; }
    try {
      const r = await api.post<{ secret: string }>('/api/tokens', { name });
      setSecret(r.secret);
      setAdding(false);
      load();
    } catch (e) { setErr(e instanceof ApiError ? e.message : 'Création impossible.'); }
  }
  async function revoke(t: Token) {
    await api.del(`/api/tokens/${t.id}`).catch(() => {});
    setConfirmId(null);
    load();
    toast(`« ${t.name} » est déconnecté. Son jeton ne fonctionne plus.`);
  }

  return (
    <>
      <Subhead
        title="Extension de navigateur"
        action={<a className="btn-s" href="/bookmarks-extension.zip" download><Icon name="download" />Télécharger (v{EXT_VERSION})</a>}
      >
        Ajoutez la page que vous visitez en un clic depuis Chrome ou Brave sur ordinateur, avec ses tags, une note et une collection. La vignette est prise par votre navigateur : elle fonctionne même sur les sites qui bloquent les robots.
      </Subhead>

      <details className="box details">
        <summary>Installer ou mettre à jour l’extension</summary>
        <div className="details-body">
          <ol className="steps">
            <li>Téléchargez l’extension avec le bouton ci-dessus, puis décompressez le fichier.</li>
            <li>Ouvrez <code>brave://extensions</code> (ou <code>chrome://extensions</code>) et activez le <strong>Mode développeur</strong>.</li>
            <li>Cliquez <strong>Charger l’extension non empaquetée</strong> et choisissez le dossier décompressé.</li>
            <li>Créez un jeton ci-dessous et collez-le dans l’extension la première fois que vous l’ouvrez.</li>
          </ol>
          <p className="form-note"><strong>Mise à jour :</strong> remplacez le contenu du dossier par la nouvelle version, puis cliquez la flèche de rechargement de l’extension dans <code>brave://extensions</code>. Votre jeton est conservé. La version installée s’affiche sur la carte de l’extension.</p>
        </div>
      </details>

      <Subhead
        title="Navigateurs connectés"
        action={!adding && <button type="button" className="btn-s primary" onClick={() => { setAdding(true); setSecret(null); }}>Nouveau jeton</button>}
      >
        Chaque navigateur a son propre jeton. Un jeton peut seulement ajouter et compléter vos signets : il ne peut rien supprimer, ni changer vos partages, ni accéder à l’administration.
      </Subhead>

      {adding && (
        <form className="box form-box" noValidate onSubmit={e => { e.preventDefault(); create(); }}>
          <div className="form-group">
            <label htmlFor="tokName">Nom du navigateur</label>
            <input id="tokName" className="form-control" value={name} onChange={e => setName(e.target.value)} maxLength={60} autoComplete="off" autoFocus />
            <p className="form-note">Pour le reconnaître dans la liste, par exemple « Brave au bureau ».</p>
            {err && <p className="form-error">{err}</p>}
          </div>
          <div className="form-actions">
            <button className="btn-s primary" type="submit">Créer le jeton</button>
            <button className="btn-s" type="button" onClick={() => { setAdding(false); setErr(''); }}>Annuler</button>
          </div>
        </form>
      )}

      {secret && (
        <div className="flash ok">
          <p><strong>Copiez ce jeton dans l’extension maintenant : il ne sera plus affiché.</strong> Ne le partagez avec personne ; il permet d’ajouter des signets à votre compte.</p>
          <div className="copy-row">
            <input className="form-control mono" ref={input} readOnly value={secret} aria-label="Jeton de l’extension" onFocus={e => e.currentTarget.select()} />
            <button type="button" className="btn-s primary" onClick={async () => toast((await copyText(secret, input.current)) ? 'Jeton copié.' : 'Jeton sélectionné. Copiez-le avec Ctrl+C ou Cmd+C.')}>Copier</button>
            <button type="button" className="btn-s" onClick={() => setSecret(null)}>C’est fait</button>
          </div>
        </div>
      )}

      <div className="box">
        {tokens === null ? <div className="box-row"><span className="box-main"><small>Chargement…</small></span></div>
          : !tokens.length ? <div className="box-row blank"><span className="box-main"><strong>Aucun navigateur connecté</strong><small>Créez un jeton pour connecter l’extension.</small></span></div>
          : tokens.map(t => (
            <div className="box-row" key={t.id}>
              <span className="box-icon"><Icon name="key" size={20} /></span>
              <span className="box-main">
                <strong>{t.name}</strong>
                <small>Créé le {fullDate(t.created_at)} · {t.last_used_at ? `utilisé le ${fullDate(t.last_used_at)}` : 'jamais utilisé'}</small>
              </span>
              {confirmId === t.id
                ? <span className="row-actions"><button type="button" className="btn-s danger" onClick={() => revoke(t)}>Confirmer</button><button type="button" className="btn-s" onClick={() => setConfirmId(null)}>Annuler</button></span>
                : <button type="button" className="btn-s danger" onClick={() => setConfirmId(t.id)}>Déconnecter</button>}
            </div>
          ))}
      </div>

      <Subhead title="Sur téléphone" />
      <div className="box">
        <div className="box-row">
          <span className="box-icon"><Icon name="phone" size={20} /></span>
          <span className="box-main">
            <strong>Partager → bookmarks</strong>
            <small>Les navigateurs mobiles n’acceptent pas les extensions. Installez plutôt l’app : dans Chrome, menu ⋮ → <em>Installer l’application</em>. Ensuite, depuis n’importe quelle page, <em>Partager → bookmarks</em> ouvre l’app avec l’adresse préremplie.</small>
          </span>
        </div>
      </div>
    </>
  );
}
