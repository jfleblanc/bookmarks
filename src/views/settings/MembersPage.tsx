import { useCallback, useEffect, useRef, useState } from 'react';
import { api, ApiError, copyText, fullDate, plural } from '../../api';
import { useAuth, useToast } from '../../context';
import { Avatar, Icon } from '../../components/Icons';
import { Subhead } from './SettingsLayout';

interface Member { id: string; email: string; role: 'admin' | 'member'; active: boolean; created_at: number; bookmarks: number }
interface Invite { id: string; email: string; created_at: number; expires_at: number; expired: boolean }

export default function MembersPage() {
  const { user } = useAuth();
  const toast = useToast();
  const [members, setMembers] = useState<Member[]>([]);
  const [invites, setInvites] = useState<Invite[]>([]);
  const [email, setEmail] = useState('');
  const [err, setErr] = useState('');
  const [last, setLast] = useState<{ email: string; link: string; expires_at: number } | null>(null);
  const [confirm, setConfirm] = useState<string | null>(null);
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
    setConfirm(null);
    load();
    toast(`Invitation de ${i.email} annulée. Son lien ne fonctionne plus.`);
  }
  async function setActive(m: Member, active: boolean) {
    try {
      await api.patch(`/api/admin/members/${m.id}`, { active });
      setConfirm(null);
      load();
      toast(active ? `${m.email} est réactivé.` : `${m.email} est désactivé.`);
    } catch (e) { toast(e instanceof ApiError ? e.message : 'Action impossible.'); }
  }
  const confirmOr = (key: string, label: string, run: () => void, danger = true) => confirm === key
    ? <span className="row-actions"><button type="button" className="btn-s danger" onClick={run}>Confirmer</button><button type="button" className="btn-s" onClick={() => setConfirm(null)}>Annuler</button></span>
    : <button type="button" className={`btn-s${danger ? ' danger' : ''}`} onClick={() => setConfirm(key)}>{label}</button>;

  return (
    <>
      <Subhead title="Inviter quelqu’un">
        Il n’y a pas d’inscription publique : on entre seulement avec une invitation. Chaque compte a ses propres signets et collections, que personne d’autre ne voit.
      </Subhead>
      <form className="form-inline" noValidate onSubmit={e => { e.preventDefault(); invite(); }}>
        <div className="form-group">
          <label htmlFor="invEmail">Courriel</label>
          <div className="copy-row">
            <input id="invEmail" className="form-control" type="email" placeholder="adresse@exemple.ca" autoComplete="off" value={email} onChange={e => setEmail(e.target.value)} />
            <button className="btn-s primary" type="submit">Créer le lien d’invitation</button>
          </div>
          {err ? <p className="form-error">{err}</p> : <p className="form-note">Vous envoyez le lien vous-même. Il fonctionne une seule fois et expire après 7 jours.</p>}
        </div>
      </form>
      {last && (
        <div className="flash ok">
          <p>Lien d’invitation pour <strong>{last.email}</strong>, valide jusqu’au {fullDate(last.expires_at)}. <strong>Il n’est affiché qu’une fois.</strong></p>
          <div className="copy-row">
            <input className="form-control mono" ref={linkInput} readOnly value={last.link} aria-label="Lien d’invitation" onFocus={e => e.currentTarget.select()} />
            <button type="button" className="btn-s primary" onClick={async () => toast((await copyText(last.link, linkInput.current)) ? 'Lien copié.' : 'Lien sélectionné. Copiez-le avec Ctrl+C ou Cmd+C.')}>Copier</button>
            <button type="button" className="btn-s" onClick={() => setLast(null)}>C’est fait</button>
          </div>
        </div>
      )}

      <Subhead title="Invitations en attente" />
      <div className="box">
        {!invites.length ? <div className="box-row blank"><span className="box-main"><small>Aucune invitation en attente.</small></span></div>
          : invites.map(i => (
            <div className="box-row" key={i.id}>
              <span className="box-icon"><Icon name="mail" size={20} /></span>
              <span className="box-main">
                <strong>{i.email} <span className={`label${i.expired ? ' warn' : ''}`}>{i.expired ? 'expirée' : 'en attente'}</span></strong>
                <small>Créée le {fullDate(i.created_at)} · {i.expired ? 'expirée' : 'expire'} le {fullDate(i.expires_at)}</small>
              </span>
              <span className="row-actions">
                {confirm !== `i-${i.id}` && <button type="button" className="btn-s" onClick={() => renew(i)}>Nouveau lien</button>}
                {confirmOr(`i-${i.id}`, 'Annuler', () => cancel(i))}
              </span>
            </div>
          ))}
      </div>

      <Subhead title={`Membres (${members.length})`}>
        Désactiver un membre ferme ses sessions et bloque ses connexions. Ses données restent intactes, mais ses collections partagées ne sont plus visibles.
      </Subhead>
      <div className="box">
        {members.map(m => (
          <div className={`box-row${m.active ? '' : ' muted'}`} key={m.id}>
            <Avatar email={m.email} size="md" />
            <span className="box-main">
              <strong>
                {m.email}
                {m.id === user?.id && <span className="label">vous</span>}
                {m.role === 'admin' && <span className="label">admin</span>}
                {!m.active && <span className="label warn">désactivé</span>}
              </strong>
              <small>{plural(m.bookmarks, 'signet', 'signets')} · membre depuis le {fullDate(m.created_at)}</small>
            </span>
            {m.role !== 'admin' && (m.active
              ? confirmOr(`m-${m.id}`, 'Désactiver', () => setActive(m, false))
              : <button type="button" className="btn-s" onClick={() => setActive(m, true)}>Réactiver</button>)}
          </div>
        ))}
      </div>
    </>
  );
}
