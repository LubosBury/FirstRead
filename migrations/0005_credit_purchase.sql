-- Buying credits. Exactly three packs: admins edit them in Správa, nobody adds
-- or deletes. The seeded prices are placeholders.
CREATE TABLE credit_packs (
  id TEXT PRIMARY KEY,
  credits INTEGER NOT NULL CHECK (credits > 0),
  -- Whole koruna.
  price_czk INTEGER NOT NULL CHECK (price_czk > 0),
  label TEXT,
  active INTEGER NOT NULL DEFAULT 1,
  updated_at TEXT NOT NULL,
  updated_by TEXT
);

INSERT INTO credit_packs (id, credits, price_czk, label, active, updated_at) VALUES
  ('small', 20, 99, 'Malý', 1, strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  ('medium', 60, 249, 'Střední', 1, strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  ('large', 150, 499, 'Velký', 1, strftime('%Y-%m-%dT%H:%M:%fZ', 'now'));

-- One row per credited checkout session. The primary key is what stops a
-- replayed webhook from crediting twice: the ledger row is written in the same
-- batch and only if this insert took (see creditPurchase).
CREATE TABLE credit_purchases (
  session_id TEXT PRIMARY KEY,
  provider TEXT NOT NULL,
  user_id TEXT NOT NULL REFERENCES "user" (id) ON DELETE CASCADE,
  pack_id TEXT NOT NULL,
  -- As sold: an admin editing the pack later does not change these.
  credits INTEGER NOT NULL CHECK (credits > 0),
  amount_czk INTEGER NOT NULL,
  ledger_id TEXT NOT NULL,
  event_id TEXT,
  created_at TEXT NOT NULL
);
CREATE INDEX credit_purchases_user ON credit_purchases (user_id, created_at DESC);
