-- Yorum Kazanı schema (Cloudflare D1)
-- People are anonymous: a random visitor id lives in a cookie; only its salted hash is stored.

CREATE TABLE IF NOT EXISTS posts (
  id            TEXT PRIMARY KEY,           -- short random id, used in /p/<id>
  created_at    INTEGER NOT NULL,           -- unix ms
  author_hash   TEXT NOT NULL,
  nick          TEXT NOT NULL,
  category      TEXT NOT NULL,
  question      TEXT NOT NULL DEFAULT '',
  image_key     TEXT NOT NULL,              -- R2 object key
  width         INTEGER NOT NULL DEFAULT 0,
  height        INTEGER NOT NULL DEFAULT 0,
  status        TEXT NOT NULL DEFAULT 'live', -- live | pending | hidden
  comment_count INTEGER NOT NULL DEFAULT 0,
  report_count  INTEGER NOT NULL DEFAULT 0,
  last_activity INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS posts_new ON posts (status, created_at DESC);
CREATE INDEX IF NOT EXISTS posts_active ON posts (status, last_activity DESC);

CREATE TABLE IF NOT EXISTS comments (
  id           TEXT PRIMARY KEY,
  post_id      TEXT NOT NULL,
  created_at   INTEGER NOT NULL,
  author_hash  TEXT NOT NULL,
  nick         TEXT NOT NULL,
  body         TEXT NOT NULL,
  score        INTEGER NOT NULL DEFAULT 0,
  status       TEXT NOT NULL DEFAULT 'live',  -- live | hidden
  report_count INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS comments_post ON comments (post_id, status, score DESC, created_at);

CREATE TABLE IF NOT EXISTS votes (
  comment_id TEXT NOT NULL,
  voter_hash TEXT NOT NULL,
  value      INTEGER NOT NULL,               -- 1 or -1
  PRIMARY KEY (comment_id, voter_hash)
);

CREATE TABLE IF NOT EXISTS reports (
  target_type   TEXT NOT NULL,               -- post | comment
  target_id     TEXT NOT NULL,
  reporter_hash TEXT NOT NULL,
  reason        TEXT NOT NULL DEFAULT '',
  created_at    INTEGER NOT NULL,
  PRIMARY KEY (target_type, target_id, reporter_hash)
);

CREATE TABLE IF NOT EXISTS rate (
  bucket TEXT NOT NULL,                      -- e.g. post:<hash> or comment:<hash>
  day    TEXT NOT NULL,
  count  INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (bucket, day)
);
