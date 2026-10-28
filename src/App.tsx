import { Navigate, NavLink, Outlet, Route, Routes, useLocation, useNavigate } from 'react-router-dom';
import { api } from './api';
import { useAuth, useOffline } from './context';
import { Ribbon } from './components/Ribbon';
import { UserMenu } from './components/UserMenu';
import BookmarksView from './views/BookmarksView';
import CollectionsView from './views/CollectionsView';
import CollectionView from './views/CollectionView';
import AdminView from './views/AdminView';
import SettingsView from './views/SettingsView';
import LoginView from './views/LoginView';
import LoginLinkView from './views/LoginLinkView';
import InviteView from './views/InviteView';
import PublicCollectionView from './views/PublicCollectionView';

export default function App() {
  return (
    <Routes>
      {/* Pages accessibles sans compte */}
      <Route path="/connexion" element={<LoginView />} />
      <Route path="/connexion/lien" element={<LoginLinkView />} />
      <Route path="/invitation/:token" element={<InviteView />} />
      <Route path="/c/:code" element={<PublicCollectionView />} />
      {/* Application (connexion requise) */}
      <Route element={<AppLayout />}>
        <Route index element={<BookmarksView />} />
        <Route path="/collections" element={<CollectionsView />} />
        <Route path="/collections/:id" element={<CollectionView />} />
        <Route path="/admin" element={<AdminOnly><AdminView /></AdminOnly>} />
        <Route path="/reglages" element={<SettingsView />} />
      </Route>
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}

function AdminOnly({ children }: { children: JSX.Element }) {
  const { user } = useAuth();
  return user?.role === 'admin' ? children : <Navigate to="/" replace />;
}

function AppLayout() {
  const { user, setUser } = useAuth();
  const { offline, syncedAt, pendingCount } = useOffline();
  const location = useLocation();
  const navigate = useNavigate();

  if (user === undefined) return <div className="page"><div className="loading-page"><Ribbon /></div></div>;
  if (user === null) {
    const next = location.pathname + location.search;
    return <Navigate to={`/connexion${next !== '/' ? `?suite=${encodeURIComponent(next)}` : ''}`} replace />;
  }

  const bw = !!user.prefs?.bw;
  const hoverColor = bw && user.prefs?.hoverColor !== false;

  async function logout() {
    await api.post('/api/auth/logout').catch(() => {});
    setUser(null);
    navigate('/connexion');
  }

  return (
    <div className={`page${bw ? ' bw' : ''}${hoverColor ? ' hover-color' : ''}`} id="app">
      <header className="brandrow">
        <NavLink to="/" className="logo" aria-label="bookmarks, accueil"><Ribbon /></NavLink>
        <nav className="nav" aria-label="Navigation principale">
          <NavLink to="/" end>Signets</NavLink>
          <NavLink to="/collections">Collections</NavLink>
        </nav>
        <UserMenu user={user} onLogout={logout} />
      </header>
      {offline && (
        <div className="offline-bar" role="status">
          <strong>Hors ligne</strong>
          <span>{syncedAt ? `Copie du ${new Date(syncedAt).toLocaleString('fr-CA', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}` : 'Aucune copie enregistrée sur cet appareil'}</span>
          {pendingCount > 0 && <span>{pendingCount} ajout{pendingCount > 1 ? 's' : ''} en attente</span>}
        </div>
      )}
      <Outlet />
    </div>
  );
}
