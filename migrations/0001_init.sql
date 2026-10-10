-- Better Auth tables (schema as emitted by better-auth 1.7 getMigrations for SQLite).
create table "user" ("id" text not null primary key, "name" text not null, "email" text not null unique, "emailVerified" integer not null, "image" text, "createdAt" date not null, "updatedAt" date not null);
create table "session" ("id" text not null primary key, "expiresAt" date not null, "token" text not null unique, "createdAt" date not null, "updatedAt" date not null, "ipAddress" text, "userAgent" text, "userId" text not null references "user" ("id") on delete cascade);
create table "account" ("id" text not null primary key, "accountId" text not null, "providerId" text not null, "userId" text not null references "user" ("id") on delete cascade, "accessToken" text, "refreshToken" text, "idToken" text, "accessTokenExpiresAt" date, "refreshTokenExpiresAt" date, "scope" text, "password" text, "createdAt" date not null, "updatedAt" date not null);
create table "verification" ("id" text not null primary key, "identifier" text not null, "value" text not null, "expiresAt" date not null, "createdAt" date not null, "updatedAt" date not null);
create index "session_userId_idx" on "session" ("userId");
create index "account_userId_idx" on "account" ("userId");
create index "verification_identifier_idx" on "verification" ("identifier");

-- Credits. The balance is a cached sum of the ledger; every change to it is
-- written together with its ledger row in one D1 batch (= one transaction).
-- The CHECK is what makes a debit fail atomically when the balance is short.
CREATE TABLE wallets (
  user_id TEXT PRIMARY KEY REFERENCES "user" (id) ON DELETE CASCADE,
  balance INTEGER NOT NULL DEFAULT 0 CHECK (balance >= 0),
  updated_at TEXT NOT NULL
);

CREATE TABLE credit_ledger (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES "user" (id) ON DELETE CASCADE,
  delta INTEGER NOT NULL,
  reason TEXT NOT NULL CHECK (reason IN ('grant', 'generation', 'refund', 'purchase')),
  generation_id TEXT,
  note TEXT,
  created_by TEXT,
  created_at TEXT NOT NULL
);
CREATE INDEX credit_ledger_user ON credit_ledger (user_id, created_at DESC);
-- A generation can be refunded at most once, whoever gets there first
-- (the failing request or the stale-generation cron).
CREATE UNIQUE INDEX credit_ledger_one_refund ON credit_ledger (generation_id) WHERE reason = 'refund';

CREATE TABLE generations (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES "user" (id) ON DELETE CASCADE,
  slot TEXT NOT NULL CHECK (slot IN ('main', 'icon')),
  prompt TEXT NOT NULL,
  reference_image_id TEXT,
  provider TEXT NOT NULL,
  model TEXT NOT NULL,
  quality TEXT,
  status TEXT NOT NULL CHECK (status IN ('pending', 'done', 'failed')),
  cost INTEGER NOT NULL,
  image_id TEXT,
  -- Provider-reported token usage, kept so credit prices can be set from
  -- measured cost rather than guesses.
  usage_json TEXT,
  error TEXT,
  created_at TEXT NOT NULL,
  completed_at TEXT
);
CREATE INDEX generations_status ON generations (status, created_at);
CREATE INDEX generations_user ON generations (user_id, created_at DESC);

CREATE TABLE images (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES "user" (id) ON DELETE CASCADE,
  r2_key TEXT NOT NULL,
  origin TEXT NOT NULL CHECK (origin IN ('upload', 'generated')),
  generation_id TEXT,
  mime TEXT NOT NULL,
  bytes INTEGER NOT NULL,
  label TEXT,
  created_at TEXT NOT NULL
);
CREATE INDEX images_user ON images (user_id, created_at DESC);

CREATE TABLE sheets (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES "user" (id) ON DELETE CASCADE,
  template_id TEXT NOT NULL,
  title TEXT NOT NULL,
  params_json TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX sheets_user ON sheets (user_id, updated_at DESC);
