# bookmarks

Vos sites favoris, avec capture d’écran, tags et collections à partager. Sur invitation seulement.

- **Interface** : React (Vite), en français, installable comme application (PWA). Sur Android, on peut « partager » une page vers bookmarks.
- **Serveur** : un seul Worker Cloudflare qui sert l’interface et l’API (`/api/*`).
- **Données** : D1 (base SQLite), R2 (captures d’écran), Queues (traitement en arrière-plan), Browser Rendering (captures).
- **Connexion** : lien magique par courriel (Resend), sans mot de passe. Sessions de 60 jours.
- **Aucune IA** : le titre et le favicon sont lus dans le HTML de la page ; la capture est faite par un navigateur.

## Structure

```
worker/          API et traitement en arrière-plan (TypeScript, sans dépendance sauf @cloudflare/puppeteer)
  index.ts       routes, protection CSRF, file de traitement
  auth.ts        lien magique, sessions, invitations (côté invité), préférences
  admin.ts       membres et invitations (super admin)
  bookmarks.ts   signets, tags, filtres ET/OU, pagination, vignettes
  collections.ts collections, partage par lien, page publique
  capture.ts     titre, favicon et capture d’écran
migrations/      schéma de la base D1
src/             interface React
public/          icônes, manifeste PWA, service worker
extension/       extension Chrome / Brave (Manifest V3, sans étape de compilation)
test/api.test.ts test de bout en bout de l’API (Bun, sans Cloudflare)
```

## Mise en place sur Cloudflare (une seule fois)

Prérequis : le plan Workers payant (pour Browser Rendering et Queues), votre domaine géré par Cloudflare, et un compte Resend avec un domaine d’envoi vérifié.

1. **Créer les ressources** dans le tableau de bord Cloudflare :
   - *Storage & Databases → D1* : créez une base nommée `bookmarks`. Copiez son **Database ID**.
   - *R2* : créez un compartiment nommé `bookmarks-thumbs`.
   - *Queues* : créez une file nommée `bookmarks-jobs`.

2. **Remplir `wrangler.jsonc`** (les valeurs « À REMPLIR ») :
   - `database_id` : l’identifiant copié à l’étape 1.
   - `APP_URL` : l’adresse de l’app, par exemple `https://bookmarks.mondomaine.ca` (sans barre oblique finale).
   - `ADMIN_EMAIL` : votre courriel. Le compte super admin est créé à votre première connexion.
   - `MAIL_FROM` : l’expéditeur, par exemple `bookmarks <noreply@mondomaine.ca>` (domaine vérifié dans Resend).

3. **Brancher le dépôt GitHub** : *Workers & Pages → Create → Import a repository*, choisissez `bookmarks`, puis :
   - Build command : `npm run build`
   - Deploy command : `npm run deploy` (applique les migrations de la base, puis déploie)

   Si le déploiement échoue sur l’étape des migrations (permission D1), ajoutez la permission *D1 : Edit* au jeton de compilation (*Settings → Builds → API token*).

4. **Ajouter le secret Resend** : dans le Worker, *Settings → Variables and Secrets → Add* : `RESEND_API_KEY` (type *Secret*).

5. **Brancher le domaine** : dans le Worker, *Settings → Domains & Routes → Add → Custom domain*, puis entrez l’adresse choisie à l’étape 2.

6. **Première connexion** : ouvrez l’adresse, entrez votre `ADMIN_EMAIL`, cliquez le lien reçu par courriel. Invitez ensuite des personnes depuis l’onglet *Admin*.

Ensuite, chaque `git push` sur `main` redéploie l’app automatiquement.

## Développement local

```bash
npm install
cp .dev.vars.example .dev.vars        # mode développement : les liens de connexion s’affichent à l’écran
npm run db:migrate:local
npm run dev:api                        # API sur http://localhost:8787
npm run dev                            # interface sur http://localhost:5173
```

En local, la capture d’écran (Browser Rendering) n’est pas disponible : les signets reçoivent leur titre et leur favicon, sans vignette.

Test de l’API sans Cloudflare : `bun test/api.test.ts`

## Extension Chrome / Brave

Le dossier `extension/` contient l’extension. L’app en sert une copie compressée à `/bookmarks-extension.zip` (lien dans *Réglages*). Après une modification de l’extension, régénérez ce fichier :

```bash
cd extension && zip -r ../public/bookmarks-extension.zip . -x '.*' && cd ..
```

L’adresse du serveur est dans `extension/api.js` (`SERVER`) et dans `extension/manifest.json` (`host_permissions`).

Chaque personne crée son jeton dans *Réglages → Extension de navigateur* et le colle dans l’extension. Un jeton peut seulement ajouter et compléter des signets (ajout, tags, note, ajout à une collection) : il ne peut rien supprimer, ni gérer le partage, les jetons ou l’admin. Il est stocké haché sur le serveur et peut être révoqué à tout moment.

## Sécurité, en bref

- Les jetons (liens de connexion, invitations, sessions) ne sont jamais stockés en clair : seulement leur empreinte SHA-256.
- Un lien de connexion expire après 15 minutes et ne sert qu’une fois ; 5 liens au plus par 15 minutes pour une même adresse.
- La page du lien demande un clic sur « Me connecter » : les filtres de courriel qui ouvrent les liens automatiquement ne peuvent pas les consommer.
- La demande de lien répond toujours la même chose : on ne peut pas savoir qui a un compte.
- Chaque requête vérifie le propriétaire : personne ne voit les signets ou collections d’un autre compte.
- Les requêtes qui modifient des données doivent venir de l’app elle-même (vérification de l’origine).
- Le serveur refuse d’aller chercher des adresses de réseaux privés.
