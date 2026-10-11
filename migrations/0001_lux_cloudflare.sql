-- Lux Cloudflare baseline. No users/passwords/tokens or private IPTV URLs.
-- Only migrate vetted public metadata to this table until authentication is designed.
CREATE TABLE IF NOT EXISTS public_catalog (
  id TEXT PRIMARY KEY,
  kind TEXT NOT NULL CHECK(kind IN ('live','movie','series','game','book')),
  title TEXT NOT NULL,
  category TEXT NOT NULL DEFAULT '',
  poster_key TEXT,
  published INTEGER NOT NULL DEFAULT 0 CHECK(published IN (0,1)),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now'))
);
CREATE INDEX IF NOT EXISTS idx_public_catalog_kind ON public_catalog(published,kind,updated_at);
CREATE TABLE IF NOT EXISTS app_meta (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now'))
);
