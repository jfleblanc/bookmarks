import { useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { api, ApiError } from '../api';
import { useAuth } from '../context';
import { Ribbon } from '../components/Ribbon';

/*
  Page ouverte depuis le courriel. La connexion se fait avec un bouton (et non à l'ouverture de la page)
  parce que certains filtres de courriel, notamment dans les écoles, ouvrent les liens pour les analyser :
  le lien serait alors « utilisé » avant que la personne clique.
*/
export default function LoginLinkView() {
  const [params] = useSearchParams();
  const token = params.get('jeton') || '';
  const { refresh } = useAuth();
  const navigate = useNavigate();
  const [err, setErr] = useState(token ? '' : 'Ce lien de connexion est incomplet.');
  const [busy, setBusy] = useState(false);

  async function confirm() {
    setBusy(true); setErr('');
    try {
      await api.post('/api/auth/verify', { token });
      await refresh();
      let next = '/';
      try { next = sessionStorage.getItem('bm_next') || '/'; sessionStorage.removeItem('bm_next'); } catch {}
      navigate(next.startsWith('/') ? next : '/', { replace: true });
    } catch (e) {
      setErr(e instanceof ApiError ? e.message : 'Connexion impossible.');
    } finally { setBusy(false); }
  }

  return (
    <div className="page ext">
      <div className="logo"><Ribbon /></div>
      <div className="narrow">
        {err ? (
          <>
            <h1>Lien invalide</h1>
            <p>{err}</p>
            <Link className="btn btn-primary start" to="/connexion">Demander un nouveau lien</Link>
          </>
        ) : (
          <>
            <h1>Connexion</h1>
            <p>Cliquez pour ouvrir votre session sur cet appareil.</p>
            <button type="button" className="btn btn-primary start" onClick={confirm} disabled={busy}>{busy ? 'Connexion…' : 'Me connecter'}</button>
          </>
        )}
      </div>
    </div>
  );
}
