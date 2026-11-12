// Langue de l'extension : celle de l'interface du navigateur (français ou anglais).
// Le texte français sert de clé ; l'anglais vient de EN.
const ui = (globalThis.chrome?.i18n?.getUILanguage?.() || navigator.language || 'fr').toLowerCase();
export const LANG = ui.startsWith('fr') ? 'fr' : 'en';

const EN = {
  // popup.html
  'Connecter l’extension': 'Connect the extension',
  'Dans bookmarks, ouvrez <strong>Réglages → Extension et jetons</strong>, créez un jeton, puis collez-le ici.': 'In bookmarks, open <strong>Settings → Extension and tokens</strong>, create a token, then paste it here.',
  'Ouvrir les réglages de bookmarks ↗': 'Open bookmarks settings ↗',
  'JETON': 'TOKEN',
  'Connecter': 'Connect',
  'TAGS': 'TAGS',
  'NOTE': 'NOTE',
  'Facultatif, visible par vous seul': 'Optional, only visible to you',
  'COLLECTION': 'COLLECTION',
  'Aucune': 'None',
  'VIGNETTE': 'THUMBNAIL',
  'Garder la vignette actuelle': 'Keep the current thumbnail',
  'Vignette officielle de la vidéo': 'Official video thumbnail',
  'Haut de la page': 'Top of the page',
  'Ce que je vois': 'What I see',
  'Ouvrir bookmarks ↗': 'Open bookmarks ↗',
  'Ajouter ↵': 'Add ↵',
  'Page non enregistrable': 'This page can’t be saved',
  'Seules les adresses web (http ou https) peuvent être ajoutées. Ouvrez un site, puis cliquez de nouveau sur l’extension.': 'Only web addresses (http or https) can be added. Open a website, then click the extension again.',
  'Alt+Maj+B pour ouvrir · clic droit sur un lien pour l’ajouter': 'Alt+Shift+B to open · right-click a link to add it',
  'Déconnecter': 'Disconnect',
  // popup.js
  'Ce n’est pas un jeton bookmarks. Il commence par « bm_ ».': 'This isn’t a bookmarks token. It starts with “bm_”.',
  'Ce jeton n’est pas valide ou a été révoqué. Créez-en un nouveau dans Réglages.': 'This token isn’t valid or was revoked. Create a new one in Settings.',
  'Déjà dans vos signets. Vous pouvez compléter ses tags et sa note.': 'Already in your bookmarks. You can add tags and a note.',
  'Enregistrer': 'Save',
  'Ce jeton ne fonctionne plus. Collez un nouveau jeton.': 'This token no longer works. Paste a new token.',
  'Signet mis à jour ✓': 'Bookmark updated ✓',
  'Ajouté à bookmarks ✓': 'Added to bookmarks ✓',
  'Ajouté à bookmarks ✓ La capture se fait en arrière-plan.': 'Added to bookmarks ✓ The screenshot is being taken in the background.',
  'Ce jeton ne fonctionne plus. Déconnectez puis reconnectez l’extension.': 'This token no longer works. Disconnect, then reconnect the extension.',
  'Retirer {tag}': 'Remove {tag}',
  'Créer #{tag}': 'Create #{tag}',
  // background.js
  'Ajouter cette page à bookmarks': 'Add this page to bookmarks',
  'Ajouter ce lien à bookmarks': 'Add this link to bookmarks',
  'Ajouter à bookmarks (Alt+Maj+B)': 'Add to bookmarks (Alt+Shift+B)',
  'Cette adresse ne peut pas être enregistrée.': 'This address can’t be saved.',
  'Ouvrez l’extension pour la connecter à votre compte.': 'Open the extension to connect it to your account.',
  'Ajouté à bookmarks.': 'Added to bookmarks.',
  'Déjà dans vos signets.': 'Already in your bookmarks.',
  // api.js
  'Extension non connectée.': 'Extension not connected.',
  'bookmarks est injoignable. Vérifiez votre connexion.': 'Can’t reach bookmarks. Check your connection.',
  'Une erreur est survenue.': 'Something went wrong.'
};

export function t(fr, vars) {
  let s = LANG === 'en' ? (EN[fr] ?? fr) : fr;
  if (vars) s = s.replace(/\{(\w+)\}/g, (m, k) => (k in vars ? String(vars[k]) : m));
  return s;
}

/** Traduit popup.html : data-i18n (texte), data-i18n-html (texte avec <strong>), placeholder */
export function localizePage() {
  document.documentElement.lang = LANG;
  for (const el of document.querySelectorAll('[data-i18n]')) el.textContent = t(el.textContent.trim());
  for (const el of document.querySelectorAll('[data-i18n-html]')) el.innerHTML = t(el.innerHTML.trim());
  for (const el of document.querySelectorAll('[placeholder]')) el.placeholder = t(el.placeholder);
}
