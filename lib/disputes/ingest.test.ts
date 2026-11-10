import { readdirSync, readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import { openDb, type Db } from '@/lib/db';
import type { PayPalDispute } from '@/lib/paypal/dispute-schema';
import type { Verification } from '@/lib/paypal-webhooks';
import { ingestWebhook, type IngestDeps } from './ingest';
import { getDispute } from './store';
import { syncDisputes } from './sync';

// Real (redacted) sandbox payloads: a CUSTOMER.DISPUTE.UPDATED delivery and the full GET of the same dispute.
const DISPUTE_ID = 'PP-R-SLD-10197881';
const webhookFile = readdirSync('fixtures/webhooks').find((f) => {
  const j = JSON.parse(readFileSync(`fixtures/webhooks/${f}`, 'utf8'));
  return j.event.event_type === 'CUSTOMER.DISPUTE.UPDATED' && j.event.resource?.dispute_id === DISPUTE_ID;
})!;
const realEvent = JSON.parse(readFileSync(`fixtures/webhooks/${webhookFile}`, 'utf8')).event;
const fullDispute = JSON.parse(readFileSync(`fixtures/disputes/${DISPUTE_ID}.json`, 'utf8')) as PayPalDispute;

// Stand-in for PayPal's verify API: the "signature" is a hash of the exact body it was sent with,
// so any change to the payload after signing fails verification, as it does with PayPal.
const sign = (body: string) => createHash('sha256').update(body).digest('hex');
const signedHeaders = (body: string) => new Headers({ 'paypal-transmission-sig': sign(body) });
const fakeVerify = async (headers: Headers, event: unknown): Promise<Verification> =>
  headers.get('paypal-transmission-sig') === sign(JSON.stringify(event)) ? 'SUCCESS' : 'FAILURE';

function setup(overrides: Partial<IngestDeps> = {}) {
  const db = openDb(':memory:');
  const deps: IngestDeps = { db, verify: fakeVerify, fetchDispute: vi.fn(async () => fullDispute), ...overrides };
  return { db, deps };
}
const count = (db: Db, sql: string, ...args: unknown[]) => (db.prepare(sql).get(...args) as { n: number }).n;

describe('ingestWebhook', () => {
  it('ingests a verified dispute event, links it to the store order, and keeps the full record', async () => {
    const { db, deps } = setup();
    const body = JSON.stringify(realEvent);
    const r = await ingestWebhook(body, signedHeaders(body), deps);
    expect(r).toMatchObject({ status: 200, outcome: 'ingested', disputeId: DISPUTE_ID, upsert: 'inserted', full: true });
    const row = getDispute(db, DISPUTE_ID)!;
    expect(row.order_id).toBe('VRD-1008'); // seller_transaction_id -> orders.paypal_capture_id
    expect(row.amount_cents).toBe(4740);
    expect(row.seller_response_due_at).toBe(fullDispute.seller_response_due_date);
    expect(row.raw_is_full).toBe(1);
    expect(count(db, 'SELECT COUNT(*) n FROM dispute_events WHERE dispute_id = ?', DISPUTE_ID)).toBe(1);
  });

  it('rejects a tampered payload and writes nothing to the ledger', async () => {
    const { db, deps } = setup();
    const body = JSON.stringify(realEvent);
    const headers = signedHeaders(body);
    const tampered = JSON.parse(body);
    tampered.resource.dispute_amount.value = '4740.00';
    const r = await ingestWebhook(JSON.stringify(tampered), headers, deps);
    expect(r).toMatchObject({ status: 400, outcome: 'rejected' });
    expect(count(db, 'SELECT COUNT(*) n FROM disputes')).toBe(0);
    expect(count(db, 'SELECT COUNT(*) n FROM dispute_events')).toBe(0);
    expect(deps.fetchDispute).not.toHaveBeenCalled();
    expect(count(db, "SELECT COUNT(*) n FROM audit_log WHERE kind = 'webhook.rejected'")).toBe(1);
  });

  it('rejects unsigned events and invalid JSON', async () => {
    const { deps } = setup();
    expect(await ingestWebhook(JSON.stringify(realEvent), new Headers(), deps)).toMatchObject({ status: 400 });
    expect(await ingestWebhook('{not json', new Headers(), deps)).toMatchObject({ status: 400, outcome: 'rejected' });
  });

  it('asks PayPal to retry (503) when verification itself is unavailable', async () => {
    const { deps } = setup({ verify: async () => 'ERROR' });
    expect(await ingestWebhook(JSON.stringify(realEvent), new Headers(), deps)).toMatchObject({ status: 503 });
  });

  it('is idempotent: a re-delivered event is acknowledged but not applied twice', async () => {
    const { db, deps } = setup();
    const body = JSON.stringify(realEvent);
    const first = await ingestWebhook(body, signedHeaders(body), deps);
    const again = await ingestWebhook(body, signedHeaders(body), deps);
    const concurrent = await Promise.all([ingestWebhook(body, signedHeaders(body), deps), ingestWebhook(body, signedHeaders(body), deps)]);
    expect(first.outcome).toBe('ingested');
    expect(again).toMatchObject({ status: 200, outcome: 'duplicate' });
    expect(concurrent.every((r) => r.status === 200 && r.outcome === 'duplicate')).toBe(true);
    expect(count(db, 'SELECT COUNT(*) n FROM dispute_events')).toBe(1);
    expect(count(db, 'SELECT COUNT(*) n FROM disputes')).toBe(1);
  });

  it('never lets an older event overwrite newer dispute state', async () => {
    const { db, deps } = setup({ fetchDispute: async () => undefined }); // force the webhook resource path
    const newer = structuredClone(realEvent);
    newer.id = 'WH-NEWER';
    newer.resource.update_time = '2026-11-10T07:00:00.000Z';
    newer.resource.status = 'UNDER_REVIEW';
    const older = structuredClone(realEvent);
    older.id = 'WH-OLDER';
    older.resource.update_time = '2026-11-10T05:00:00.000Z';
    older.resource.status = 'WAITING_FOR_SELLER_RESPONSE';
    for (const e of [newer, older]) {
      const body = JSON.stringify(e);
      await ingestWebhook(body, signedHeaders(body), deps);
    }
    expect(getDispute(db, DISPUTE_ID)!.status).toBe('UNDER_REVIEW');
    expect(count(db, 'SELECT COUNT(*) n FROM dispute_events')).toBe(2); // history still records both
  });

  it('falls back to the partial webhook resource when PayPal GET fails, without inventing a due date', async () => {
    const { db, deps } = setup({ fetchDispute: async () => undefined });
    const body = JSON.stringify(realEvent);
    const r = await ingestWebhook(body, signedHeaders(body), deps);
    expect(r).toMatchObject({ outcome: 'ingested', full: false });
    const row = getDispute(db, DISPUTE_ID)!;
    expect(row.raw_is_full).toBe(0);
    expect(row.seller_response_due_at).toBeNull();
  });

  it('ignores non-dispute events', async () => {
    const { db, deps } = setup();
    const e = { id: 'WH-X', event_type: 'PAYMENT.CAPTURE.COMPLETED', resource: {} };
    const body = JSON.stringify(e);
    expect(await ingestWebhook(body, signedHeaders(body), deps)).toMatchObject({ status: 200, outcome: 'ignored' });
    expect(count(db, 'SELECT COUNT(*) n FROM dispute_events')).toBe(0);
  });

  it("acknowledges but doesn't store a verified event for a dispute PayPal says isn't ours", async () => {
    const { db, deps } = setup({ fetchDispute: async () => null });
    const body = JSON.stringify(realEvent);
    expect(await ingestWebhook(body, signedHeaders(body), deps)).toMatchObject({ status: 200, outcome: 'not_ours' });
    expect(count(db, 'SELECT COUNT(*) n FROM disputes')).toBe(0);
    expect(count(db, 'SELECT COUNT(*) n FROM dispute_events')).toBe(0);
  });
});

describe('syncDisputes (polling fallback)', () => {
  const summary = { dispute_id: DISPUTE_ID, update_time: fullDispute.update_time, status: fullDispute.status, dispute_life_cycle_stage: fullDispute.dispute_life_cycle_stage };

  it('discovers disputes the webhook missed, then skips them until they change', async () => {
    const { db } = setup();
    const fetchDispute = vi.fn(async () => fullDispute);
    const listDisputes = async () => [summary];
    expect(await syncDisputes({ db, listDisputes, fetchDispute })).toMatchObject({ listed: 1, inserted: 1, updated: 0 });
    expect(await syncDisputes({ db, listDisputes, fetchDispute })).toMatchObject({ listed: 1, fetched: 0, inserted: 0 });
    expect(fetchDispute).toHaveBeenCalledTimes(1);
    expect(getDispute(db, DISPUTE_ID)!.source).toBe('poll');
  });

  it('refetches when PayPal reports a newer update_time', async () => {
    const { db } = setup();
    const changed = { ...fullDispute, update_time: '2026-11-10T09:00:00.000Z', status: 'UNDER_REVIEW' };
    let current: PayPalDispute = fullDispute;
    const deps = { db, listDisputes: async () => [{ ...summary, update_time: current.update_time }], fetchDispute: async () => current };
    await syncDisputes(deps);
    current = changed;
    expect(await syncDisputes(deps)).toMatchObject({ updated: 1 });
    expect(getDispute(db, DISPUTE_ID)!.status).toBe('UNDER_REVIEW');
    expect(count(db, "SELECT COUNT(*) n FROM dispute_events WHERE event_type = 'POLL.DISPUTE.CHANGED'")).toBe(1);
  });

  it('completes a dispute that only arrived as a partial webhook resource', async () => {
    const { db, deps } = setup({ fetchDispute: async () => undefined });
    const body = JSON.stringify(realEvent);
    await ingestWebhook(body, signedHeaders(body), deps);
    await syncDisputes({ db, listDisputes: async () => [summary], fetchDispute: async () => fullDispute });
    expect(getDispute(db, DISPUTE_ID)!.raw_is_full).toBe(1);
  });
});
