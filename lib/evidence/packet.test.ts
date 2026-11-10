import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { openDb, type Db } from '@/lib/db';
import { getDispute, upsertDispute } from '@/lib/disputes/store';
import type { PayPalDispute } from '@/lib/paypal/dispute-schema';
import { buildEvidencePacket, toPayPalEvidences } from './packet';

const fixture = (id: string) => JSON.parse(readFileSync(`fixtures/disputes/snapshots/2026-11-10-before-gate1/${id}.json`, 'utf8')) as PayPalDispute;
const load = (db: Db, id: string) => {
  upsertDispute(db, fixture(id), { full: true, source: 'replay' });
  return getDispute(db, id)!;
};

describe('buildEvidencePacket on the real sandbox disputes', () => {
  const db = openDb(':memory:');

  it('INR with signed, tracked delivery to the right address is strong', () => {
    const p = buildEvidencePacket(db, load(db, 'PP-R-SUQ-10197882')); // VRD-1001
    expect(p.rating).toBe('strong');
    expect(p.items.map((i) => i.kind)).toEqual(expect.arrayContaining(['tracking', 'delivery_confirmation', 'signature', 'address_match']));
    expect(p.items.every((i) => i.helps)).toBe(true);
  });

  it('delivery to the wrong address is flagged as hurting the case', () => {
    const p = buildEvidencePacket(db, load(db, 'PP-R-HRR-10197887')); // VRD-1006
    const mismatch = p.items.find((i) => i.kind === 'address_mismatch')!;
    expect(mismatch.helps).toBe(false);
    expect(mismatch.weight).toBeLessThan(0);
    expect(p.rating).toBe('weak');
  });

  it('untracked shipment: no proof of delivery, gap reported', () => {
    const p = buildEvidencePacket(db, load(db, 'PP-R-SLD-10197881')); // VRD-1008
    expect(p.rating).toBe('none');
    expect(p.gaps.join(' ')).toMatch(/No tracking number/);
  });

  it('not-as-described leans on the listing and policy, not just delivery', () => {
    const p = buildEvidencePacket(db, load(db, 'PP-R-GSO-10197884')); // VRD-1003 walnut board
    expect(p.items.map((i) => i.kind)).toEqual(expect.arrayContaining(['product_listing', 'policy']));
    expect(p.rating).toBe('moderate'); // no photos: can't be strong
    expect(p.gaps).toContain('No photos of the item as shipped.');
  });

  it('dispute with no matching store order has no evidence and says so', () => {
    const p = buildEvidencePacket(db, load(db, 'PP-R-FGG-10198062'));
    expect(p).toMatchObject({ orderId: null, rating: 'none', items: [] });
    expect(p.gaps[0]).toMatch(/No store order/);
  });

  it('every item cites a row that exists', () => {
    for (const id of ['PP-R-SUQ-10197882', 'PP-R-HRR-10197887', 'PP-R-GSO-10197884', 'PP-R-BFE-10197888', 'PP-R-AKY-10197889']) {
      for (const item of buildEvidencePacket(db, load(db, id)).items) {
        const row = db.prepare(`SELECT 1 FROM ${item.recordTable} WHERE id = ?`).get(item.recordId);
        expect(row, `${id} ${item.id}`).toBeTruthy();
      }
    }
  });
});

describe('toPayPalEvidences', () => {
  const db = openDb(':memory:');

  it('inquiry: PROOF_OF_FULFILLMENT with tracking info and cited notes, dropping items that hurt', () => {
    const p = buildEvidencePacket(db, load(db, 'PP-R-HRR-10197887'));
    const evidences = toPayPalEvidences(p.items, { stage: 'INQUIRY', requested: ['PROOF_OF_FULFILLMENT'] });
    expect(evidences).toHaveLength(1);
    expect(evidences[0].evidence_type).toBe('PROOF_OF_FULFILLMENT');
    expect(evidences[0].evidence_info?.tracking_info).toEqual([{ carrier_name: 'USPS', tracking_number: '9400111899560000100106' }]);
    expect(evidences[0].notes).toMatch(/\[shipments:ship-VRD-1006\]/);
    expect(evidences[0].notes).not.toMatch(/does NOT match/);
  });

  it('chargeback: one OTHER item (what the sandbox accepts), with disclosures appended', () => {
    const p = buildEvidencePacket(db, load(db, 'PP-R-HRR-10197887'));
    const evidences = toPayPalEvidences(p.items, { stage: 'CHARGEBACK', requested: ['PROOF_OF_FULFILLMENT'], disclosures: p.items });
    expect(evidences).toHaveLength(1);
    expect(evidences[0].evidence_type).toBe('OTHER');
    expect(evidences[0].evidence_info).toBeUndefined();
    expect(evidences[0].notes).toMatch(/tracking 9400111899560000100106/);
    expect(evidences[0].notes).toMatch(/Disclosure: Delivered to .* does NOT match/);
  });

  it('inquiry: only sends the evidence types PayPal requested', () => {
    const p = buildEvidencePacket(db, load(db, 'PP-R-GSO-10197884'));
    expect(toPayPalEvidences(p.items, { stage: 'INQUIRY', requested: ['PROOF_OF_FULFILLMENT'] }).map((e) => e.evidence_type)).toEqual(['PROOF_OF_FULFILLMENT']);
    expect(toPayPalEvidences(p.items, { stage: 'INQUIRY', requested: [] }).map((e) => e.evidence_type).sort()).toEqual(['OTHER', 'PROOF_OF_FULFILLMENT']);
  });

  it('nothing helpful selected: nothing to send', () => {
    expect(toPayPalEvidences([], { stage: 'CHARGEBACK', requested: [] })).toEqual([]);
  });
});
