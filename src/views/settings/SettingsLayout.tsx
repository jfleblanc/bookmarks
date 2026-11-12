import { useEffect, useRef, type ReactNode } from 'react';
import { NavLink, Outlet, useLocation } from 'react-router-dom';
import { useAuth } from '../../context';
import { Avatar, Icon, type IconName } from '../../components/Icons';
import { t } from '../../i18n';

/** Réglages organisés comme ceux de GitHub : en-tête du compte, menu à gauche, une page par sujet */
export default function SettingsLayout() {
  const { user } = useAuth();
  const nav = useRef<HTMLElement>(null);
  const { pathname } = useLocation();
  // Sur téléphone, le menu défile à l'horizontale : on garde la page active visible
  useEffect(() => {
    const el = nav.current?.querySelector<HTMLElement>('a.active');
    if (el && nav.current && nav.current.scrollWidth > nav.current.clientWidth) nav.current.scrollLeft = el.offsetLeft - 16;
  }, [pathname]);
  if (!user) return null;
  const item = (to: string, icon: IconName, label: string, end = false) => (
    <NavLink to={to} end={end}><Icon name={icon} />{label}</NavLink>
  );
  return (
    <section className="settings">
      <header className="settings-head">
        <Avatar email={user.email} size="lg" />
        <div>
          <h1>{user.email}</h1>
          <p>{user.role === 'admin' ? t('Votre compte administrateur') : t('Votre compte personnel')}</p>
        </div>
      </header>
      <div className="settings-grid">
        <nav ref={nav} className="settings-nav" aria-label={t('Réglages')}>
          {item('/reglages', 'person', t('Compte'), true)}
          {item('/reglages/apparence', 'brush', t('Apparence'))}
          <span className="nav-group">{t('Accès')}</span>
          {item('/reglages/extension', 'key', t('Extension et jetons'))}
          <span className="nav-group">{t('Cet appareil')}</span>
          {item('/reglages/hors-ligne', 'offline', t('Hors ligne'))}
          {user.role === 'admin' && <>
            <span className="nav-group">{t('Administration')}</span>
            {item('/reglages/membres', 'people', t('Membres et invitations'))}
          </>}
        </nav>
        <div className="settings-main"><Outlet /></div>
      </div>
    </section>
  );
}

/** Titre de section avec filet, et bouton d'action à droite (comme « New SSH key ») */
export function Subhead({ title, action, danger, children }: { title: string; action?: ReactNode; danger?: boolean; children?: ReactNode }) {
  return (
    <div className={`subhead${danger ? ' danger' : ''}`}>
      <div className="subhead-row">
        <h2>{title}</h2>
        {action}
      </div>
      {children && <p className="subhead-desc">{children}</p>}
    </div>
  );
}
