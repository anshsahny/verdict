// Which actions a dispute allows right now. An action needs BOTH PayPal's HATEOAS link (PayPal's
// own say-so) AND a matching stage/status (our documented rules), so a stale or surprising link
// can't trigger an action the docs say is invalid. The agent may only choose from this list.

import type { PayPalDispute } from './dispute-schema';

export const DISPUTE_ACTIONS = [
  'accept_claim',
  'make_offer',
  'provide_evidence',
  'provide_supporting_info',
  'send_message',
  'escalate',
  'acknowledge_return_item',
  'appeal',
  'require_evidence', // sandbox only
  'adjudicate', // sandbox only
] as const;
export type DisputeAction = (typeof DISPUTE_ACTIONS)[number];

type Rule = (d: { stage: string; status: string }) => boolean;

const WAITING = 'WAITING_FOR_SELLER_RESPONSE';
const RULES: Record<DisputeAction, Rule> = {
  accept_claim: ({ status }) => status === WAITING || status === 'UNDER_REVIEW',
  make_offer: ({ stage, status }) => stage === 'INQUIRY' && status === WAITING,
  provide_evidence: ({ status }) => status === WAITING,
  provide_supporting_info: ({ stage }) => stage !== 'INQUIRY',
  send_message: ({ stage }) => stage === 'INQUIRY',
  escalate: ({ stage }) => stage === 'INQUIRY',
  acknowledge_return_item: ({ status }) => status === WAITING,
  appeal: ({ status }) => status === 'RESOLVED',
  require_evidence: ({ status }) => status === 'UNDER_REVIEW',
  adjudicate: ({ status }) => status === 'UNDER_REVIEW',
};

// PayPal's rels use underscores (provide_evidence); the docs show hyphens in places. Accept both.
const relToAction = (rel: string) => rel.replace(/-/g, '_') as DisputeAction;

export function allowedActions(d: Pick<PayPalDispute, 'status' | 'dispute_life_cycle_stage' | 'links'>): DisputeAction[] {
  if (d.status === 'RESOLVED' && !d.links?.some((l) => relToAction(l.rel) === 'appeal')) return [];
  const rels = new Set((d.links ?? []).map((l) => relToAction(l.rel)));
  const ctx = { stage: d.dispute_life_cycle_stage, status: d.status };
  return DISPUTE_ACTIONS.filter((a) => rels.has(a) && RULES[a](ctx));
}

/** PayPal's allowed sub-types for offers and claim acceptance, from allowed_response_options. */
export function responseOptions(d: PayPalDispute): { offerTypes: string[]; acceptClaimTypes: string[] } {
  const o = (d as { allowed_response_options?: { make_offer?: { offer_types?: string[] }; accept_claim?: { accept_claim_types?: string[] } } })
    .allowed_response_options;
  return { offerTypes: o?.make_offer?.offer_types ?? [], acceptClaimTypes: o?.accept_claim?.accept_claim_types ?? [] };
}

/** The evidence types PayPal has asked the seller for (evidences[] with source REQUESTED_FROM_SELLER). */
export function requestedEvidence(d: PayPalDispute): string[] {
  const ev = (d as { evidences?: { evidence_type?: string; source?: string }[] }).evidences ?? [];
  return [...new Set(ev.filter((e) => e.source === 'REQUESTED_FROM_SELLER' && e.evidence_type).map((e) => e.evidence_type!))];
}
