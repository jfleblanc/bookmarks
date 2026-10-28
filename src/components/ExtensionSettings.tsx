import { useCallback, useEffect, useRef, useState } from 'react';
import { api, ApiError, copyText, fullDate } from '../api';
import { useToast } from '../context';

interface Token { id: string; name: string; created_at: number; last_used_at: number | null }

function guessName() {
  const ua = navigator.userAgent;
  const browser = (navigator as any).brave ? 'Brave' : /Edg\//.test(ua) ? 'Edge' : /Chrome\//.test(ua) ? 'Chrome' : 'Navigateur';
  const os = /Mac OS X/.test(ua) ? 'Mac' : /Windows/.test(ua) ? 'Windows' : /Linux/.test(ua) ? 'Linux' : /CrOS/.test(ua) ? 'Chromebook' : '';
  return os ? `${browser} sur ${os}` : browser;
}

/** Réglages : connecter l'extension Chrome / Brave avec un jeton personnel */
export function ExtensionSettings() {
  const toast = useToast();
  const [tokens, setTokens] = useState<Token[]>([]);
  const [name, setName] = useState(guessName);
  const [secret, setSecret] = useState<string | null>(null);
  const [err, setErr] = useState('');
  const [confirmId, setConfirmId] = useState<string | null>(null);
  const input = useRef<HTMLInputElement>(null);

  const load = useCallback(() => {
    api.get<{ tokens: Token[] }>('/api/tokens').then(r => setTokens(r.tokens)).catch(() => {});
  }, []);
  useEffect(() => { load(); }, [load]);

  async function create() {
    setErr('');
    try {
      const r = await api.post<{ secret: string }>('/api/tokens', { name });
      setSecret(r.secret);
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
    <section>
      <h2>Extension de navigateur</h2>
      <p className="note">Ajoutez la page que vous visitez en un clic, avec ses tags et une note, depuis Chrome ou Brave sur ordinateur. Un clic droit sur un lien permet aussi de l’ajouter directement. La vignette est prise par votre navigateur : elle fonctionne même sur les sites qui bloquent les robots.</p>
      <ol className="steps">
        <li><a className="ul ink" href="/bookmarks-extension.zip" download>Télécharger l’extension</a>, puis décompressez le fichier.</li>
        <li>Ouvrez <code>brave://extensions</code> (ou <code>chrome://extensions</code>), activez le <strong>Mode développeur</strong>, puis cliquez <strong>Charger l’extension non empaquetée</strong> et choisissez le dossier décompressé.</li>
        <li>Créez un jeton ci-dessous et collez-le dans l’extension la première fois que vous l’ouvrez.</li>
      </ol>
      <p className="note">Mise à jour (version 1.1) : remplacez le contenu du dossier par la nouvelle version, puis cliquez sur la flèche de rechargement de l’extension dans <code>brave://extensions</code>. Brave demandera peut-être d’accepter la nouvelle permission.</p>

      <form className="inv" noValidate onSubmit={e => { e.preventDefault(); create(); }}>
        <label className="lbl" htmlFor="tokName">NAVIGATEUR</label>
        <input id="tokName" value={name} onChange={e => setName(e.target.value)} maxLength={60} autoComplete="off" />
        <button className="btn btn-primary" type="submit">Créer un jeton</button>
      </form>
      {err && <div className="notice err">{err}</div>}
      {secret && (
        <div className="result">
          <p>Copiez ce jeton dans l’extension maintenant : <strong>il ne sera plus affiché</strong>. Ne le partagez avec personne ; il permet d’ajouter des signets à votre compte.</p>
          <input className="linkbox" ref={input} readOnly value={secret} aria-label="Jeton de l’extension" onFocus={e => e.currentTarget.select()} />
          <button type="button" className="btn btn-primary" onClick={async () => toast((await copyText(secret, input.current)) ? 'Jeton copié.' : 'Jeton sélectionné. Copiez-le avec Ctrl+C ou Cmd+C.')}>Copier le jeton</button>
          <button type="button" className="ul ink" onClick={() => setSecret(null)}>C’est fait</button>
        </div>
      )}

      {tokens.length > 0 && (
        <div className="tblwrap"><table className="tbl">
          <thead><tr><th>Navigateur connecté</th><th>Créé</th><th>Dernière utilisation</th><th></th></tr></thead>
          <tbody>
            {tokens.map(t => (
              <tr key={t.id}>
                <td>{t.name}</td>
                <td className="m">{fullDate(t.created_at)}</td>
                <td className="m">{t.last_used_at ? fullDate(t.last_used_at) : 'jamais'}</td>
                <td className="r">
                  {confirmId === t.id
                    ? <><button type="button" className="ul danger" onClick={() => revoke(t)}>Confirmer</button><button type="button" className="ul ink" onClick={() => setConfirmId(null)}>Annuler</button></>
                    : <button type="button" className="ul danger" onClick={() => setConfirmId(t.id)}>Déconnecter</button>}
                </td>
              </tr>
            ))}
          </tbody>
        </table></div>
      )}
      <p className="note">Un jeton peut seulement ajouter et compléter vos signets : il ne peut rien supprimer, ni changer vos partages, ni accéder à l’admin. Déconnectez un navigateur perdu ou que vous n’utilisez plus.</p>

      <h2 className="sub-h">Sur téléphone</h2>
      <p className="note">Les navigateurs mobiles, Brave compris, n’acceptent pas les extensions. Sur Android, ouvrez bookmarks dans Brave ou Chrome, choisissez <strong>Ajouter à l’écran d’accueil</strong>, puis utilisez <strong>Partager → bookmarks</strong> depuis n’importe quelle page : l’adresse arrive préremplie.</p>
    </section>
  );
}
