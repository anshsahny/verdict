// Evidence packet builder: turns store records into candidate PayPal evidence for a dispute, with
// a rule-based strength score. Every item cites the table and row it came from; nothing is
// invented. Items that hurt the seller's case are included too (flagged), so the agent and the
// human see the whole picture, not a cherry-picked one.

import type { Db } from '@/lib/db';
import type { DisputeRow } from '@/lib/disputes/store';
import type { EvidenceInput } from '@/lib/paypal/client';

export type EvidenceKind =
  | 'tracking'
  | 'delivery_confirmation'
  | 'signature'
  | 'address_match'
  | 'address_mismatch'
  | 'not_delivered'
  | 'untracked'
  | 'product_listing'
  | 'policy'
  | 'customer_history'
  | 'customer_note';

export type EvidenceItem = {
  id: string; // stable: `${kind}:${recordTable}:${recordId}`
  kind: EvidenceKind;
  recordTable: 'orders' | 'shipments' | 'products' | 'customers' | 'merchants';
  recordId: string;
  summary: string;
  helps: boolean; // false = this record supports the buyer
  weight: number; // contribution to strength, negative when it hurts
  paypalType?: 'PROOF_OF_FULFILLMENT' | 'OTHER';
  tracking?: { carrier_name: string; tracking_number: string };
};

export type EvidencePacket = {
  disputeId: string;
  orderId: string | null;
  reason: string;
  items: EvidenceItem[];
  strength: number; // 0..1, the strength meter
  rating: 'strong' | 'moderate' | 'weak' | 'none';
  gaps: string[]; // what's missing that would help
};

type Order = { id: string; customer_id: string; total_cents: number; items_json: string; ship_to_json: string; created_at: string };
type Shipment = {
  id: string;
  carrier: string;
  tracking_number: string | null;
  status: string;
  shipped_at: string | null;
  delivered_at: string | null;
  signed_by: string | null;
  delivered_to_json: string | null;
  address_match: number | null;
};
type Customer = { id: string; name: string; first_seen: string; notes: string | null };

const fmtDate = (iso: string | null) => (iso ? iso.slice(0, 10) : 'unknown date');
const place = (json: string | null) => {
  if (!json) return 'unknown address';
  const a = JSON.parse(json) as { city: string; region: string; postal: string };
  return `${a.city}, ${a.region} ${a.postal}`;
};

// How much each kind of record helps, by dispute reason. Proof of delivery wins "not received"
// but says little about "not as described"; account history matters most for "unauthorized".
const INR = 'MERCHANDISE_OR_SERVICE_NOT_RECEIVED';
const SNAD = 'MERCHANDISE_OR_SERVICE_NOT_AS_DESCRIBED';
const UNAUTH = 'UNAUTHORISED';
const WEIGHTS: Record<string, Partial<Record<EvidenceKind, number>>> = {
  [INR]: { tracking: 0.25, delivery_confirmation: 0.25, signature: 0.15, address_match: 0.15, customer_history: 0.05, untracked: -0.1, address_mismatch: -0.45, not_delivered: -0.35 },
  [SNAD]: { tracking: 0.05, delivery_confirmation: 0.1, signature: 0.05, address_match: 0.05, product_listing: 0.2, policy: 0.1, customer_history: 0.05, untracked: -0.05, address_mismatch: -0.2, not_delivered: -0.2 },
  [UNAUTH]: { tracking: 0.15, delivery_confirmation: 0.15, signature: 0.15, address_match: 0.15, customer_history: 0.3, untracked: -0.1, address_mismatch: -0.45, not_delivered: -0.2 },
};
const weightOf = (reason: string, kind: EvidenceKind, fallback: number) => WEIGHTS[reason]?.[kind] ?? fallback;

export function buildEvidencePacket(db: Db, dispute: DisputeRow): EvidencePacket {
  const items: EvidenceItem[] = [];
  const gaps: string[] = [];
  // `scale` discounts a weaker instance of a kind (e.g. a delivery scan dated after the dispute).
  const add = (i: Omit<EvidenceItem, 'id'>, scale = 1) =>
    items.push({ ...i, weight: weightOf(dispute.reason, i.kind, i.weight) * scale, id: `${i.kind}:${i.recordTable}:${i.recordId}` });

  const order = dispute.order_id ? (db.prepare('SELECT * FROM orders WHERE id = ?').get(dispute.order_id) as Order | undefined) : undefined;
  if (!order) {
    return {
      disputeId: dispute.id,
      orderId: null,
      reason: dispute.reason,
      items,
      strength: 0,
      rating: 'none',
      gaps: ['No store order matches this PayPal transaction. Check the transaction manually before responding.'],
    };
  }

  const shipment = db.prepare('SELECT * FROM shipments WHERE order_id = ? ORDER BY shipped_at DESC LIMIT 1').get(order.id) as Shipment | undefined;
  const customer = db.prepare('SELECT * FROM customers WHERE id = ?').get(order.customer_id) as Customer;
  const lines = JSON.parse(order.items_json) as { productId: string; name: string }[];
  const filedAt = Date.parse(dispute.created_at);

  // --- shipping & delivery ---------------------------------------------------------------------
  if (shipment) {
    if (shipment.tracking_number) {
      add({
        kind: 'tracking',
        recordTable: 'shipments',
        recordId: shipment.id,
        summary: `${shipment.carrier} tracking ${shipment.tracking_number}, shipped ${fmtDate(shipment.shipped_at)}.`,
        helps: true,
        weight: 0.25,
        paypalType: 'PROOF_OF_FULFILLMENT',
        tracking: { carrier_name: shipment.carrier, tracking_number: shipment.tracking_number },
      });
    } else {
      add({
        kind: 'untracked',
        recordTable: 'shipments',
        recordId: shipment.id,
        summary: `Shipped ${fmtDate(shipment.shipped_at)} by ${shipment.carrier}, with no tracking number.`,
        helps: false,
        weight: -0.1,
      });
      gaps.push('No tracking number: delivery cannot be proven.');
    }
    if (shipment.status === 'DELIVERED' && shipment.delivered_at) {
      const beforeDispute = Date.parse(shipment.delivered_at) < filedAt;
      add({
        kind: 'delivery_confirmation',
        recordTable: 'shipments',
        recordId: shipment.id,
        summary: `Carrier shows delivered ${fmtDate(shipment.delivered_at)} to ${place(shipment.delivered_to_json)}${beforeDispute ? ', before the dispute was filed' : ''}.`,
        helps: true,
        weight: 0.25,
        paypalType: 'PROOF_OF_FULFILLMENT',
      }, beforeDispute ? 1 : 0.6);
      if (shipment.signed_by) {
        add({
          kind: 'signature',
          recordTable: 'shipments',
          recordId: shipment.id,
          summary: `Signed for by "${shipment.signed_by}".`,
          helps: true,
          weight: 0.15,
          paypalType: 'PROOF_OF_FULFILLMENT',
        });
      } else if (dispute.reason !== 'MERCHANDISE_OR_SERVICE_NOT_AS_DESCRIBED') {
        gaps.push('No delivery signature.');
      }
      if (shipment.address_match === 1) {
        add({
          kind: 'address_match',
          recordTable: 'shipments',
          recordId: shipment.id,
          summary: `Delivery address matches the order's shipping address (${place(order.ship_to_json)}).`,
          helps: true,
          weight: 0.15,
          paypalType: 'PROOF_OF_FULFILLMENT',
        });
      } else if (shipment.address_match === 0) {
        add({
          kind: 'address_mismatch',
          recordTable: 'shipments',
          recordId: shipment.id,
          summary: `Delivered to ${place(shipment.delivered_to_json)}, which does NOT match the order's address (${place(order.ship_to_json)}).`,
          helps: false,
          weight: -0.45,
        });
      }
    } else if (shipment.status === 'LOST' || shipment.status === 'IN_TRANSIT') {
      add({
        kind: 'not_delivered',
        recordTable: 'shipments',
        recordId: shipment.id,
        summary: `Carrier status is ${shipment.status}; no delivery scan.`,
        helps: false,
        weight: -0.35,
      });
    }
  } else {
    gaps.push('No shipment record for this order.');
  }

  // --- item description (matters for not-as-described) ----------------------------------------
  if (dispute.reason === 'MERCHANDISE_OR_SERVICE_NOT_AS_DESCRIBED') {
    for (const line of lines) {
      const p = db.prepare('SELECT id, name, description FROM products WHERE id = ?').get(line.productId) as { id: string; name: string; description: string } | undefined;
      if (!p) continue;
      add({
        kind: 'product_listing',
        recordTable: 'products',
        recordId: p.id,
        summary: `Listing for "${p.name}": ${p.description}`,
        helps: true,
        weight: 0.2,
        paypalType: 'OTHER',
      });
    }
    const policy = db.prepare('SELECT id, policy_json FROM merchants WHERE id = (SELECT merchant_id FROM orders WHERE id = ?)').get(order.id) as
      | { id: string; policy_json: string }
      | undefined;
    if (policy) {
      const p = JSON.parse(policy.policy_json) as Record<string, string>;
      add({
        kind: 'policy',
        recordTable: 'merchants',
        recordId: policy.id,
        summary: `Store policy: ${p.handmade} ${p.damaged}`,
        helps: true,
        weight: 0.1,
        paypalType: 'OTHER',
      });
    }
    gaps.push('No photos of the item as shipped.');
  }

  // --- customer history (matters most for unauthorized) ----------------------------------------
  const prior = db
    .prepare(
      `SELECT COUNT(*) AS n FROM orders o
       WHERE o.customer_id = ? AND o.id != ? AND o.created_at < ?
         AND NOT EXISTS (SELECT 1 FROM disputes d WHERE d.order_id = o.id)`,
    )
    .get(order.customer_id, order.id, order.created_at) as { n: number };
  if (prior.n > 0) {
    add({
      kind: 'customer_history',
      recordTable: 'customers',
      recordId: customer.id,
      summary: `${customer.name} placed ${prior.n} earlier order(s) to the same address with no dispute.`,
      helps: true,
      weight: dispute.reason === 'UNAUTHORISED' ? 0.3 : 0.05,
      paypalType: 'OTHER',
    });
  }
  if (customer.notes) {
    add({
      kind: 'customer_note',
      recordTable: 'customers',
      recordId: customer.id,
      summary: `Support note on file: ${customer.notes}`,
      helps: true,
      weight: 0,
    });
  }

  const raw = items.reduce((s, i) => s + i.weight, 0);
  const strength = Math.max(0, Math.min(1, Math.round(raw * 100) / 100));
  const rating = strength >= 0.7 ? 'strong' : strength >= 0.4 ? 'moderate' : strength > 0 ? 'weak' : 'none';
  return { disputeId: dispute.id, orderId: order.id, reason: dispute.reason, items, strength, rating, gaps };
}

const cite = (i: EvidenceItem) => `${i.summary} [${i.recordTable}:${i.recordId}]`;

/**
 * PayPal `evidences` for provide-evidence, from the items the caller selected. Each note cites its
 * source rows as [table:id].
 *
 * Evidence types follow sandbox behaviour (docs/api-notes.md), not just the `requested` list:
 * in a CHARGEBACK, PayPal rejected PROOF_OF_FULFILLMENT (EVIDENCE_TYPE_IS_NOT_ALLOWED) even while
 * requesting it, and accepted OTHER, so chargeback evidence goes as one OTHER item with tracking in
 * the notes. In an INQUIRY, OTHER was rejected; types are sent per item, filtered to `requested`.
 * `disclosures` are records that hurt the seller's case, appended so the submission isn't one-sided.
 */
export function toPayPalEvidences(
  selected: EvidenceItem[],
  opts: { stage: string; requested: string[]; disclosures?: EvidenceItem[] },
): EvidenceInput[] {
  const helpful = selected.filter((i) => i.helps && i.paypalType);
  const disclosed = (opts.disclosures ?? []).filter((i) => !i.helps).map((i) => `Disclosure: ${cite(i)}`);
  if (opts.stage !== 'INQUIRY') {
    if (!helpful.length) return [];
    return [{ evidence_type: 'OTHER', notes: [...helpful.map(cite), ...disclosed].join(' ').slice(0, 2000) }];
  }
  const requested = opts.requested;
  const byType = new Map<string, EvidenceItem[]>();
  for (const i of helpful) byType.set(i.paypalType!, [...(byType.get(i.paypalType!) ?? []), i]);
  const out: EvidenceInput[] = [];
  for (const [type, group] of byType) {
    if (requested.length && !requested.includes(type)) continue;
    const tracking = group.flatMap((i) => (i.tracking ? [i.tracking] : []));
    out.push({
      evidence_type: type,
      notes: [...group.map(cite), ...disclosed].join(' ').slice(0, 2000),
      ...(tracking.length ? { evidence_info: { tracking_info: dedupe(tracking) } } : {}),
    });
  }
  return out;
}

const dedupe = <T,>(xs: T[]) => [...new Map(xs.map((x) => [JSON.stringify(x), x])).values()];
