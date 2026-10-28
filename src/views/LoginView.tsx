import { useState } from 'react';
import { Navigate, useNavigate, useSearchParams } from 'react-router-dom';
import { api, ApiError } from '../api';
import { useAuth } from '../context';
import { Ribbon } from '../components/Ribbon';

export default function LoginView() {
  const { user, refresh } = useAuth();
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const [email, setEmail] = useState('');
  const [sent, setSent] = useState<string | null>(null);
  const [code, setCode] = useState('');
  const [dev, setDev] = useState<{ link?: string; code?: string } | null>(null);
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);

  if (user) return <Navigate to={params.get('suite') || '/'} replace />;

  async function submit() {
    setErr(''); setBusy(true);
    try {
      const r = await api.post<{ ok: boolean; devLink?: string; devCode?: string }>('/api/auth/request', { email });
      setSent(email.trim().toLowerCase());
      setCode('');
      setDev(r.devLink ? { link: r.devLink, code: r.devCode } : null);
      try { sessionStorage.setItem('bm_next', params.get('suite') || '/'); } catch {}
    } catch (e) {
      setErr(e instanceof ApiError ? e.message : 'Envoi impossible.');
    } finally { setBusy(false); }
  }

  async function verify(value = code) {
    const digits = value.replace(/\D/g, '');
    if (digits.length !== 6 || busy) return;
    setErr(''); setBusy(true);
    try {
      await api.post('/api/auth/code', { email: sent, code: digits });
      await refresh();
      const next = params.get('suite') || '/';
      navigate(next.startsWith('/') ? next : '/', { replace: true });
    } catch (e) {
      setErr(e instanceof ApiError ? e.message : 'Connexion impossible.');
      setBusy(false);
    }
  }

  return (
    <div className="page ext">
      <div className="logo"><Ribbon /></div>
      <div className="narrow">
        {sent ? (
          <>
            <h1>Vérifiez vos courriels</h1>
            <p>Si un compte existe pour <strong>{sent}</strong>, un code à 6 chiffres vient d’y être envoyé. Tapez-le ici pour vous connecter dans cette fenêtre.</p>
            <form noValidate onSubmit={e => { e.preventDefault(); verify(); }}>
              <label className="lbl" htmlFor="loginCode">CODE</label>
              <input
                className="plain code-input"
                id="loginCode"
                inputMode="numeric"
                autoComplete="one-time-code"
                autoFocus
                maxLength={7}
                placeholder="123 456"
                value={code}
                onChange={e => {
                  const v = e.target.value.replace(/[^\d ]/g, '');
                  setCode(v);
                  if (v.replace(/\D/g, '').length === 6) verify(v);
                }}
              />
              {err && <div className="notice err">{err}</div>}
              <button className="btn btn-primary" type="submit" disabled={busy || code.replace(/\D/g, '').length !== 6}>{busy ? 'Connexion…' : 'Me connecter'}</button>
            </form>
            <p className="small">Le code expire dans 15 minutes. Le courriel contient aussi un lien : il ouvre une session dans le navigateur qui l’ouvre, qui n’est pas forcément celui-ci. Rien reçu ? Regardez dans les courriels indésirables.</p>
            <button type="button" className="ul ink start" onClick={() => { setSent(null); setDev(null); setErr(''); }}>Utiliser une autre adresse</button>
            {dev && (
              <div className="protobox">
                <span>Mode développement : aucun courriel n’est envoyé. Code : <strong>{dev.code}</strong></span>
                {dev.link && <a className="btn btn-primary" href={dev.link}>Ouvrir le lien de connexion</a>}
              </div>
            )}
          </>
        ) : (
          <>
            <h1>Connexion</h1>
            <p>Entrez votre adresse courriel. Nous vous enverrons un code pour vous connecter, sans mot de passe.</p>
            <form noValidate onSubmit={e => { e.preventDefault(); submit(); }}>
              <label className="lbl" htmlFor="loginEmail">COURRIEL</label>
              <input className="plain" id="loginEmail" type="email" autoComplete="email" autoFocus value={email} onChange={e => setEmail(e.target.value)} />
              {err && <div className="notice err">{err}</div>}
              <button className="btn btn-primary" type="submit" disabled={busy}>Recevoir mon code</button>
            </form>
            <p className="small">bookmarks est sur invitation. Pas encore de compte ? Demandez une invitation à la personne qui gère l’app.</p>
          </>
        )}
      </div>
    </div>
  );
}
