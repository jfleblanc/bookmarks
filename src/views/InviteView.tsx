import { useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { api, ApiError, fullDate } from '../api';
import { useAuth } from '../context';
import { Ribbon } from '../components/Ribbon';

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
      .catch(e => setErr(e instanceof ApiError ? e.message : 'Invitation introuvable.'));
  }, [token]);

  async function accept() {
    setBusy(true); setErr('');
    try {
      await api.post(`/api/invites/${encodeURIComponent(token)}/accept`);
      await refresh();
      navigate('/', { replace: true });
    } catch (e) {
      setErr(e instanceof ApiError ? e.message : 'Création du compte impossible.');
    } finally { setBusy(false); }
  }

  return (
    <div className="page ext">
      <div className="logo"><Ribbon /></div>
      <div className="narrow">
        {err ? (
          <>
            <h1>Cette invitation n’est plus valide</h1>
            <p>{err}</p>
            <p>Elle a peut-être déjà servi, été annulée ou expiré. Demandez une nouvelle invitation à la personne qui vous l’a envoyée.</p>
            <Link className="ul ink start" to="/connexion">J’ai déjà un compte</Link>
          </>
        ) : !invite ? <p>Chargement…</p> : (
          <>
            <h1>Vous êtes invité·e sur bookmarks</h1>
            <p>Cette invitation est pour <strong>{invite.email}</strong>. Elle fonctionne une seule fois et expire le {fullDate(invite.expiresAt)}.</p>
            <p>bookmarks garde vos sites préférés avec une capture, des tags et des collections à partager. Vos signets ne sont visibles que par vous.</p>
            {user && user.email !== invite.email && <p className="small">Vous êtes connecté avec {user.email}. Créer ce compte vous connectera avec {invite.email}.</p>}
            <button type="button" className="btn btn-primary start" onClick={accept} disabled={busy}>Créer mon compte</button>
          </>
        )}
      </div>
    </div>
  );
}
