// Réponses du serveur en français ou en anglais, selon la langue de l'interface (en-tête X-Lang),
// sinon la préférence du compte, sinon la langue du navigateur.
export type Lang = 'fr' | 'en';

export function requestLang(req: Request, prefsLang?: unknown): Lang {
  const h = (req.headers.get('x-lang') || '').toLowerCase();
  if (h === 'fr' || h === 'en') return h;
  if (prefsLang === 'fr' || prefsLang === 'en') return prefsLang;
  for (const part of (req.headers.get('accept-language') || '').split(',')) {
    const base = part.trim().slice(0, 2).toLowerCase();
    if (base === 'fr') return 'fr';
    if (base === 'en') return 'en';
  }
  return 'fr';
}

const EN: Record<string, string> = {
  'Action non permise avec un jeton d’extension.': 'This action isn’t allowed with an extension token.',
  'Action possible seulement depuis le site.': 'This can only be done from the website.',
  'Adresse courriel invalide.': 'Invalid email address.',
  'Adresse d’API inconnue.': 'Unknown API address.',
  'Ce code est incorrect ou a expiré. Vérifiez le dernier courriel reçu, ou demandez un nouveau code.': 'This code is incorrect or has expired. Check the latest email you received, or request a new code.',
  'Ce compte est désactivé.': 'This account is deactivated.',
  'Ce jeton n’est plus valide. Reconnectez l’extension depuis Réglages.': 'This token is no longer valid. Reconnect the extension from Settings.',
  'Ce lien a expiré ou a déjà servi. Demandez-en un nouveau.': 'This link has expired or was already used. Request a new one.',
  'Ce lien de connexion n’est pas valide.': 'This sign-in link isn’t valid.',
  'Ce lien n’est plus actif.': 'This link is no longer active.',
  'Ce lien n’est plus disponible.': 'This link is no longer available.',
  'Ce site est déjà enregistré.': 'This site is already saved.',
  'Cette adresse a déjà un compte. Connectez-vous avec un lien par courriel.': 'This address already has an account. Sign in with an email link.',
  'Cette adresse a déjà un compte.': 'This address already has an account.',
  'Cette adresse n’est pas valide.': 'This address isn’t valid.',
  'Cette adresse pointe vers un réseau privé.': 'This address points to a private network.',
  'Cette invitation n’est plus valide.': 'This invitation is no longer valid.',
  'Collection introuvable.': 'Collection not found.',
  'Collez d’abord l’adresse d’un site.': 'Paste a website address first.',
  'Connectez-vous pour continuer.': 'Sign in to continue.',
  'Image introuvable.': 'Image not found.',
  'Invitation introuvable.': 'Invitation not found.',
  'La vignette envoyée est invalide.': 'The thumbnail sent is invalid.',
  'Le JSON envoyé est invalide.': 'The JSON sent is invalid.',
  'Le compte super admin ne peut pas être désactivé.': 'The super admin account can’t be deactivated.',
  'Le contenu doit être en JSON.': 'The content must be JSON.',
  'Le titre est obligatoire.': 'A title is required.',
  'Lien invalide.': 'Invalid link.',
  'Membre introuvable.': 'Member not found.',
  'Méthode non permise.': 'Method not allowed.',
  'Requête refusée.': 'Request refused.',
  'Réservé au super admin.': 'Super admin only.',
  'Signet introuvable.': 'Bookmark not found.',
  'Trop de navigateurs connectés. Révoquez-en un d’abord.': 'Too many connected browsers. Revoke one first.',
  'Une invitation est déjà en attente pour cette adresse. Utilisez « Nouveau lien » dans la liste.': 'An invitation is already pending for this address. Use “New link” in the list.',
  'Cette adresse est déjà utilisée par « {title} ».': 'This address is already used by “{title}”.',
  'Une erreur inattendue est survenue.': 'An unexpected error occurred.'
};

export function tr(lang: Lang, fr: string, vars?: Record<string, unknown>): string {
  let s = lang === 'en' ? (EN[fr] ?? fr) : fr;
  if (vars) s = s.replace(/\{(\w+)\}/g, (m, k) => (k in vars ? String(vars[k]) : m));
  return s;
}
