import { describe, expect, it } from 'vitest';
import { openDb } from '@/lib/db';
import { executeDecision } from '@/lib/agent/executor';
import { getDispute } from '@/lib/disputes/store';
import { PayPalClient } from '@/lib/paypal/client';
import { replayFetch } from '@/lib/paypal/replay';
import { defaultPlaybook, getPlaybook, savePlaybook } from '@/lib/settings';
import { importReplayIfEmpty, replayNeedsReset, resetReplay } from './seed';

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
    const { client } = setup();
    const gso = await client.getDispute('PP-R-GSO-10197884');
    await client.makeOffer(gso, { note: 'n', offer_type: 'REFUND', offer_amount: { currency_code: 'USD', value: '10.00' } });
    expect((await client.getDispute('PP-R-GSO-10197884')).status).toBe('WAITING_FOR_BUYER_RESPONSE');
    const suq = await client.getDispute('PP-R-SUQ-10197882'); // chargeback under review
    const e = await client.request('POST', '/v1/customer/disputes/PP-R-SUQ-10197882/make-offer', { json: {} }).catch((x) => x);
    expect(String(e)).toMatch(/400/);
    expect(suq.status).toBe('UNDER_REVIEW');
  });

  it('the shared demo resets once idle after use: disputes, recommendations and Playbook go back to the start', async () => {
    const db = openDb(':memory:');
    const now = Date.now();
    importReplayIfEmpty(db, new Date(now));
    const client = new PayPalClient({ clientId: 'replay', clientSecret: 'replay', fetch: replayFetch(db), sleep: async () => {} });
    const { id } = db.prepare("SELECT id FROM decisions WHERE dispute_id = 'PP-R-SLD-10197881'").get() as { id: string };
    await executeDecision(db, client, id, { by: 'judge' });
    savePlaybook(db, { ...defaultPlaybook(), approvalThresholdUsd: 10 }, 'judge');

    expect(replayNeedsReset(db, new Date(now + 60_000))).toBe(false); // someone is still using it
    expect(replayNeedsReset(db, new Date(now + 21 * 60_000))).toBe(true);
    const audits = (db.prepare('SELECT COUNT(*) AS n FROM audit_log').get() as { n: number }).n;

    expect(resetReplay(db)).toBe(9);
    expect(getDispute(db, 'PP-R-SLD-10197881')?.status).toBe('WAITING_FOR_SELLER_RESPONSE');
    expect(db.prepare("SELECT status FROM decisions WHERE dispute_id = 'PP-R-SLD-10197881'").all()).toEqual([{ status: 'proposed' }]);
    expect(getPlaybook(db)).toEqual(defaultPlaybook());
    expect((db.prepare('SELECT COUNT(*) AS n FROM audit_log').get() as { n: number }).n).toBe(audits); // rate limits still count
    expect(replayNeedsReset(db, new Date(Date.now() + 21 * 60_000))).toBe(false);
  });

  it('an untouched demo only resets once its shifted dates have drifted', () => {
    const db = openDb(':memory:');
    const now = Date.now();
    importReplayIfEmpty(db, new Date(now));
    expect(replayNeedsReset(db, new Date(now + 60 * 60_000))).toBe(false);
    expect(replayNeedsReset(db, new Date(now + 7 * 3_600_000))).toBe(true);
  });
});
