export interface Env {
  DB: D1Database;
  THUMBS: R2Bucket;
  JOBS: Queue<CaptureJob>;
  BROWSER?: Fetcher;
  ASSETS?: Fetcher;
  /** Adresse publique de l'app, sans barre oblique finale. Ex. : https://bookmarks.exemple.ca */
  APP_URL: string;
  /** Courriel du super admin. Le premier compte est créé à sa première connexion. */
  ADMIN_EMAIL: string;
  /** Expéditeur des courriels. Ex. : bookmarks <noreply@exemple.ca> */
  MAIL_FROM: string;
  /** Secret : clé API Resend */
  RESEND_API_KEY?: string;
  /** "1" en développement local : les liens de connexion sont affichés dans la console et renvoyés par l'API */
  DEV_MODE?: string;
}

export interface CaptureJob {
  bookmarkId: string;
}

export interface User {
  id: string;
  email: string;
  role: 'admin' | 'member';
  active: number;
  prefs: string;
  created_at: number;
}
