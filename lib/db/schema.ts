// SQLite schema for Verdict. Money is stored in integer cents; times are ISO-8601 UTC strings.
// Bump SCHEMA_VERSION and add a migration step in lib/db/index.ts when this changes.

export const SCHEMA_VERSION = 2;

export const SCHEMA = /* sql */ `
CREATE TABLE IF NOT EXISTS merchants (
  id                  TEXT PRIMARY KEY,
  name                TEXT NOT NULL,
  paypal_merchant_id  TEXT,
  policy_json         TEXT NOT NULL,          -- refund/return/shipping policy the agent may cite
  created_at          TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS products (
  id           TEXT PRIMARY KEY,
  merchant_id  TEXT NOT NULL REFERENCES merchants(id),
  sku          TEXT NOT NULL UNIQUE,
  name         TEXT NOT NULL,
  category     TEXT NOT NULL,
  price_cents  INTEGER NOT NULL,
  description  TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS customers (
  id           TEXT PRIMARY KEY,
  merchant_id  TEXT NOT NULL REFERENCES merchants(id),
  name         TEXT NOT NULL,
  email        TEXT NOT NULL,
  city         TEXT NOT NULL,
  region       TEXT NOT NULL,
  first_seen   TEXT NOT NULL,
  notes        TEXT                            -- e.g. prior contact with support
);

CREATE TABLE IF NOT EXISTS orders (
  id                 TEXT PRIMARY KEY,         -- store order number, e.g. KC-1042 or VRD-1001
  merchant_id        TEXT NOT NULL REFERENCES merchants(id),
  customer_id        TEXT NOT NULL REFERENCES customers(id),
  status             TEXT NOT NULL,            -- PAID | SHIPPED | DELIVERED | REFUNDED | CANCELLED | DUPLICATE_PAYMENT
  currency           TEXT NOT NULL,
  total_cents        INTEGER NOT NULL,
  items_json         TEXT NOT NULL,            -- [{ productId, sku, name, qty, unitCents }]
  ship_to_json       TEXT NOT NULL,            -- { city, region, postal }
  created_at         TEXT NOT NULL,
  paypal_order_id    TEXT,
  paypal_capture_id  TEXT UNIQUE,              -- joins to disputes.seller_transaction_id
  source             TEXT NOT NULL,            -- seed | sandbox | eval
  note               TEXT,                     -- internal note, e.g. why a payment was duplicated
  refunded_cents     INTEGER,
  refunded_at        TEXT
);
CREATE INDEX IF NOT EXISTS orders_customer ON orders(customer_id);

CREATE TABLE IF NOT EXISTS shipments (
  id                 TEXT PRIMARY KEY,
  order_id           TEXT NOT NULL REFERENCES orders(id),
  carrier            TEXT NOT NULL,
  tracking_number    TEXT,
  status             TEXT NOT NULL,            -- LABEL_CREATED | IN_TRANSIT | DELIVERED | LOST | RETURNED
  shipped_at         TEXT,
  delivered_at       TEXT,
  signed_by          TEXT,
  delivered_to_json  TEXT,                     -- where the carrier says it went: { city, region, postal }
  address_match      INTEGER,                  -- 1 if delivered_to matches the order's ship_to
  events_json        TEXT NOT NULL,            -- carrier scan history [{ at, status, location }]
  synced_to_paypal   INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS shipments_order ON shipments(order_id);

CREATE TABLE IF NOT EXISTS disputes (
  id                      TEXT PRIMARY KEY,    -- PayPal dispute_id
  merchant_id             TEXT REFERENCES merchants(id),
  order_id                TEXT REFERENCES orders(id),
  seller_transaction_id   TEXT,
  buyer_transaction_id    TEXT,
  reason                  TEXT NOT NULL,
  status                  TEXT NOT NULL,
  stage                   TEXT NOT NULL,
  channel                 TEXT,
  amount_cents            INTEGER NOT NULL,
  currency                TEXT NOT NULL,
  seller_response_due_at  TEXT,
  created_at              TEXT NOT NULL,
  updated_at              TEXT NOT NULL,       -- PayPal update_time; newer data only overwrites older
  outcome                 TEXT,
  raw_json                TEXT NOT NULL,       -- latest full PayPal representation
  raw_is_full             INTEGER NOT NULL,    -- 1 if raw_json came from GET (webhook resources are partial)
  source                  TEXT NOT NULL,       -- webhook | poll | replay
  last_synced_at          TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS disputes_due ON disputes(seller_response_due_at);

CREATE TABLE IF NOT EXISTS dispute_events (
  id               INTEGER PRIMARY KEY AUTOINCREMENT,
  dispute_id       TEXT NOT NULL,
  paypal_event_id  TEXT UNIQUE,                -- webhook event id; NULL for poll-detected changes
  event_type       TEXT NOT NULL,
  source           TEXT NOT NULL,              -- webhook | poll | replay | action
  status           TEXT,
  stage            TEXT,
  payload_json     TEXT NOT NULL,
  received_at      TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS dispute_events_dispute ON dispute_events(dispute_id, received_at);

CREATE TABLE IF NOT EXISTS evidence_items (
  id            TEXT PRIMARY KEY,
  dispute_id    TEXT NOT NULL REFERENCES disputes(id),
  type          TEXT NOT NULL,
  record_table  TEXT NOT NULL,                 -- every item cites a real row
  record_id     TEXT NOT NULL,
  summary       TEXT NOT NULL,
  created_at    TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS decisions (
  id            TEXT PRIMARY KEY,
  dispute_id    TEXT NOT NULL REFERENCES disputes(id),
  action        TEXT NOT NULL,
  amount_cents  INTEGER,
  confidence    REAL,
  payload_json  TEXT NOT NULL,                 -- the full validated agent decision
  status        TEXT NOT NULL,                 -- proposed | needs_human | approved | executed | rejected | failed
  created_at    TEXT NOT NULL,
  decided_by    TEXT,
  executed_at   TEXT,
  result_json   TEXT
);

CREATE TABLE IF NOT EXISTS arena_scenarios (
  id            TEXT PRIMARY KEY,
  seed          INTEGER NOT NULL,
  dispute_type  TEXT NOT NULL,
  persona       TEXT NOT NULL,
  ground_truth  TEXT NOT NULL,                 -- merchant_at_fault | buyer_at_fault | ambiguous
  order_id      TEXT REFERENCES orders(id),
  payload_json  TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS arena_runs (
  id            TEXT PRIMARY KEY,
  scenario_id   TEXT NOT NULL REFERENCES arena_scenarios(id),
  started_at    TEXT NOT NULL,
  finished_at   TEXT,
  mode          TEXT NOT NULL,                 -- live | replay
  result_json   TEXT,
  arbiter_json  TEXT                           -- SIMULATED arbiter verdict and rule trace
);

CREATE TABLE IF NOT EXISTS audit_log (
  id        INTEGER PRIMARY KEY AUTOINCREMENT,
  at        TEXT NOT NULL,
  actor     TEXT NOT NULL,                     -- system | agent | human | paypal
  kind      TEXT NOT NULL,
  ref       TEXT,
  data_json TEXT NOT NULL
);
`;

// Upgrades for databases created by an older SCHEMA_VERSION (index = target version).
export const MIGRATIONS: Record<number, string> = {
  2: `ALTER TABLE orders ADD COLUMN note TEXT;
      ALTER TABLE orders ADD COLUMN refunded_cents INTEGER;
      ALTER TABLE orders ADD COLUMN refunded_at TEXT;`,
};
