import { useState } from 'react';
import { Navigate, useSearchParams } from 'react-router-dom';
import { api, ApiError } from '../api';
import { useAuth } from '../context';
import { Ribbon } from '../components/Ribbon';

export default function LoginView() {
  const { user } = useAuth();
  const [params] = useSearchParams();
  const [email, setEmail] = useState('');
  const [sent, setSent] = useState<string | null>(null);
  const [devLink, setDevLink] = useState<string | null>(null);
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);

  if (user) return <Navigate to={params.get('suite') || '/'} replace />;

  async function submit() {
    setErr(''); setBusy(true);
    try {
      const r = await api.post<{ ok: boolean; devLink?: string }>('/api/auth/request', { email });
      setSent(email.trim().toLowerCase());
      setDevLink(r.devLink || null);
      try { sessionStorage.setItem('bm_next', params.get('suite') || '/'); } catch {}
    } catch (e) {
      setErr(e instanceof ApiError ? e.message : 'Envoi impossible.');
    } finally { setBusy(false); }
  }

  return (
    <div className="page ext">
      <div className="logo"><Ribbon /></div>
      <div className="narrow">
        {sent ? (
          <>
            <h1>Vérifiez vos courriels</h1>
            <p>Si un compte existe pour <strong>{sent}</strong>, un lien de connexion vient d’y être envoyé. Il expire dans 15 minutes et ne fonctionne qu’une fois.</p>
            <p>Rien reçu ? Regardez dans les courriels indésirables, ou réessayez dans une minute.</p>
            <button type="button" className="ul ink start" onClick={() => { setSent(null); setDevLink(null); }}>Utiliser une autre adresse</button>
            {devLink && <div className="protobox"><span>Mode développement : aucun courriel n’est envoyé.</span><a className="btn btn-primary" href={devLink}>Ouvrir le lien de connexion</a></div>}
          </>
        ) : (
          <>
            <h1>Connexion</h1>
            <p>Entrez votre adresse courriel. Nous vous enverrons un lien pour vous connecter, sans mot de passe.</p>
            <form noValidate onSubmit={e => { e.preventDefault(); submit(); }}>
              <label className="lbl" htmlFor="loginEmail">COURRIEL</label>
              <input className="plain" id="loginEmail" type="email" autoComplete="email" autoFocus value={email} onChange={e => setEmail(e.target.value)} />
              {err && <div className="notice err">{err}</div>}
              <button className="btn btn-primary" type="submit" disabled={busy}>Recevoir le lien de connexion</button>
            </form>
            <p className="small">bookmarks est sur invitation. Pas encore de compte ? Demandez une invitation à la personne qui gère l’app.</p>
          </>
        )}
      </div>
    </div>
  );
}
