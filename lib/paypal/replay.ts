// REPLAY transport: a stand-in for the PayPal sandbox used by PayPalClient in REPLAY mode (the
// public demo URL and the end-to-end test). Reads disputes from the ledger and applies the state
// transitions we recorded in the real sandbox (docs/api-notes.md), so the executor and guardrails
// run unchanged. It never contacts PayPal.

import type { Db } from '@/lib/db';
import { getDispute, recordDisputeEvent, upsertDispute } from '@/lib/disputes/store';
import { PayPalDispute } from './dispute-schema';

type Link = { href: string; rel: string; method: string };
const BASE = 'https://api-m.sandbox.paypal.com/v1/customer/disputes';
const links = (id: string, ...rels: string[]): Link[] => [{ href: `${BASE}/${id}`, rel: 'self', method: 'GET' }, ...rels.map((rel) => ({ href: `${BASE}/${id}/${rel.replace(/_/g, '-')}`, rel, method: 'POST' }))];

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json', 'paypal-debug-id': 'replay' } });
const notAllowed = () => json({ name: 'INVALID_REQUEST', message: 'Request is not well-formed, syntactically incorrect, or violates schema.', details: [{ issue: 'ACTION_NOT_ALLOWED_IN_CURRENT_DISPUTE_STATE' }] }, 400);

// Recorded sandbox behaviour, one entry per write action.
function transition(d: PayPalDispute, action: string): PayPalDispute | null {
  const id = d.dispute_id;
  const chargeback = d.dispute_life_cycle_stage !== 'INQUIRY';
  switch (action) {
    case 'accept-claim':
      return { ...d, status: 'RESOLVED', dispute_outcome: { outcome_code: 'RESOLVED_BUYER_FAVOUR', outcome_reason: 'SELLER_ISSUED_REFUND', amount_refunded: d.dispute_amount } as never, links: links(id) };
    case 'make-offer':
      return { ...d, status: 'WAITING_FOR_BUYER_RESPONSE', links: links(id, 'send_message', 'escalate') };
    case 'provide-evidence':
      return { ...d, status: 'UNDER_REVIEW', links: links(id, ...(chargeback ? ['provide_supporting_info'] : [])) };
    case 'provide-supporting-info':
      return { ...d, status: 'UNDER_REVIEW' };
    case 'escalate':
      return { ...d, dispute_life_cycle_stage: 'CHARGEBACK', status: 'UNDER_REVIEW', links: links(id, 'provide_supporting_info') };
    case 'send-message':
      return d;
    default:
      return null;
  }
}

export function replayFetch(db: Db): typeof fetch {
  return (async (input: string | URL | Request, init: RequestInit = {}) => {
    const url = new URL(String(input instanceof Request ? input.url : input));
    const method = (init.method ?? 'GET').toUpperCase();
    if (url.pathname === '/v1/oauth2/token') return json({ access_token: 'replay', token_type: 'Bearer', expires_in: 32_000, scope: 'replay' });

    if (method === 'GET' && url.pathname === '/v1/customer/disputes') {
      const rows = db.prepare('SELECT raw_json FROM disputes ORDER BY created_at DESC').all() as { raw_json: string }[];
      return json({ items: rows.map((r) => JSON.parse(r.raw_json)), links: [] });
    }
    const m = url.pathname.match(/^\/v1\/customer\/disputes\/([^/]+)(?:\/([a-z-]+))?$/);
    if (!m) return json({ name: 'RESOURCE_NOT_FOUND', message: 'Not found in replay data.' }, 404);
    const row = getDispute(db, decodeURIComponent(m[1]));
    if (!row) return json({ name: 'RESOURCE_NOT_FOUND', message: 'The specified resource does not exist.' }, 404);
    const current = PayPalDispute.parse(JSON.parse(row.raw_json));
    if (method === 'GET' && !m[2]) return json(current);

    // Like PayPal, only actions the dispute's HATEOAS links offer are accepted.
    const offered = m[2] && (current.links ?? []).some((l) => l.rel === m[2]!.replace(/-/g, '_'));
    const next = method === 'POST' && offered ? transition(current, m[2]!) : null;
    if (!next) return notAllowed();
    // Always newer than the record it replaces (replayed timestamps are shifted, so the wall clock may be earlier).
    const updated = { ...next, update_time: new Date(Math.max(Date.now(), Date.parse(current.update_time) + 1000)).toISOString() };
    db.transaction(() => {
      upsertDispute(db, updated, { full: true, source: 'replay' });
      recordDisputeEvent(db, { disputeId: current.dispute_id, paypalEventId: null, eventType: `REPLAY.${m[2]!.toUpperCase().replace(/-/g, '_')}`, source: 'replay', status: updated.status, stage: updated.dispute_life_cycle_stage, payload: { action: m[2] } });
    })();
    return json({ links: [{ href: `${BASE}/${current.dispute_id}`, rel: 'detail', method: 'GET' }] });
  }) as typeof fetch;
}
