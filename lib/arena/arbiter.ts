// SIMULATED arbiter: a rule-based stand-in for PayPal's dispute reviewers, used only to score Arena
// runs. It is NOT PayPal's decision process and its results are not real-world outcomes. Rules
// are documented in docs/arbiter.md; every verdict carries the rule trace that produced it.

import type { Decision } from '@/lib/agent/schema';
import type { EvidencePacket, EvidenceKind } from '@/lib/evidence/packet';
import type { ArenaScenario } from './scenarios';

export const ARBITER_LABEL = 'SIMULATED arbiter (rule-based stand-in for PayPal reviewers)';
export const LOST_DISPUTE_FEE_USD = 15; // SIMULATED fee on a contest the seller loses
export const SIGNATURE_REQUIRED_OVER_USD = 100;

export type Outcome = 'SELLER_WINS' | 'BUYER_WINS' | 'SETTLED' | 'ESCALATED';
export type RuleResult = { rule: string; passed: boolean; detail: string };
export type Verdict = {
  label: typeof ARBITER_LABEL;
  outcome: Outcome;
  refundUsd: number; // money that left the merchant
  feeUsd: number;
  retainedUsd: number; // disputed money the merchant kept
  rules: RuleResult[];
  rightCall: boolean; // did the response serve the merchant, given the hidden truth
};

type BuyerOfferReply = { accept: boolean; reply: string } | null;

const has = (kinds: Set<string>, k: EvidenceKind) => kinds.has(k);

/** Rules for a contest: does the cited evidence, in light of all records, beat the claim? */
function judgeContest(s: ArenaScenario, cited: Decision['evidence'], packet: EvidencePacket): RuleResult[] {
  // Only citations that match a real record of that kind count.
  const citedKinds = new Set(cited.filter((c) => packet.items.some((i) => i.recordId === c.recordId && i.kind === c.type && i.helps)).map((c) => c.type));
  const hurting = packet.items.filter((i) => !i.helps);
  const amount = s.spec.amount;
  const rules: RuleResult[] = [];

  switch (s.type) {
    case 'not_received':
    case 'late_delivery':
      rules.push({ rule: 'evidence completeness', passed: has(citedKinds, 'tracking') && has(citedKinds, 'delivery_confirmation'), detail: 'needs tracking and a delivery scan' });
      rules.push({ rule: 'tracking proof', passed: has(citedKinds, 'address_match') || packet.items.some((i) => i.kind === 'address_match'), detail: 'delivery to the order address' });
      if (amount > SIGNATURE_REQUIRED_OVER_USD) rules.push({ rule: 'signature over $100', passed: has(citedKinds, 'signature'), detail: `$${amount} needs signature confirmation` });
      break;
    case 'not_as_described':
      rules.push({ rule: 'evidence completeness', passed: has(citedKinds, 'product_listing'), detail: 'needs the listing the item is judged against' });
      rules.push({ rule: 'claim consistency', passed: s.complaint === 'variation', detail: s.complaint === 'variation' ? 'complaint is variation the listing discloses' : `complaint is ${s.complaint}: listing can't refute it` });
      break;
    case 'unauthorized':
      rules.push({ rule: 'evidence completeness', passed: has(citedKinds, 'delivery_confirmation') && has(citedKinds, 'customer_history'), detail: 'needs delivery and account history' });
      rules.push({ rule: 'tracking proof', passed: has(citedKinds, 'address_match') || packet.items.some((i) => i.kind === 'address_match'), detail: "delivery to the account holder's address" });
      break;
    case 'duplicate':
      rules.push({ rule: 'evidence completeness', passed: has(citedKinds, 'separate_orders') || has(citedKinds, 'refund_record'), detail: 'needs separate orders or a prior refund' });
      break;
  }
  rules.push({ rule: 'timeliness', passed: true, detail: 'responded before the seller deadline (agent responds within minutes)' });
  rules.push({ rule: 'no contradicting records', passed: hurting.length === 0 || hurting.every((h) => h.kind === 'customer_note'), detail: hurting.length ? `records against the seller: ${hurting.map((h) => h.kind).join(', ')}` : 'none' });
  return rules;
}

export function arbitrate(s: ArenaScenario, decision: Decision | null, packet: EvidencePacket, offerReply: BuyerOfferReply): Verdict {
  const amount = s.spec.amount;
  const base = { label: ARBITER_LABEL } as const;
  const right = (a: string) => s.rightActions.includes(a as never);

  if (!decision || decision.action === 'escalate_to_human') {
    return { ...base, outcome: 'ESCALATED', refundUsd: 0, feeUsd: 0, retainedUsd: 0, rules: [{ rule: 'sent to a human', passed: true, detail: 'no automatic outcome' }], rightCall: right('escalate_to_human') };
  }
  if (decision.action === 'accept') {
    const refund = Math.min(decision.amount ?? amount, amount);
    return { ...base, outcome: 'BUYER_WINS', refundUsd: refund, feeUsd: 0, retainedUsd: amount - refund, rules: [{ rule: 'seller conceded', passed: true, detail: `refunded $${refund}` }], rightCall: right('accept') };
  }
  if (decision.action === 'offer_refund' && offerReply?.accept) {
    const refund = decision.amount ?? 0;
    return { ...base, outcome: 'SETTLED', refundUsd: refund, feeUsd: 0, retainedUsd: amount - refund, rules: [{ rule: 'buyer accepted offer', passed: true, detail: `settled for $${refund}` }], rightCall: right('offer_refund') || s.truth !== 'merchant_at_fault' };
  }

  // A contest, or an offer the buyer declined (the buyer escalates; the seller's cited evidence is judged).
  const rules = judgeContest(s, decision.evidence, packet);
  if (decision.action === 'offer_refund') rules.unshift({ rule: 'buyer declined offer', passed: true, detail: offerReply?.reply.slice(0, 120) ?? 'declined' });
  const sellerWins = rules.every((r) => r.passed);
  return {
    ...base,
    outcome: sellerWins ? 'SELLER_WINS' : 'BUYER_WINS',
    refundUsd: sellerWins ? 0 : amount,
    feeUsd: sellerWins ? 0 : LOST_DISPUTE_FEE_USD,
    retainedUsd: sellerWins ? amount : 0,
    rules,
    // Contesting is right when the seller wins a case the buyer is at fault in; losing a contest costs a fee.
    rightCall: sellerWins ? s.truth !== 'merchant_at_fault' : false,
  };
}
