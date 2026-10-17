CREATE TABLE IF NOT EXISTS genre_index (
  kind TEXT NOT NULL CHECK(kind IN ('movies','series')),
  key TEXT NOT NULL,
  title TEXT NOT NULL,
  year INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','processing','retry','unmatched','matched')),
  tmdb_id INTEGER,
  genre_ids TEXT,
  attempts INTEGER NOT NULL DEFAULT 0,
  next_retry_at TEXT,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY(kind,key)
);
CREATE INDEX IF NOT EXISTS genre_index_queue ON genre_index(status,next_retry_at,attempts,updated_at);
CREATE INDEX IF NOT EXISTS genre_index_delivery ON genre_index(kind,status,key);