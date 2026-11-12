import { useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { api, ApiError, fullDate } from '../api';
import { useAuth } from '../context';
import { Ribbon } from '../components/Ribbon';
import { t } from '../i18n';

export default function InviteView() {
  const { token = '' } = useParams();
  const { refresh, user } = useAuth();
  const navigate = useNavigate();
  const [invite, setInvite] = useState<{ email: string; expiresAt: number } | null>(null);
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    api.get<{ email: string; expiresAt: number }>(`/api/invites/${encodeURIComponent(token)}`)
      .then(setInvite)
      .catch(e => setErr(e instanceof ApiError ? e.message : t('Invitation introuvable.')));
  }, [token]);

  async function accept() {
    setBusy(true); setErr('');
    try {
      await api.post(`/api/invites/${encodeURIComponent(token)}/accept`);
      await refresh();
      navigate('/', { replace: true });
    } catch (e) {
      setErr(e instanceof ApiError ? e.message : t('Création du compte impossible.'));
    } finally { setBusy(false); }
  }

  return (
    <div className="page ext">
      <div className="logo"><Ribbon /></div>
      <div className="narrow">
        {err ? (
          <>
            <h1>{t('Cette invitation n’est plus valide')}</h1>
            <p>{err}</p>
            <p>{t('Elle a peut-être déjà servi, été annulée ou expiré. Demandez une nouvelle invitation à la personne qui vous l’a envoyée.')}</p>
            <Link className="ul ink start" to="/connexion">{t('J’ai déjà un compte')}</Link>
          </>
        ) : !invite ? <p>{t('Chargement…')}</p> : (
          <>
            <h1>{t('Vous êtes invité·e sur bookmarks')}</h1>
            <p>{t('Cette invitation est pour')} <strong>{invite.email}</strong>{t('. Elle fonctionne une seule fois et expire le {date}.', { date: fullDate(invite.expiresAt) })}</p>
            <p>{t('bookmarks garde vos sites préférés avec une capture, des tags et des collections à partager. Vos signets ne sont visibles que par vous.')}</p>
            {user && user.email !== invite.email && <p className="small">{t('Vous êtes connecté avec {current}. Créer ce compte vous connectera avec {invited}.', { current: user.email, invited: invite.email })}</p>}
            <button type="button" className="btn btn-primary start" onClick={accept} disabled={busy}>{t('Créer mon compte')}</button>
          </>
        )}
      </div>
    </div>
  );
}
