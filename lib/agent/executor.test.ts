import { readFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';
import { nowIso, openDb, type Db } from '@/lib/db';
import { upsertDispute } from '@/lib/disputes/store';
import type { PayPalClient } from '@/lib/paypal/client';
import type { PayPalDispute } from '@/lib/paypal/dispute-schema';
import { executeDecision } from './executor';
import type { Decision } from './schema';

const fixture = (id: string) => JSON.parse(readFileSync(`fixtures/disputes/snapshots/2026-11-10-before-gate1/${id}.json`, 'utf8')) as PayPalDispute;
const resolved = (d: PayPalDispute) => ({ ...d, status: 'RESOLVED', links: [] }) as PayPalDispute;

function fakePayPal(dispute: PayPalDispute) {
  const client = {
    getDispute: vi.fn(async () => dispute),
    acceptClaim: vi.fn(async () => ({})),
    makeOffer: vi.fn(async () => ({})),
    provideEvidence: vi.fn(async () => ({})),
    provideSupportingInfo: vi.fn(async () => ({})),
  };
  return client as typeof client & PayPalClient;
}

function seedDecision(db: Db, disputeId: string, d: Decision, status = 'proposed') {
  upsertDispute(db, fixture(disputeId), { full: true, source: 'replay' });
  const id = `dec-${Math.random().toString(36).slice(2)}`;
  db.prepare('INSERT INTO decisions (id, dispute_id, action, amount_cents, confidence, payload_json, status, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)').run(
    id, disputeId, d.action, d.amount ? Math.round(d.amount * 100) : null, d.confidence, JSON.stringify({ decision: d, validation: { errors: [], flags: [] } }), status, nowIso(),
  );
  return id;
}
const base: Decision = { action: 'offer_refund', amount: 15, confidence: 0.8, reasoning: ['r'], evidence: [], risks: [], draftMessageToBuyer: 'We can refund $15.' };

describe('executeDecision', () => {
  it('approve: sends the offer with the agent amount and message, records who approved', async () => {
    const db = openDb(':memory:');
    const id = seedDecision(db, 'PP-R-GSO-10197884', base);
    const pp = fakePayPal(fixture('PP-R-GSO-10197884'));
    const r = await executeDecision(db, pp, id, { by: 'ansh' });
    expect(r).toMatchObject({ status: 'executed', paypalAction: 'make_offer' });
    expect(pp.makeOffer).toHaveBeenCalledWith(expect.anything(), { note: 'We can refund $15.', offer_type: 'REFUND', offer_amount: { currency_code: 'USD', value: '15.00' } });
    const row = db.prepare('SELECT status, decided_by FROM decisions WHERE id = ?').get(id);
    expect(row).toEqual({ status: 'executed', decided_by: 'ansh' });
    expect(db.prepare("SELECT COUNT(*) n FROM audit_log WHERE kind = 'decision.executed'").get()).toEqual({ n: 1 });
  });

  it('edit: the human changes the amount and message before approving', async () => {
    const db = openDb(':memory:');
    const id = seedDecision(db, 'PP-R-GSO-10197884', base);
    const pp = fakePayPal(fixture('PP-R-GSO-10197884'));
    await executeDecision(db, pp, id, { by: 'ansh', edits: { amount: 20, message: 'Edited.' } });
    expect(pp.makeOffer).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ note: 'Edited.', offer_amount: { currency_code: 'USD', value: '20.00' } }));
  });

  it('override: a full refund instead of the offer uses accept_claim REFUND', async () => {
    const db = openDb(':memory:');
    const id = seedDecision(db, 'PP-R-GSO-10197884', base);
    const pp = fakePayPal(fixture('PP-R-GSO-10197884'));
    const r = await executeDecision(db, pp, id, { by: 'ansh', override: { action: 'accept', amount: 64 } });
    expect(r.paypalAction).toBe('accept_claim');
    expect(pp.acceptClaim).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ accept_claim_type: 'REFUND' }));
  });

  it('a partial accept becomes PARTIAL_REFUND with the amount', async () => {
    const db = openDb(':memory:');
    const id = seedDecision(db, 'PP-R-SLD-10197881', { ...base, action: 'accept', amount: 20 });
    const pp = fakePayPal(fixture('PP-R-SLD-10197881'));
    await executeDecision(db, pp, id, { by: 'ansh' });
    expect(pp.acceptClaim).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ accept_claim_type: 'PARTIAL_REFUND', refund_amount: { currency_code: 'USD', value: '20.00' } }));
  });

  it('contest on a chargeback under review submits the cited records as supporting info', async () => {
    const db = openDb(':memory:');
    const d: Decision = { ...base, action: 'contest', amount: null, evidence: [{ type: 'signature', recordId: 'ship-VRD-1001', whyItHelps: 'signed' }] };
    const id = seedDecision(db, 'PP-R-SUQ-10197882', d);
    const pp = fakePayPal(fixture('PP-R-SUQ-10197882'));
    const r = await executeDecision(db, pp, id, { by: 'ansh' });
    expect(r.paypalAction).toBe('provide_supporting_info');
    expect((pp.provideSupportingInfo.mock.calls[0] as unknown[])[1]).toMatch(/Signed for by "J. AVERY". \[shipments:ship-VRD-1001\]/);
  });

  it('re-checks PayPal first: if the dispute moved on, nothing is sent', async () => {
    const db = openDb(':memory:');
    const id = seedDecision(db, 'PP-R-GSO-10197884', base);
    const pp = fakePayPal(resolved(fixture('PP-R-GSO-10197884')));
    const r = await executeDecision(db, pp, id, { by: 'ansh' });
    expect(r.status).toBe('failed');
    expect(r.error).toMatch(/make_offer not allowed/);
    expect(pp.makeOffer).not.toHaveBeenCalled();
  });

  it('escalate_to_human never calls PayPal', async () => {
    const db = openDb(':memory:');
    const id = seedDecision(db, 'PP-R-GSO-10197884', { ...base, action: 'escalate_to_human', amount: null });
    const pp = fakePayPal(fixture('PP-R-GSO-10197884'));
    expect(await executeDecision(db, pp, id, { by: 'ansh' })).toMatchObject({ status: 'escalated', paypalAction: null });
    expect(pp.getDispute).not.toHaveBeenCalled();
  });

  it('refuses amounts above the disputed amount, and decisions already executed', async () => {
    const db = openDb(':memory:');
    const id = seedDecision(db, 'PP-R-GSO-10197884', base);
    const pp = fakePayPal(fixture('PP-R-GSO-10197884'));
    expect(await executeDecision(db, pp, id, { by: 'ansh', edits: { amount: 500 } })).toMatchObject({ status: 'failed' });
    await expect(executeDecision(db, pp, id, { by: 'ansh' })).rejects.toThrow(/only proposed or needs_human/);
    expect(pp.makeOffer).not.toHaveBeenCalled();
  });
});
