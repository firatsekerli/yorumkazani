-- Daily free-throw counter. IP is stored only as a salted SHA-256 hash.
CREATE TABLE IF NOT EXISTS usage (
  ip_hash TEXT NOT NULL,
  day     TEXT NOT NULL,           -- YYYY-MM-DD, Istanbul time
  count   INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (ip_hash, day)
);
