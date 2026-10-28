import { useCallback, useEffect, useRef, useState } from 'react';
import { api, ApiError, copyText, fullDate } from '../api';
import { useAuth, useToast } from '../context';

interface Member { id: string; email: string; role: 'admin' | 'member'; active: boolean; created_at: number; bookmarks: number }
interface Invite { id: string; email: string; created_at: number; expires_at: number; expired: boolean }

export default function AdminView() {
  const { user } = useAuth();
  const toast = useToast();
  const [members, setMembers] = useState<Member[]>([]);
  const [invites, setInvites] = useState<Invite[]>([]);
  const [email, setEmail] = useState('');
  const [err, setErr] = useState('');
  const [last, setLast] = useState<{ email: string; link: string; expires_at: number } | null>(null);
  const linkInput = useRef<HTMLInputElement>(null);

  const load = useCallback(() => {
    api.get<{ members: Member[] }>('/api/admin/members').then(r => setMembers(r.members)).catch(() => {});
    api.get<{ invites: Invite[] }>('/api/admin/invites').then(r => setInvites(r.invites)).catch(() => {});
  }, []);
  useEffect(() => { load(); }, [load]);

  async function invite() {
    setErr('');
    try {
      const r = await api.post<{ invite: Invite; link: string }>('/api/admin/invites', { email });
      setLast({ email: r.invite.email, link: r.link, expires_at: r.invite.expires_at });
      setEmail(''); load();
      toast('Lien d’invitation créé.');
    } catch (e) { setErr(e instanceof ApiError ? e.message : 'Invitation impossible.'); }
  }
  async function renew(i: Invite) {
    try {
      const r = await api.post<{ invite: Invite; link: string }>(`/api/admin/invites/${i.id}/renew`);
      setLast({ email: r.invite.email, link: r.link, expires_at: r.invite.expires_at });
      load();
      toast('Nouveau lien d’invitation créé. L’ancien ne fonctionne plus.');
      window.scrollTo({ top: 0, behavior: 'smooth' });
    } catch { toast('Action impossible.'); }
  }
  async function cancel(i: Invite) {
    await api.del(`/api/admin/invites/${i.id}`).catch(() => {});
    if (last?.email === i.email) setLast(null);
    load();
    toast(`Invitation de ${i.email} annulée. Son lien ne fonctionne plus.`);
  }
  async function setActive(m: Member, active: boolean) {
    try {
      await api.patch(`/api/admin/members/${m.id}`, { active });
      load();
      toast(active ? `${m.email} est réactivé.` : `${m.email} est désactivé.`);
    } catch (e) { toast(e instanceof ApiError ? e.message : 'Action impossible.'); }
  }

  return (
    <section>
      <div className="vhead"><h1>Admin</h1></div>
      <div className="adm">
        <section>
          <h2 className="sec-h">Inviter quelqu’un</h2>
          <form className="inv" noValidate onSubmit={e => { e.preventDefault(); invite(); }}>
            <label className="lbl" htmlFor="invEmail">COURRIEL</label>
            <input id="invEmail" type="email" placeholder="adresse@exemple.ca" autoComplete="off" value={email} onChange={e => setEmail(e.target.value)} />
            <button className="btn btn-primary" type="submit">Créer le lien d’invitation</button>
          </form>
          {err && <div className="notice err">{err}</div>}
          {last && (
            <div className="result">
              <p>Lien d’invitation pour <strong>{last.email}</strong>. Envoyez-le vous-même : il n’est affiché qu’une fois. Il fonctionne une seule fois et expire le {fullDate(last.expires_at)}.</p>
              <input className="linkbox" ref={linkInput} readOnly value={last.link} aria-label="Lien d’invitation" />
              <button type="button" className="btn btn-primary" onClick={async () => toast((await copyText(last.link, linkInput.current)) ? 'Lien copié.' : 'Lien sélectionné. Copiez-le avec Ctrl+C ou Cmd+C.')}>Copier le lien</button>
            </div>
          )}
          <p className="note">Il n’y a pas d’inscription publique : on entre seulement avec une invitation. Chaque compte a ses propres signets et collections, que personne d’autre ne voit.</p>
        </section>

        <section>
          <h2 className="sec-h">Invitations en attente</h2>
          {invites.length ? (
            <div className="tblwrap"><table className="tbl">
              <thead><tr><th>Courriel</th><th>Créée</th><th>Expire</th><th>État</th><th></th></tr></thead>
              <tbody>
                {invites.map(i => (
                  <tr key={i.id}>
                    <td>{i.email}</td>
                    <td className="m">{fullDate(i.created_at)}</td>
                    <td className="m">{fullDate(i.expires_at)}</td>
                    <td><span className={`pill${i.expired ? ' warn' : ''}`}>{i.expired ? 'expirée' : 'en attente'}</span></td>
                    <td className="r">
                      <button type="button" className="ul ink" onClick={() => renew(i)}>Nouveau lien</button>
                      <button type="button" className="ul danger" onClick={() => cancel(i)}>Annuler</button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table></div>
          ) : <p className="note">Aucune invitation en attente.</p>}
        </section>

        <section>
          <h2 className="sec-h">Membres</h2>
          <div className="tblwrap"><table className="tbl">
            <thead><tr><th>Courriel</th><th>Rôle</th><th>Signets</th><th>Depuis</th><th>État</th><th></th></tr></thead>
            <tbody>
              {members.map(m => (
                <tr key={m.id}>
                  <td>{m.email}{m.id === user?.id && <> <span className="pill">vous</span></>}</td>
                  <td>{m.role === 'admin' ? 'Super admin' : 'Membre'}</td>
                  <td className="m">{m.bookmarks}</td>
                  <td className="m">{fullDate(m.created_at)}</td>
                  <td><span className={`pill${m.active ? ' ok' : ''}`}>{m.active ? 'actif' : 'désactivé'}</span></td>
                  <td className="r">{m.role !== 'admin' && (
                    <button type="button" className={`ul ${m.active ? 'danger' : 'ink'}`} onClick={() => setActive(m, !m.active)}>{m.active ? 'Désactiver' : 'Réactiver'}</button>
                  )}</td>
                </tr>
              ))}
            </tbody>
          </table></div>
          <p className="note">Désactiver un membre ferme ses sessions et bloque ses liens de connexion. Ses données restent intactes, mais ses collections partagées ne sont plus visibles.</p>
        </section>
      </div>
    </section>
  );
}
