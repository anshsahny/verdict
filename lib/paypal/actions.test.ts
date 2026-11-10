import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { allowedActions, requestedEvidence, responseOptions, type DisputeAction } from './actions';
import type { PayPalDispute } from './dispute-schema';

const fixture = (id: string) => JSON.parse(readFileSync(`fixtures/disputes/snapshots/2026-11-10-before-gate1/${id}.json`, 'utf8')) as PayPalDispute;
const links = (...rels: string[]) => rels.map((rel) => ({ rel, href: `https://x/${rel}`, method: 'POST' }));
const ALL_RELS = ['accept_claim', 'make_offer', 'provide_evidence', 'provide_supporting_info', 'send_message', 'escalate', 'acknowledge_return_item', 'appeal', 'require_evidence', 'adjudicate'];
const d = (stage: string, status: string, rels = ALL_RELS) =>
  ({ dispute_life_cycle_stage: stage, status, links: links(...rels) }) as Pick<PayPalDispute, 'status' | 'dispute_life_cycle_stage' | 'links'>;

describe('allowedActions on real sandbox disputes', () => {
  it.each<[string, DisputeAction[]]>([
    // INR inquiry waiting on us (PayPal requested proof of fulfillment)
    ['PP-R-SLD-10197881', ['accept_claim', 'make_offer', 'provide_evidence', 'send_message', 'escalate']],
    // SNAD inquiry: PayPal offers no provide_evidence link
    ['PP-R-GSO-10197884', ['accept_claim', 'make_offer', 'send_message', 'escalate']],
    // Unauthorized chargeback waiting on us
    ['PP-R-BFE-10197888', ['accept_claim', 'provide_evidence']],
    // Chargeback under review, ~20 min after opening: sandbox settle helpers appear
    ['PP-R-HRR-10197887', ['accept_claim', 'provide_supporting_info', 'require_evidence', 'adjudicate']],
  ])('%s', (id, expected) => {
    expect(allowedActions(fixture(id)).sort()).toEqual([...expected].sort());
  });
});

describe('allowedActions rules (link AND stage/status)', () => {
  it('needs the HATEOAS link even when the state would allow it', () => {
    expect(allowedActions(d('INQUIRY', 'WAITING_FOR_SELLER_RESPONSE', []))).toEqual([]);
    expect(allowedActions(d('INQUIRY', 'WAITING_FOR_SELLER_RESPONSE', ['make_offer']))).toEqual(['make_offer']);
  });

  it('ignores links the stage/status rules forbid', () => {
    const a = allowedActions(d('CHARGEBACK', 'UNDER_REVIEW'));
    expect(a).not.toContain('make_offer'); // inquiry only
    expect(a).not.toContain('send_message'); // inquiry only
    expect(a).not.toContain('escalate');
    expect(a).not.toContain('provide_evidence'); // only while waiting on the seller
    expect(a).toEqual(expect.arrayContaining(['provide_supporting_info', 'adjudicate', 'require_evidence', 'accept_claim']));
  });

  it('INQUIRY waiting on the seller', () => {
    expect(allowedActions(d('INQUIRY', 'WAITING_FOR_SELLER_RESPONSE')).sort()).toEqual(
      ['accept_claim', 'acknowledge_return_item', 'escalate', 'make_offer', 'provide_evidence', 'send_message'].sort(),
    );
  });

  it('INQUIRY waiting on the buyer: talk only', () => {
    expect(allowedActions(d('INQUIRY', 'WAITING_FOR_BUYER_RESPONSE')).sort()).toEqual(['escalate', 'send_message']);
  });

  it('settle helpers only while UNDER_REVIEW', () => {
    expect(allowedActions(d('CHARGEBACK', 'WAITING_FOR_SELLER_RESPONSE'))).not.toContain('adjudicate');
    expect(allowedActions(d('INQUIRY', 'UNDER_REVIEW'))).toEqual(expect.arrayContaining(['adjudicate', 'require_evidence']));
  });

  it('RESOLVED: nothing, unless PayPal offers an appeal', () => {
    expect(allowedActions(d('CHARGEBACK', 'RESOLVED', ['accept_claim', 'provide_evidence']))).toEqual([]);
    expect(allowedActions(d('CHARGEBACK', 'RESOLVED', ['appeal']))).toEqual(['appeal']);
  });

  it('accepts hyphenated rels as in parts of the docs', () => {
    expect(allowedActions(d('INQUIRY', 'WAITING_FOR_SELLER_RESPONSE', ['provide-evidence']))).toEqual(['provide_evidence']);
  });
});

describe('responseOptions and requestedEvidence', () => {
  it('reads PayPal allowed sub-types and requested evidence', () => {
    expect(responseOptions(fixture('PP-R-SLD-10197881'))).toEqual({ offerTypes: ['REFUND'], acceptClaimTypes: ['PARTIAL_REFUND', 'REFUND'] });
    expect(requestedEvidence(fixture('PP-R-SLD-10197881'))).toEqual(['PROOF_OF_FULFILLMENT']);
    expect(requestedEvidence(fixture('PP-R-BFE-10197888')).sort()).toEqual(['OTHER', 'PROOF_OF_FULFILLMENT', 'PROOF_OF_REFUND']);
    expect(responseOptions(fixture('PP-R-HRR-10197887')).offerTypes).toEqual([]);
  });
});
