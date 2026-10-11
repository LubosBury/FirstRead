-- App-wide settings an admin can change without a deploy. Missing keys fall
-- back to the Worker vars (e.g. no default_engine row = IMAGE_PROVIDER +
-- IMAGE_QUALITY), so a fresh database needs no seed.
CREATE TABLE app_settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  updated_by TEXT
);
