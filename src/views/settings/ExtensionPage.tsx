import { useCallback, useEffect, useRef, useState } from 'react';
import { api, ApiError, copyText, fullDate } from '../../api';
import { useToast } from '../../context';
import { Icon } from '../../components/Icons';
import { t } from '../../i18n';
import { Subhead } from './SettingsLayout';

interface Token { id: string; name: string; created_at: number; last_used_at: number | null }

const EXT_VERSION = '1.3';

function guessName() {
  const ua = navigator.userAgent;
  const browser = (navigator as any).brave ? 'Brave' : /Edg\//.test(ua) ? 'Edge' : /Chrome\//.test(ua) ? 'Chrome' : t('Navigateur');
  const os = /Mac OS X/.test(ua) ? 'Mac' : /Windows/.test(ua) ? 'Windows' : /Linux/.test(ua) ? 'Linux' : /CrOS/.test(ua) ? 'Chromebook' : '';
  return os ? t('{browser} sur {os}', { browser, os }) : browser;
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
    if (!name.trim()) { setErr(t('Donnez un nom à ce navigateur.')); return; }
    try {
      const r = await api.post<{ secret: string }>('/api/tokens', { name });
      setSecret(r.secret);
      setAdding(false);
      load();
    } catch (e) { setErr(e instanceof ApiError ? e.message : t('Création impossible.')); }
  }
  async function revoke(tok: Token) {
    await api.del(`/api/tokens/${tok.id}`).catch(() => {});
    setConfirmId(null);
    load();
    toast(t('« {name} » est déconnecté. Son jeton ne fonctionne plus.', { name: tok.name }));
  }

  return (
    <>
      <Subhead
        title={t('Extension de navigateur')}
        action={<a className="btn-s" href="/bookmarks-extension.zip" download><Icon name="download" />{t('Télécharger (v{version})', { version: EXT_VERSION })}</a>}
      >
        {t('Ajoutez la page que vous visitez en un clic depuis Chrome ou Brave sur ordinateur, avec ses tags, une note et une collection. La vignette est prise par votre navigateur : elle fonctionne même sur les sites qui bloquent les robots.')}
      </Subhead>

      <details className="box details">
        <summary>{t('Installer ou mettre à jour l’extension')}</summary>
        <div className="details-body">
          <ol className="steps">
            <li>{t('Téléchargez l’extension avec le bouton ci-dessus, puis décompressez le fichier.')}</li>
            <li>{t('Ouvrez')} <code>brave://extensions</code> {t('(ou')} <code>chrome://extensions</code>{t(') et activez le')} <strong>{t('Mode développeur')}</strong>.</li>
            <li>{t('Cliquez')} <strong>{t('Charger l’extension non empaquetée')}</strong> {t('et choisissez le dossier décompressé.')}</li>
            <li>{t('Créez un jeton ci-dessous et collez-le dans l’extension la première fois que vous l’ouvrez.')}</li>
          </ol>
          <p className="form-note"><strong>{t('Mise à jour :')}</strong> {t('remplacez le contenu du dossier par la nouvelle version, puis cliquez la flèche de rechargement de l’extension dans')} <code>brave://extensions</code>{t('. Votre jeton est conservé. La version installée s’affiche sur la carte de l’extension.')}</p>
        </div>
      </details>

      <Subhead
        title={t('Navigateurs connectés')}
        action={!adding && <button type="button" className="btn-s primary" onClick={() => { setAdding(true); setSecret(null); }}>{t('Nouveau jeton')}</button>}
      >
        {t('Chaque navigateur a son propre jeton. Un jeton peut seulement ajouter et compléter vos signets : il ne peut rien supprimer, ni changer vos partages, ni accéder à l’administration.')}
      </Subhead>

      {adding && (
        <form className="box form-box" noValidate onSubmit={e => { e.preventDefault(); create(); }}>
          <div className="form-group">
            <label htmlFor="tokName">{t('Nom du navigateur')}</label>
            <input id="tokName" className="form-control" value={name} onChange={e => setName(e.target.value)} maxLength={60} autoComplete="off" autoFocus />
            <p className="form-note">{t('Pour le reconnaître dans la liste, par exemple « Brave au bureau ».')}</p>
            {err && <p className="form-error">{err}</p>}
          </div>
          <div className="form-actions">
            <button className="btn-s primary" type="submit">{t('Créer le jeton')}</button>
            <button className="btn-s" type="button" onClick={() => { setAdding(false); setErr(''); }}>{t('Annuler')}</button>
          </div>
        </form>
      )}

      {secret && (
        <div className="flash ok">
          <p><strong>{t('Copiez ce jeton dans l’extension maintenant : il ne sera plus affiché.')}</strong> {t('Ne le partagez avec personne ; il permet d’ajouter des signets à votre compte.')}</p>
          <div className="copy-row">
            <input className="form-control mono" ref={input} readOnly value={secret} aria-label={t('Jeton de l’extension')} onFocus={e => e.currentTarget.select()} />
            <button type="button" className="btn-s primary" onClick={async () => toast((await copyText(secret, input.current)) ? t('Jeton copié.') : t('Jeton sélectionné. Copiez-le avec Ctrl+C ou Cmd+C.'))}>{t('Copier')}</button>
            <button type="button" className="btn-s" onClick={() => setSecret(null)}>{t('C’est fait')}</button>
          </div>
        </div>
      )}

      <div className="box">
        {tokens === null ? <div className="box-row"><span className="box-main"><small>{t('Chargement…')}</small></span></div>
          : !tokens.length ? <div className="box-row blank"><span className="box-main"><strong>{t('Aucun navigateur connecté')}</strong><small>{t('Créez un jeton pour connecter l’extension.')}</small></span></div>
          : tokens.map(tok => (
            <div className="box-row" key={tok.id}>
              <span className="box-icon"><Icon name="key" size={20} /></span>
              <span className="box-main">
                <strong>{tok.name}</strong>
                <small>{t('Créé le {date}', { date: fullDate(tok.created_at) })} · {tok.last_used_at ? t('utilisé le {date}', { date: fullDate(tok.last_used_at) }) : t('jamais utilisé')}</small>
              </span>
              {confirmId === tok.id
                ? <span className="row-actions"><button type="button" className="btn-s danger" onClick={() => revoke(tok)}>{t('Confirmer')}</button><button type="button" className="btn-s" onClick={() => setConfirmId(null)}>{t('Annuler')}</button></span>
                : <button type="button" className="btn-s danger" onClick={() => setConfirmId(tok.id)}>{t('Déconnecter')}</button>}
            </div>
          ))}
      </div>

      <Subhead title={t('Sur téléphone')} />
      <div className="box">
        <div className="box-row">
          <span className="box-icon"><Icon name="phone" size={20} /></span>
          <span className="box-main">
            <strong>{t('Partager → bookmarks')}</strong>
            <small>{t('Les navigateurs mobiles n’acceptent pas les extensions. Installez plutôt l’app : dans Chrome, menu ⋮ →')} <em>{t('Installer l’application')}</em>{t('. Ensuite, depuis n’importe quelle page,')} <em>{t('Partager → bookmarks')}</em> {t('ouvre l’app avec l’adresse préremplie.')}</small>
          </span>
        </div>
      </div>
    </>
  );
}
