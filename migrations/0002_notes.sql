-- Note personnelle facultative sur chaque signet
ALTER TABLE bookmarks ADD COLUMN note TEXT NOT NULL DEFAULT '';
