// REPLAY mode data: recorded sandbox disputes and recommendations (fixtures/replay/seed.json),
// loaded into an empty ledger. Timestamps are shifted so the replay looks current whenever it's
// opened: the soonest open deadline lands ~20 hours out, and every other time keeps its real
// spacing. The UI labels all of this REPLAY.

import { existsSync, readFileSync } from 'node:fs';
import type { Db } from '@/lib/db';
import { recordDisputeEvent, upsertDispute } from '@/lib/disputes/store';
import type { PayPalDispute } from '@/lib/paypal/dispute-schema';

export const REPLAY_SEED = 'fixtures/replay/seed.json';
const ISO = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?Z$/;

function shiftDates<T>(value: T, ms: number): T {
  if (typeof value === 'string' && ISO.test(value)) return new Date(Date.parse(value) + ms).toISOString() as T;
  if (Array.isArray(value)) return value.map((v) => shiftDates(v, ms)) as T;
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, shiftDates(v, ms)])) as T;
  return value;
}

export function importReplayIfEmpty(db: Db, now = new Date(), path = REPLAY_SEED): number {
  if (!existsSync(path)) return 0;
  const { n } = db.prepare('SELECT COUNT(*) AS n FROM disputes').get() as { n: number };
  if (n > 0) return 0;
  const seed = JSON.parse(readFileSync(path, 'utf8')) as { disputes: PayPalDispute[]; decisions: Record<string, unknown>[] };
  const dues = seed.disputes.filter((d) => d.status === 'WAITING_FOR_SELLER_RESPONSE' && d.seller_response_due_date).map((d) => Date.parse(d.seller_response_due_date!));
  const shift = dues.length ? now.getTime() + 20 * 3_600_000 - Math.min(...dues) : 0;

  db.transaction(() => {
    for (const raw of seed.disputes) {
      const d = shiftDates(raw, shift);
      upsertDispute(db, d, { full: true, source: 'replay' });
      recordDisputeEvent(db, { disputeId: d.dispute_id, paypalEventId: null, eventType: 'REPLAY.DISPUTE.LOADED', source: 'replay', status: d.status, stage: d.dispute_life_cycle_stage, payload: { note: 'recorded sandbox dispute, dates shifted' } });
    }
    const insert = db.prepare('INSERT OR IGNORE INTO decisions (id, dispute_id, action, amount_cents, confidence, payload_json, status, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)');
    for (const dec of seed.decisions) {
      insert.run(dec.id, dec.dispute_id, dec.action, dec.amount_cents ?? null, dec.confidence ?? null, dec.payload_json, dec.status, new Date(Date.parse(String(dec.created_at)) + shift).toISOString());
    }
  })();
  return seed.disputes.length;
}
