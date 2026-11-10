// Webhook ingest: verify → dedupe by PayPal event id → fetch the full dispute → upsert + record
// the event. Dependencies are injected so tests can run it without the network.

import { audit, type Db } from '@/lib/db';
import { PayPalDispute, PayPalWebhookEvent } from '@/lib/paypal/dispute-schema';
import type { Verification } from '@/lib/paypal-webhooks';
import { recordDisputeEvent, upsertDispute, type UpsertResult } from './store';

export type IngestDeps = {
  db: Db;
  verify: (headers: Headers, event: unknown) => Promise<Verification>;
  /** GET /v1/customer/disputes/{id}: null if PayPal says it isn't ours, undefined if PayPal can't be reached. */
  fetchDispute: (id: string) => Promise<PayPalDispute | null | undefined>;
};

export type IngestResult =
  | { status: 200; outcome: 'ingested'; disputeId: string; upsert: UpsertResult; full: boolean }
  | { status: 200; outcome: 'duplicate' | 'ignored' | 'not_ours'; disputeId?: string }
  | { status: 400 | 503; outcome: 'rejected'; reason: string };

export async function ingestWebhook(rawBody: string, headers: Headers, deps: IngestDeps): Promise<IngestResult> {
  let json: unknown;
  try {
    json = JSON.parse(rawBody);
  } catch {
    return { status: 400, outcome: 'rejected', reason: 'invalid JSON' };
  }

  // The signature covers the exact body, so verify before trusting anything in it.
  const verification = await deps.verify(headers, json);
  if (verification !== 'SUCCESS') {
    audit(deps.db, 'paypal', 'webhook.rejected', null, { verification });
    // PayPal retries non-2xx; a verification outage (ERROR) deserves that retry.
    return { status: verification === 'ERROR' ? 503 : 400, outcome: 'rejected', reason: `signature ${verification}` };
  }

  const event = PayPalWebhookEvent.safeParse(json);
  if (!event.success) return { status: 400, outcome: 'rejected', reason: 'not a webhook event' };
  const { id: eventId, event_type: eventType } = event.data;

  if (!eventType.startsWith('CUSTOMER.DISPUTE.')) return { status: 200, outcome: 'ignored' };
  const resource = PayPalDispute.safeParse(event.data.resource);
  if (!resource.success) return { status: 400, outcome: 'rejected', reason: 'dispute resource failed validation' };
  const disputeId = resource.data.dispute_id;

  const seen = deps.db.prepare('SELECT 1 FROM dispute_events WHERE paypal_event_id = ?').get(eventId);
  if (seen) return { status: 200, outcome: 'duplicate', disputeId };

  // Webhook resources are partial (no due date or requested evidence): prefer the full record.
  const full = await deps.fetchDispute(disputeId).catch(() => undefined);
  // Verified, but about a dispute this merchant can't see (e.g. PayPal's simulate-event sample).
  // Acknowledge it so PayPal stops retrying; keep it out of the ledger.
  if (full === null) {
    audit(deps.db, 'paypal', 'webhook.not_ours', disputeId, { eventId, eventType });
    return { status: 200, outcome: 'not_ours', disputeId };
  }
  const dispute = full ?? resource.data;

  const result = deps.db.transaction((): IngestResult => {
    const fresh = recordDisputeEvent(deps.db, {
      disputeId,
      paypalEventId: eventId,
      eventType,
      source: 'webhook',
      status: resource.data.status,
      stage: resource.data.dispute_life_cycle_stage,
      payload: event.data,
    });
    if (!fresh) return { status: 200, outcome: 'duplicate', disputeId }; // raced with a concurrent delivery
    const upsert = upsertDispute(deps.db, dispute, { full: Boolean(full), source: 'webhook' });
    audit(deps.db, 'paypal', 'webhook.ingested', disputeId, { eventId, eventType, upsert, full: Boolean(full) });
    return { status: 200, outcome: 'ingested', disputeId, upsert, full: Boolean(full) };
  })();
  return result;
}
