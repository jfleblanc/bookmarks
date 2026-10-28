-- Schéma initial de bookmarks (Cloudflare D1 / SQLite)
-- Toutes les dates sont en millisecondes depuis l'époque Unix.

CREATE TABLE users (
  id          TEXT PRIMARY KEY,
  email       TEXT NOT NULL UNIQUE,
  role        TEXT NOT NULL DEFAULT 'member' CHECK (role IN ('admin', 'member')),
  active      INTEGER NOT NULL DEFAULT 1,
  prefs       TEXT NOT NULL DEFAULT '{}',
  invited_by  TEXT REFERENCES users(id),
  created_at  INTEGER NOT NULL
);

-- Invitations : seul le hachage du jeton est conservé
CREATE TABLE invites (
  id          TEXT PRIMARY KEY,
  email       TEXT NOT NULL,
  token_hash  TEXT NOT NULL UNIQUE,
  created_by  TEXT NOT NULL REFERENCES users(id),
  created_at  INTEGER NOT NULL,
  expires_at  INTEGER NOT NULL,
  status      TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'accepted', 'cancelled'))
);
CREATE INDEX invites_email ON invites(email);

-- Liens de connexion (lien magique) : usage unique, expirent vite
CREATE TABLE login_tokens (
  token_hash  TEXT PRIMARY KEY,
  user_id     TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at  INTEGER NOT NULL,
  expires_at  INTEGER NOT NULL,
  used_at     INTEGER
);
CREATE INDEX login_tokens_user ON login_tokens(user_id, created_at);

CREATE TABLE sessions (
  token_hash  TEXT PRIMARY KEY,
  user_id     TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at  INTEGER NOT NULL,
  expires_at  INTEGER NOT NULL
);
CREATE INDEX sessions_user ON sessions(user_id);

CREATE TABLE bookmarks (
  id           TEXT PRIMARY KEY,
  user_id      TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  url          TEXT NOT NULL,
  norm_url     TEXT NOT NULL,
  domain       TEXT NOT NULL,
  title        TEXT,
  favicon_url  TEXT,
  thumb_key    TEXT,
  thumb_ratio  REAL NOT NULL DEFAULT 0.75,
  status       TEXT NOT NULL DEFAULT 'processing' CHECK (status IN ('processing', 'ready', 'error')),
  error        TEXT,
  created_at   INTEGER NOT NULL,
  updated_at   INTEGER NOT NULL,
  deleted_at   INTEGER
);
CREATE UNIQUE INDEX bookmarks_user_url ON bookmarks(user_id, norm_url);
CREATE INDEX bookmarks_user_created ON bookmarks(user_id, created_at DESC, id DESC);

CREATE TABLE tags (
  id       TEXT PRIMARY KEY,
  user_id  TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name     TEXT NOT NULL,
  UNIQUE (user_id, name)
);

CREATE TABLE bookmark_tags (
  bookmark_id  TEXT NOT NULL REFERENCES bookmarks(id) ON DELETE CASCADE,
  tag_id       TEXT NOT NULL REFERENCES tags(id) ON DELETE CASCADE,
  PRIMARY KEY (bookmark_id, tag_id)
);
CREATE INDEX bookmark_tags_tag ON bookmark_tags(tag_id);

CREATE TABLE collections (
  id           TEXT PRIMARY KEY,
  user_id      TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  title        TEXT NOT NULL,
  description  TEXT NOT NULL DEFAULT '',
  share_code   TEXT NOT NULL UNIQUE,
  shared       INTEGER NOT NULL DEFAULT 0,
  created_at   INTEGER NOT NULL,
  updated_at   INTEGER NOT NULL,
  deleted_at   INTEGER
);
CREATE INDEX collections_user ON collections(user_id, updated_at DESC);

CREATE TABLE collection_items (
  collection_id  TEXT NOT NULL REFERENCES collections(id) ON DELETE CASCADE,
  bookmark_id    TEXT NOT NULL REFERENCES bookmarks(id) ON DELETE CASCADE,
  position       INTEGER NOT NULL,
  PRIMARY KEY (collection_id, bookmark_id)
);
CREATE INDEX collection_items_bookmark ON collection_items(bookmark_id);
