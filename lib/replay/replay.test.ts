import { describe, expect, it } from 'vitest';
import { openDb } from '@/lib/db';
import { executeDecision } from '@/lib/agent/executor';
import { getDispute } from '@/lib/disputes/store';
import { PayPalClient } from '@/lib/paypal/client';
import { replayFetch } from '@/lib/paypal/replay';
import { importReplayIfEmpty } from './seed';

const NOW = new Date('2026-12-05T15:00:00.000Z');

function setup() {
  const db = openDb(':memory:');
  const loaded = importReplayIfEmpty(db, NOW);
  const client = new PayPalClient({ clientId: 'replay', clientSecret: 'replay', fetch: replayFetch(db), sleep: async () => {} });
  return { db, loaded, client };
}

describe('REPLAY mode', () => {
  it('loads the recorded disputes once, shifted so the soonest deadline is ~20h away', () => {
    const { db, loaded } = setup();
    expect(loaded).toBe(9);
    expect(importReplayIfEmpty(db, NOW)).toBe(0); // idempotent
    const dues = (db.prepare("SELECT seller_response_due_at AS d FROM disputes WHERE status = 'WAITING_FOR_SELLER_RESPONSE' AND d IS NOT NULL").all() as { d: string }[]).map((r) => Date.parse(r.d));
    expect(Math.min(...dues) - NOW.getTime()).toBe(20 * 3_600_000);
    // Disputes still join to their store orders.
    expect(getDispute(db, 'PP-R-SLD-10197881')?.order_id).toBe('VRD-1008');
  });

  it('loads the recorded recommendations awaiting approval', () => {
    const { db } = setup();
    const rows = db.prepare('SELECT dispute_id, action, status FROM decisions ORDER BY dispute_id').all() as { dispute_id: string; action: string; status: string }[];
    expect(rows.map((r) => r.status).every((s) => s === 'proposed' || s === 'needs_human')).toBe(true);
    expect(rows.find((r) => r.dispute_id === 'PP-R-SLD-10197881')).toMatchObject({ action: 'accept', status: 'proposed' });
  });

  it('an approved refund runs through the real executor and resolves, without contacting PayPal', async () => {
    const { db, client } = setup();
    const { id } = db.prepare("SELECT id FROM decisions WHERE dispute_id = 'PP-R-SLD-10197881'").get() as { id: string };
    const r = await executeDecision(db, client, id, { by: 'e2e' });
    expect(r).toMatchObject({ status: 'executed', paypalAction: 'accept_claim', disputeStateAfter: 'INQUIRY/RESOLVED' });
    expect(getDispute(db, 'PP-R-SLD-10197881')).toMatchObject({ status: 'RESOLVED', outcome: 'RESOLVED_BUYER_FAVOUR', source: 'replay' });
  });

  it('applies recorded transitions: an offer waits on the buyer; disallowed actions are refused like PayPal', async () => {
    const { db, client } = setup();
    const gso = await client.getDispute('PP-R-GSO-10197884');
    await client.makeOffer(gso, { note: 'n', offer_type: 'REFUND', offer_amount: { currency_code: 'USD', value: '10.00' } });
    expect((await client.getDispute('PP-R-GSO-10197884')).status).toBe('WAITING_FOR_BUYER_RESPONSE');
    const suq = await client.getDispute('PP-R-SUQ-10197882'); // chargeback under review
    const e = await client.request('POST', '/v1/customer/disputes/PP-R-SUQ-10197882/make-offer', { json: {} }).catch((x) => x);
    expect(String(e)).toMatch(/400/);
    expect(suq.status).toBe('UNDER_REVIEW');
  });
});
