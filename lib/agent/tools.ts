// The defender's tools. All read-only, all from our own ledger and store (never PayPal), so the
// agent can investigate and propose but cannot act. Buyer-written text is returned inside
// <untrusted_buyer_message> tags; the system prompt says it is data, not instructions.

import { betaZodTool } from '@anthropic-ai/sdk/helpers/beta/zod';
import { z } from 'zod';
import type { Db } from '@/lib/db';
import { getDispute, type DisputeRow } from '@/lib/disputes/store';
import { computeDeadline, formatRemaining } from '@/lib/disputes/deadline';
import { buildEvidencePacket, type EvidencePacket } from '@/lib/evidence/packet';
import { requestedEvidence, responseOptions } from '@/lib/paypal/actions';
import { PayPalDispute } from '@/lib/paypal/dispute-schema';
import { availableAgentActions } from './guardrails';

export type ToolCall = { name: string; input: unknown; output: string; ms: number };

type ToolContext = {
  db: Db;
  disputeId: string;
  now?: Date;
  calls: ToolCall[]; // every call is recorded for the audit log
};

type Message = { posted_by?: string; time_posted?: string; content?: string };
type Evidence = { evidence_type?: string; source?: string; notes?: string; date?: string };

// Real Resolution Center claims put the buyer's words in evidences[] (source SUBMITTED_BY_BUYER,
// usually evidence_type CREATE), not in messages[]. "N/A" is PayPal's placeholder for no text.
const buyerEvidenceNotes = (raw: PayPalDispute) =>
  ((raw as { evidences?: Evidence[] }).evidences ?? []).filter((e) => e.source === 'SUBMITTED_BY_BUYER' && e.notes && e.notes.trim() !== 'N/A');

/** All buyer-authored text on a dispute, for display and injection screening. */
export function buyerText(raw: PayPalDispute): string {
  const msgs = ((raw as { messages?: Message[] }).messages ?? [])
    .filter((m) => m.posted_by === 'BUYER' && m.content && m.content.trim() !== 'N/A')
    .map((m) => m.content!);
  const notes = (raw as { extensions?: { buyer_notes?: string } }).extensions?.buyer_notes;
  // The same claim often appears in both evidences[] and messages[]; keep one copy.
  return [...new Set([...buyerEvidenceNotes(raw).map((e) => e.notes!), ...msgs, ...(notes ? [notes] : [])])].join('\n');
}

const fence = (s: string) => s.replace(/<\/?untrusted_buyer_message>/gi, '[tag removed]');

export function disputeView(row: DisputeRow, now = new Date()) {
  const raw = PayPalDispute.parse(JSON.parse(row.raw_json));
  const deadline = computeDeadline(row.seller_response_due_at, now);
  const msgs = ((raw as { messages?: Message[] }).messages ?? []).map((m) => ({
    from: m.posted_by,
    at: m.time_posted,
    text: m.posted_by === 'BUYER' ? `<untrusted_buyer_message>${fence(m.content ?? '')}</untrusted_buyer_message>` : m.content,
  }));
  const notes = (raw as { extensions?: { buyer_notes?: string } }).extensions?.buyer_notes;
  return {
    disputeId: row.id,
    reason: row.reason,
    stage: row.stage,
    status: row.status,
    amountUsd: row.amount_cents / 100,
    filedAt: row.created_at,
    responseDue: row.seller_response_due_at,
    timeLeft: formatRemaining(deadline.msRemaining),
    orderId: row.order_id,
    availableActions: availableAgentActions(raw),
    paypalRequestedEvidence: requestedEvidence(raw),
    paypalResponseOptions: responseOptions(raw),
    buyerNotes: notes ? `<untrusted_buyer_message>${fence(notes)}</untrusted_buyer_message>` : null,
    buyerClaim: buyerEvidenceNotes(raw).map((e) => ({ at: e.date, text: `<untrusted_buyer_message>${fence(e.notes!)}</untrusted_buyer_message>` })),
    messages: msgs,
  };
}

export function makeTools(ctx: ToolContext) {
  const { db } = ctx;
  let packet: EvidencePacket | undefined;
  const row = () => {
    const r = getDispute(db, ctx.disputeId);
    if (!r) throw new Error(`dispute ${ctx.disputeId} not in ledger`);
    return r;
  };
  const getPacket = () => (packet ??= buildEvidencePacket(db, row()));

  const tool = <S extends z.ZodType>(name: string, description: string, inputSchema: S, fn: (input: z.infer<S>) => unknown) =>
    betaZodTool({
      name,
      description,
      inputSchema,
      run: async (input) => {
        const t = Date.now();
        let output: string;
        try {
          output = JSON.stringify(fn(input) ?? null);
        } catch (e) {
          output = JSON.stringify({ error: (e as Error).message });
        }
        ctx.calls.push({ name, input, output, ms: Date.now() - t });
        return output;
      },
    });

  return [
    tool('get_dispute', 'The dispute under review: reason, stage, status, amount, deadline, the actions available now, what PayPal requested, and buyer messages (untrusted).', z.object({}), () =>
      disputeView(row(), ctx.now),
    ),
    tool('get_order', 'A store order by id: items, totals, status, shipping address, internal note, refunds.', z.object({ orderId: z.string() }), ({ orderId }) => {
      const o = db.prepare('SELECT id, customer_id, status, total_cents, items_json, ship_to_json, created_at, note, refunded_cents, refunded_at FROM orders WHERE id = ?').get(orderId) as
        | Record<string, unknown>
        | undefined;
      if (!o) return { error: `no order ${orderId}` };
      return { ...o, items: JSON.parse(o.items_json as string), shipTo: JSON.parse(o.ship_to_json as string), items_json: undefined, ship_to_json: undefined };
    }),
    tool('get_tracking', 'Shipment and carrier scan history for an order.', z.object({ orderId: z.string() }), ({ orderId }) => {
      const s = db.prepare('SELECT * FROM shipments WHERE order_id = ?').all(orderId) as Record<string, unknown>[];
      if (!s.length) return { error: `no shipment for ${orderId}` };
      return s.map((x) => ({ ...x, events: JSON.parse(x.events_json as string), deliveredTo: x.delivered_to_json ? JSON.parse(x.delivered_to_json as string) : null, events_json: undefined, delivered_to_json: undefined }));
    }),
    tool('get_customer_history', "A customer's profile and all their orders with this store, including past disputes.", z.object({ customerId: z.string() }), ({ customerId }) => {
      const c = db.prepare('SELECT id, name, city, region, first_seen, notes FROM customers WHERE id = ?').get(customerId);
      if (!c) return { error: `no customer ${customerId}` };
      const orders = db
        .prepare(
          `SELECT o.id, o.status, o.total_cents, o.created_at, s.status AS shipment_status,
             (SELECT reason FROM disputes d WHERE d.order_id = o.id LIMIT 1) AS dispute_reason
           FROM orders o LEFT JOIN shipments s ON s.order_id = o.id WHERE o.customer_id = ? ORDER BY o.created_at`,
        )
        .all(customerId);
      return { customer: c, orders };
    }),
    tool('get_merchant_policy', "The store's shipping, returns and dispute playbook.", z.object({}), () => {
      const m = db.prepare('SELECT name, policy_json FROM merchants WHERE id = (SELECT COALESCE(merchant_id, ?) FROM disputes WHERE id = ?)').get('kilnco', ctx.disputeId) as
        | { name: string; policy_json: string }
        | undefined;
      return m ? { store: m.name, ...JSON.parse(m.policy_json) } : { error: 'no merchant' };
    }),
    tool(
      'list_available_evidence',
      'Every store record relevant to this dispute, each with a kind, recordId and whether it helps or hurts our case. Cite evidence only from this list, using kind as type and recordId exactly.',
      z.object({}),
      () => getPacket().items.map(({ kind, recordTable, recordId, summary, helps }) => ({ kind, recordTable, recordId, summary, helps })),
    ),
    tool('build_evidence_packet', 'Overall evidence strength (0-1), rating, and gaps (what proof is missing).', z.object({}), () => {
      const p = getPacket();
      return { strength: p.strength, rating: p.rating, gaps: p.gaps, itemCount: p.items.length };
    }),
  ];
}
