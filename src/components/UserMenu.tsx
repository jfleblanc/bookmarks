import { useEffect, useRef, useState } from 'react';
import { NavLink, useLocation } from 'react-router-dom';
import type { User } from '../api';
import { Icon } from './Icons';

/** Menu du compte, à la manière de GitHub : avatar dans l'en-tête, tout le reste en dessous */
export function UserMenu({ user, onLogout }: { user: User; onLogout: () => void }) {
  const [open, setOpen] = useState(false);
  const wrap = useRef<HTMLDivElement>(null);
  const btn = useRef<HTMLButtonElement>(null);
  const location = useLocation();
  const initial = (user.email[0] || '?').toUpperCase();

  useEffect(() => setOpen(false), [location.pathname]);
  useEffect(() => {
    if (!open) return;
    const items = () => [...(wrap.current?.querySelectorAll<HTMLElement>('[role="menuitem"]') || [])];
    items()[0]?.focus();
    const onDown = (e: PointerEvent) => { if (!wrap.current?.contains(e.target as Node)) setOpen(false); };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { setOpen(false); btn.current?.focus(); return; }
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        e.preventDefault();
        const list = items(), i = list.indexOf(document.activeElement as HTMLElement);
        list[(i + (e.key === 'ArrowDown' ? 1 : -1) + list.length) % list.length]?.focus();
      }
      if (e.key === 'Tab') setOpen(false);
    };
    document.addEventListener('pointerdown', onDown);
    document.addEventListener('keydown', onKey);
    return () => { document.removeEventListener('pointerdown', onDown); document.removeEventListener('keydown', onKey); };
  }, [open]);

  return (
    <div className="umenu" ref={wrap}>
      <button ref={btn} type="button" className="avatar" aria-haspopup="menu" aria-expanded={open} aria-label={`Compte : ${user.email}`} onClick={() => setOpen(o => !o)}>
        {initial}
      </button>
      {open && (
        <div className="umenu-pop" role="menu" aria-label="Compte">
          <div className="umenu-who">
            <span className="avatar big" aria-hidden="true">{initial}</span>
            <span><strong>{user.email}</strong><small>{user.role === 'admin' ? 'Administrateur' : 'Membre'}</small></span>
          </div>
          <hr />
          <NavLink role="menuitem" to="/reglages" end><Icon name="settings" size={18} />Réglages</NavLink>
          {user.role === 'admin' && <NavLink role="menuitem" to="/reglages/membres"><Icon name="people" size={18} />Membres et invitations</NavLink>}
          <hr />
          <button role="menuitem" type="button" onClick={onLogout}><Icon name="out" size={18} />Déconnexion</button>
        </div>
      )}
    </div>
  );
}
