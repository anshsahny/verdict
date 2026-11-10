// Read models for the UI: flat rows for AG Studio data sources, and the full Case File. Server-only.

import type { Db } from '@/lib/db';
import { computeDeadline, formatRemaining, type DeadlineBucket } from '@/lib/disputes/deadline';
import { getDispute, type DisputeRow } from '@/lib/disputes/store';
import { buildEvidencePacket, type EvidencePacket } from '@/lib/evidence/packet';
import { availableAgentActions } from '@/lib/agent/guardrails';
import type { Decision } from '@/lib/agent/schema';
import { buyerText } from '@/lib/agent/tools';
import { requestedEvidence } from '@/lib/paypal/actions';
import { PayPalDispute } from '@/lib/paypal/dispute-schema';

export const REASON_LABEL: Record<string, string> = {
  MERCHANDISE_OR_SERVICE_NOT_RECEIVED: 'Not received',
  MERCHANDISE_OR_SERVICE_NOT_AS_DESCRIBED: 'Not as described',
  UNAUTHORISED: 'Unauthorized',
  DUPLICATE_TRANSACTION: 'Duplicate charge',
  CREDIT_NOT_PROCESSED: 'Credit not processed',
  INCORRECT_AMOUNT: 'Incorrect amount',
  OTHER: 'Other',
};
export const STATUS_LABEL: Record<string, string> = {
  WAITING_FOR_SELLER_RESPONSE: 'Waiting on us',
  WAITING_FOR_BUYER_RESPONSE: 'Waiting on buyer',
  UNDER_REVIEW: 'Under review',
  RESOLVED: 'Resolved',
  OPEN: 'Open',
};
export const OUTCOME_LABEL: Record<string, string> = {
  RESOLVED_SELLER_FAVOUR: 'Won',
  RESOLVED_BUYER_FAVOUR: 'Lost / refunded',
  CANCELED_BY_BUYER: 'Cancelled by buyer',
  ACCEPTED: 'Accepted',
  DENIED: 'Denied',
  PARTIAL_REFUND: 'Partial refund',
};

type LatestDecision = { id: string; action: string; status: string; confidence: number | null; amount_cents: number | null; created_at: string; decided_by: string | null; executed_at: string | null };

function latestDecision(db: Db, disputeId: string): LatestDecision | undefined {
  return db
    .prepare('SELECT id, action, status, confidence, amount_cents, created_at, decided_by, executed_at FROM decisions WHERE dispute_id = ? ORDER BY created_at DESC LIMIT 1')
    .get(disputeId) as LatestDecision | undefined;
}

export type DisputeListRow = {
  id: string;
  reason: string;
  stage: string;
  status: string;
  state: 'Open' | 'Resolved';
  amount: number;
  currency: string;
  dueAt: string | null;
  dueDate: string | null;
  hoursLeft: number | null;
  timeLeft: string;
  urgency: DeadlineBucket;
  orderId: string;
  customer: string;
  filedAt: string;
  filedDate: string;
  strength: number;
  rating: string;
  recommendation: string;
  decisionStatus: string;
  outcome: string;
  atRisk: number; // amount if still open, else 0
  won: number; // 1 if resolved in the seller's favour
  resolved: number; // 1 if resolved
  respondedHours: number | null; // hours from filing to our first executed response
  whyRecommended: string; // the latest recommendation's reasoning, for the assistant
};

export function listDisputeRows(db: Db, now = new Date()): DisputeListRow[] {
  const rows = db.prepare('SELECT * FROM disputes ORDER BY created_at DESC').all() as DisputeRow[];
  return rows.map((d) => {
    const deadline = computeDeadline(d.status === 'WAITING_FOR_SELLER_RESPONSE' ? d.seller_response_due_at : null, now);
    const packet = buildEvidencePacket(db, d);
    const decision = latestDecision(db, d.id);
    const payload = decision ? (db.prepare('SELECT payload_json FROM decisions WHERE id = ?').get(decision.id) as { payload_json: string }) : undefined;
    const reasoning = payload ? ((JSON.parse(payload.payload_json).decision?.reasoning as string[] | undefined) ?? []) : [];
    const customer = d.order_id
      ? ((db.prepare('SELECT c.name FROM orders o JOIN customers c ON c.id = o.customer_id WHERE o.id = ?').get(d.order_id) as { name: string } | undefined)?.name ?? '—')
      : 'Unknown (no order)';
    const firstAction = db
      .prepare("SELECT MIN(executed_at) AS at FROM decisions WHERE dispute_id = ? AND status IN ('executed', 'escalated')")
      .get(d.id) as { at: string | null };
    const resolved = d.status === 'RESOLVED';
    return {
      id: d.id,
      reason: REASON_LABEL[d.reason] ?? d.reason,
      stage: d.stage === 'INQUIRY' ? 'Inquiry' : d.stage === 'CHARGEBACK' ? 'Chargeback' : d.stage,
      status: STATUS_LABEL[d.status] ?? d.status,
      state: resolved ? 'Resolved' : 'Open',
      amount: d.amount_cents / 100,
      currency: d.currency,
      dueAt: deadline.dueAt,
      dueDate: deadline.dueAt?.slice(0, 10) ?? null,
      hoursLeft: deadline.msRemaining === null ? null : Math.round((deadline.msRemaining / 3_600_000) * 10) / 10,
      timeLeft: deadline.dueAt ? formatRemaining(deadline.msRemaining) : resolved ? 'Closed' : 'No clock',
      urgency: deadline.bucket,
      orderId: d.order_id ?? '—',
      customer,
      filedAt: d.created_at,
      filedDate: d.created_at.slice(0, 10),
      strength: packet.strength,
      rating: packet.rating,
      recommendation: decision ? decision.action.replace(/_/g, ' ') : 'none yet',
      decisionStatus: decision?.status ?? 'none',
      outcome: resolved ? (OUTCOME_LABEL[d.outcome ?? ''] ?? d.outcome ?? 'Resolved') : 'Pending',
      atRisk: resolved ? 0 : d.amount_cents / 100,
      won: d.outcome === 'RESOLVED_SELLER_FAVOUR' ? 1 : 0,
      resolved: resolved ? 1 : 0,
      respondedHours: firstAction.at ? Math.round(((Date.parse(firstAction.at) - Date.parse(d.created_at)) / 3_600_000) * 10) / 10 : null,
      whyRecommended: reasoning.join(' ').slice(0, 1200),
    };
  });
}

export type TimelineEntry = { at: string; kind: 'paypal' | 'agent' | 'human' | 'system'; title: string; detail?: string };

export type CaseFile = {
  asOf: string; // server render time, for hydration-safe clocks
  dispute: DisputeListRow;
  raw: { reason: string; stage: string; status: string; requestedEvidence: string[]; availableActions: string[]; buyerClaim: string; outcome: string | null };
  order: { id: string; createdAt: string; items: { name: string; qty: number; unitCents: number }[]; totalCents: number; shipTo: { city: string; region: string; postal: string }; note: string | null } | null;
  shipment: { carrier: string; tracking: string | null; status: string; shippedAt: string | null; deliveredAt: string | null; signedBy: string | null; events: { at: string; status: string; location: string }[] } | null;
  customer: { id: string; name: string; city: string; region: string; firstSeen: string; orders: number } | null;
  packet: EvidencePacket;
  decision: (LatestDecision & { payload: { decision: Decision | null; validation: { errors: string[]; flags: string[] }; model: string } ; result: unknown }) | null;
  timeline: TimelineEntry[];
};

export function getCaseFile(db: Db, id: string, now = new Date()): CaseFile | null {
  const d = getDispute(db, id);
  if (!d) return null;
  const listRow = listDisputeRows(db, now).find((r) => r.id === id)!;
  const raw = PayPalDispute.parse(JSON.parse(d.raw_json));

  const o = d.order_id ? (db.prepare('SELECT * FROM orders WHERE id = ?').get(d.order_id) as Record<string, string | number | null> | undefined) : undefined;
  const s = o ? (db.prepare('SELECT * FROM shipments WHERE order_id = ?').get(o.id) as Record<string, string | number | null> | undefined) : undefined;
  const c = o ? (db.prepare('SELECT * FROM customers WHERE id = ?').get(o.customer_id) as Record<string, string> | undefined) : undefined;
  const orderCount = c ? (db.prepare('SELECT COUNT(*) AS n FROM orders WHERE customer_id = ?').get(c.id) as { n: number }).n : 0;

  const dec = db.prepare('SELECT * FROM decisions WHERE dispute_id = ? ORDER BY created_at DESC LIMIT 1').get(id) as (LatestDecision & { payload_json: string; result_json: string | null }) | undefined;

  const timeline: TimelineEntry[] = [];
  if (o) timeline.push({ at: String(o.created_at), kind: 'system', title: `Order ${o.id} placed`, detail: `$${(Number(o.total_cents) / 100).toFixed(2)}` });
  for (const e of s ? (JSON.parse(String(s.events_json)) as { at: string; status: string; location: string }[]) : []) {
    timeline.push({ at: e.at, kind: 'system', title: `Carrier: ${e.status.replace(/_/g, ' ').toLowerCase()}`, detail: e.location });
  }
  timeline.push({ at: d.created_at, kind: 'paypal', title: `Buyer opened a ${REASON_LABEL[d.reason]?.toLowerCase() ?? 'dispute'} claim`, detail: `$${(d.amount_cents / 100).toFixed(2)}` });
  for (const e of db.prepare('SELECT event_type, source, status, received_at FROM dispute_events WHERE dispute_id = ? ORDER BY received_at').all(id) as { event_type: string; source: string; status: string | null; received_at: string }[]) {
    if (e.event_type === 'POLL.DISPUTE.DISCOVERED') continue;
    timeline.push({ at: e.received_at, kind: 'paypal', title: `PayPal: ${(STATUS_LABEL[e.status ?? ''] ?? e.status ?? '').toLowerCase()}`, detail: `${e.event_type} via ${e.source}` });
  }
  for (const x of db.prepare('SELECT action, status, created_at, decided_by, executed_at FROM decisions WHERE dispute_id = ? ORDER BY created_at').all(id) as LatestDecision[]) {
    timeline.push({ at: x.created_at, kind: 'agent', title: `Verdict recommended: ${x.action.replace(/_/g, ' ')}`, detail: x.status === 'needs_human' ? 'flagged for review' : undefined });
    if (x.executed_at) timeline.push({ at: x.executed_at, kind: 'human', title: `${x.decided_by ?? 'Owner'} ${x.status === 'escalated' ? 'kept it for manual handling' : x.status === 'failed' ? 'approved; PayPal call failed' : 'approved'}`, detail: x.action.replace(/_/g, ' ') });
  }
  timeline.sort((a, b) => a.at.localeCompare(b.at));

  return {
    asOf: now.toISOString(),
    dispute: listRow,
    raw: {
      reason: d.reason,
      stage: d.stage,
      status: d.status,
      requestedEvidence: requestedEvidence(raw),
      availableActions: availableAgentActions(raw),
      buyerClaim: buyerText(raw),
      outcome: d.outcome,
    },
    order: o
      ? {
          id: String(o.id),
          createdAt: String(o.created_at),
          items: JSON.parse(String(o.items_json)),
          totalCents: Number(o.total_cents),
          shipTo: JSON.parse(String(o.ship_to_json)),
          note: (o.note as string | null) ?? null,
        }
      : null,
    shipment: s
      ? {
          carrier: String(s.carrier),
          tracking: (s.tracking_number as string | null) ?? null,
          status: String(s.status),
          shippedAt: (s.shipped_at as string | null) ?? null,
          deliveredAt: (s.delivered_at as string | null) ?? null,
          signedBy: (s.signed_by as string | null) ?? null,
          events: JSON.parse(String(s.events_json)),
        }
      : null,
    customer: c ? { id: c.id, name: c.name, city: c.city, region: c.region, firstSeen: c.first_seen, orders: orderCount } : null,
    packet: buildEvidencePacket(db, d),
    decision: dec ? { ...dec, payload: JSON.parse(dec.payload_json), result: dec.result_json ? JSON.parse(dec.result_json) : null } : null,
    timeline,
  };
}
