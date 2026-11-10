// The disputes ledger: upserts PayPal disputes into SQLite and records their event history.
// PayPal's update_time orders the writes, so a late or re-delivered event never overwrites newer data.

import { nowIso, type Db } from '@/lib/db';
import { MERCHANT_ID } from '@/lib/db/seed';
import { toCents, type PayPalDispute } from '@/lib/paypal/dispute-schema';

export type DisputeSource = 'webhook' | 'poll' | 'replay';

export type DisputeRow = {
  id: string;
  merchant_id: string | null;
  order_id: string | null;
  seller_transaction_id: string | null;
  buyer_transaction_id: string | null;
  reason: string;
  status: string;
  stage: string;
  channel: string | null;
  amount_cents: number;
  currency: string;
  seller_response_due_at: string | null;
  created_at: string;
  updated_at: string;
  outcome: string | null;
  raw_json: string;
  raw_is_full: number;
  source: string;
  last_synced_at: string;
};

export type UpsertResult = 'inserted' | 'updated' | 'unchanged' | 'stale';

export function getDispute(db: Db, id: string): DisputeRow | undefined {
  return db.prepare('SELECT * FROM disputes WHERE id = ?').get(id) as DisputeRow | undefined;
}

/**
 * Insert or update a dispute from a PayPal representation. `full` says whether it came from
 * GET /v1/customer/disputes/{id} (complete) or a webhook resource (partial: no due date).
 * A partial representation never erases fields that only the full one carries.
 */
export function upsertDispute(db: Db, d: PayPalDispute, opts: { full: boolean; source: DisputeSource }): UpsertResult {
  const existing = getDispute(db, d.dispute_id);
  const now = nowIso();
  const tx = d.disputed_transactions?.[0];
  const sellerTxn = tx?.seller_transaction_id ?? null;
  const order = sellerTxn
    ? (db.prepare('SELECT id, merchant_id FROM orders WHERE paypal_capture_id = ?').get(sellerTxn) as { id: string; merchant_id: string } | undefined)
    : undefined;

  if (existing) {
    const incoming = Date.parse(d.update_time);
    const stored = Date.parse(existing.updated_at);
    // Older than what we have, or the same version but less complete: keep ours.
    if (incoming < stored) return 'stale';
    if (incoming === stored && (existing.raw_is_full || !opts.full)) {
      db.prepare('UPDATE disputes SET last_synced_at = ? WHERE id = ?').run(now, d.dispute_id);
      return 'unchanged';
    }
  }

  const row = {
    id: d.dispute_id,
    merchant_id: order?.merchant_id ?? existing?.merchant_id ?? MERCHANT_ID,
    order_id: order?.id ?? existing?.order_id ?? null,
    seller_transaction_id: sellerTxn ?? existing?.seller_transaction_id ?? null,
    buyer_transaction_id: tx?.buyer_transaction_id ?? existing?.buyer_transaction_id ?? null,
    reason: d.reason,
    status: d.status,
    stage: d.dispute_life_cycle_stage,
    channel: d.dispute_channel ?? existing?.channel ?? null,
    amount_cents: toCents(d.dispute_amount.value),
    currency: d.dispute_amount.currency_code,
    // Only a full representation is authoritative about the due date (it disappears once UNDER_REVIEW).
    seller_response_due_at: opts.full ? (d.seller_response_due_date ?? null) : (existing?.seller_response_due_at ?? null),
    created_at: d.create_time,
    updated_at: d.update_time,
    outcome: d.dispute_outcome?.outcome_code ?? existing?.outcome ?? null,
    raw_json: opts.full || !existing ? JSON.stringify(d) : existing.raw_json,
    raw_is_full: opts.full ? 1 : (existing?.raw_is_full ?? 0),
    source: opts.source,
    last_synced_at: now,
  };

  db.prepare(
    `INSERT INTO disputes (id, merchant_id, order_id, seller_transaction_id, buyer_transaction_id, reason, status, stage, channel,
       amount_cents, currency, seller_response_due_at, created_at, updated_at, outcome, raw_json, raw_is_full, source, last_synced_at)
     VALUES (@id, @merchant_id, @order_id, @seller_transaction_id, @buyer_transaction_id, @reason, @status, @stage, @channel,
       @amount_cents, @currency, @seller_response_due_at, @created_at, @updated_at, @outcome, @raw_json, @raw_is_full, @source, @last_synced_at)
     ON CONFLICT(id) DO UPDATE SET
       merchant_id = excluded.merchant_id, order_id = excluded.order_id,
       seller_transaction_id = excluded.seller_transaction_id, buyer_transaction_id = excluded.buyer_transaction_id,
       reason = excluded.reason, status = excluded.status, stage = excluded.stage, channel = excluded.channel,
       amount_cents = excluded.amount_cents, currency = excluded.currency,
       seller_response_due_at = excluded.seller_response_due_at, created_at = excluded.created_at,
       updated_at = excluded.updated_at, outcome = excluded.outcome, raw_json = excluded.raw_json,
       raw_is_full = excluded.raw_is_full, source = excluded.source, last_synced_at = excluded.last_synced_at`,
  ).run(row);
  return existing ? 'updated' : 'inserted';
}

/** Append to a dispute's history. Returns false if this PayPal event id was already recorded. */
export function recordDisputeEvent(
  db: Db,
  e: { disputeId: string; paypalEventId: string | null; eventType: string; source: string; status?: string; stage?: string; payload: unknown },
): boolean {
  const res = db
    .prepare(
      `INSERT OR IGNORE INTO dispute_events (dispute_id, paypal_event_id, event_type, source, status, stage, payload_json, received_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(e.disputeId, e.paypalEventId, e.eventType, e.source, e.status ?? null, e.stage ?? null, JSON.stringify(e.payload), nowIso());
  return res.changes === 1;
}
