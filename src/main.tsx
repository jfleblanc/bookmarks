import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import App from './App';
import { AuthProvider, OfflineProvider, ToastProvider } from './context';
import './styles.css';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <BrowserRouter>
      <AuthProvider>
        <OfflineProvider>
          <ToastProvider>
            <App />
          </ToastProvider>
        </OfflineProvider>
      </AuthProvider>
    </BrowserRouter>
  </StrictMode>
);

// Rend l'app installable (PWA) en production
if ('serviceWorker' in navigator && import.meta.env.PROD) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js')
      // garde la version courante de l'app sur l'appareil (et retire les anciennes) pour le hors ligne
      .then(reg => { if (navigator.onLine) (reg.active || reg.installing || reg.waiting)?.postMessage('refresh-shell'); })
      .catch(() => {});
  });
}
