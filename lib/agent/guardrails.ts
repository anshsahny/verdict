// Deterministic checks on every agent decision. Errors go back to the agent for a retry; flags
// route a valid decision to a human instead of the normal approval queue.

import { allowedActions } from '@/lib/paypal/actions';
import type { PayPalDispute } from '@/lib/paypal/dispute-schema';
import type { EvidencePacket } from '@/lib/evidence/packet';
import { AGENT_TO_PAYPAL, type AgentAction, type Decision } from './schema';

export const approvalThreshold = () => Number(process.env.APPROVAL_THRESHOLD ?? 250); // USD
export const minConfidence = () => Number(process.env.MIN_CONFIDENCE ?? 0.6);

/** The agent actions this dispute allows now (escalate_to_human always). */
export function availableAgentActions(dispute: Pick<PayPalDispute, 'status' | 'dispute_life_cycle_stage' | 'links'>): AgentAction[] {
  const paypal = allowedActions(dispute);
  return (Object.keys(AGENT_TO_PAYPAL) as AgentAction[]).filter(
    (a) => a === 'escalate_to_human' || AGENT_TO_PAYPAL[a].some((p) => paypal.includes(p as never)),
  );
}

export type Validation = { errors: string[]; flags: string[] };

export function validateDecision(
  d: Decision,
  ctx: { dispute: PayPalDispute; packet: EvidencePacket; disputeAmount: number; buyerText: string },
): Validation {
  const errors: string[] = [];
  const flags: string[] = [];

  // (a) only actions PayPal allows right now
  const available = availableAgentActions(ctx.dispute);
  if (!available.includes(d.action)) errors.push(`Action "${d.action}" is not available for this dispute now. Choose one of: ${available.join(', ')}.`);

  // (b) every evidence item must cite a record the packet actually contains
  const known = new Map<string, Set<string>>();
  for (const i of ctx.packet.items) known.set(i.recordId, new Set([...(known.get(i.recordId) ?? []), i.kind]));
  for (const e of d.evidence) {
    const kinds = known.get(e.recordId);
    if (!kinds) errors.push(`Evidence recordId "${e.recordId}" is not in list_available_evidence. Cite only recordIds it returned.`);
    else if (!kinds.has(e.type)) errors.push(`Record "${e.recordId}" has evidence kinds [${[...kinds].join(', ')}], not "${e.type}".`);
  }
  if (d.action === 'contest') {
    const helpful = d.evidence.filter((e) => ctx.packet.items.some((i) => i.recordId === e.recordId && i.kind === e.type && i.helps));
    if (!helpful.length) errors.push('A contest needs at least one cited evidence item that helps the seller.');
  }

  // amounts
  if (d.action === 'accept' || d.action === 'offer_refund') {
    if (d.amount === null || !(d.amount > 0)) errors.push(`${d.action} needs a positive amount in USD.`);
    else if (d.amount > ctx.disputeAmount + 0.001) errors.push(`Amount ${d.amount} exceeds the disputed amount ${ctx.disputeAmount}.`);
    if (d.action === 'offer_refund' && d.amount !== null && d.amount >= ctx.disputeAmount) errors.push('An offer must be less than the disputed amount; use accept for a full refund.');
  }

  // (c) route to a human
  // Judge by what's at stake (the disputed amount), not the size of the response.
  if (ctx.disputeAmount > approvalThreshold()) flags.push(`Disputed amount $${ctx.disputeAmount.toFixed(2)} is above the approval threshold ($${approvalThreshold()}).`);
  if (d.confidence < minConfidence()) flags.push(`Confidence ${d.confidence} is below ${minConfidence()}.`);
  if (d.action === 'escalate_to_human') flags.push('Agent escalated to a human.');
  if (looksLikeInjection(ctx.buyerText)) flags.push('Buyer text contains instructions aimed at the clerk (possible prompt injection).');

  return { errors, flags };
}

// Buyer text that tries to instruct the clerk. Defense in depth: the prompt already treats buyer
// text as data; this makes sure such a case is always seen by a human.
const INJECTION = [
  /ignore (all |any |your |the )?(previous |prior |above )?(instructions|rules|prompt)/i,
  /\b(system|assistant|developer)\s*(prompt|message|override)?\s*:/i,
  /you are (now )?(an?|the) /i,
  /\b(approve|accept|refund) (this|the|my) (claim|dispute|refund) (immediately|now|automatically)/i,
  /(disregard|override|bypass) (your|the|all) /i,
  /\bnew instructions\b/i,
];
export const looksLikeInjection = (text: string) => INJECTION.some((r) => r.test(text));
