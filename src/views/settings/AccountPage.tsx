import { useNavigate } from 'react-router-dom';
import { api } from '../../api';
import { useAuth } from '../../context';
import { t } from '../../i18n';
import { Subhead } from './SettingsLayout';

export default function AccountPage() {
  const { user, setUser } = useAuth();
  const navigate = useNavigate();
  if (!user) return null;

  async function logout() {
    await api.post('/api/auth/logout').catch(() => {});
    setUser(null);
    navigate('/connexion');
  }

  return (
    <>
      <Subhead title={t('Compte')} />
      <div className="form-group">
        <label htmlFor="acEmail">{t('Courriel')}</label>
        <input id="acEmail" className="form-control" value={user.email} readOnly />
        <p className="form-note">{t('C’est l’adresse qui vous sert à vous connecter : vous recevez un lien et un code de 6 chiffres, sans mot de passe. Pour la changer, demandez à l’administrateur.')}</p>
      </div>
      <div className="form-group">
        <span className="form-label">{t('Rôle')}</span>
        <p className="form-value">{user.role === 'admin' ? t('Administrateur : vous pouvez inviter des personnes et gérer les membres.') : t('Membre : vos signets et collections ne sont visibles que par vous, sauf les collections que vous partagez.')}</p>
      </div>

      <Subhead title={t('Session')} />
      <div className="form-group">
        <p className="form-value">{t('Vous restez connecté 60 jours sur cet appareil, prolongés à chaque visite. Se déconnecter efface aussi la copie hors ligne de cet appareil.')}</p>
        <div><button type="button" className="btn-s" onClick={logout}>{t('Se déconnecter de cet appareil')}</button></div>
      </div>
    </>
  );
}
