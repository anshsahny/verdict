// The defender agent's structured decision. Validated with Zod on every run; anything that fails
// validation or the guardrails is sent back to the agent, never executed.

import { z } from 'zod';

export const AGENT_ACTIONS = ['accept', 'offer_refund', 'contest', 'escalate_to_human'] as const;
export type AgentAction = (typeof AGENT_ACTIONS)[number];

export const Decision = z.object({
  action: z.enum(AGENT_ACTIONS).describe('accept = full refund; offer_refund = partial refund offer; contest = submit evidence; escalate_to_human = no PayPal action'),
  amount: z.number().nullable().describe('USD. Refund or offer amount for accept/offer_refund; null for contest/escalate_to_human'),
  confidence: z.number().min(0).max(1),
  reasoning: z.array(z.string()).min(1).describe('Short steps, each grounded in a tool result'),
  evidence: z
    .array(
      z.object({
        type: z.string().describe('Evidence kind from list_available_evidence, e.g. tracking, signature, product_listing'),
        recordId: z.string().describe('The recordId exactly as list_available_evidence returned it'),
        whyItHelps: z.string(),
      }),
    )
    .describe('Records supporting the decision. Required for contest.'),
  risks: z.array(z.string()).describe('What could go wrong, including records that hurt our case'),
  draftMessageToBuyer: z.string().describe('Polite, factual message to the buyer; no promises beyond the action'),
});
export type Decision = z.infer<typeof Decision>;

// How a decision maps onto PayPal. escalate_to_human is internal and always available.
export const AGENT_TO_PAYPAL: Record<AgentAction, string[]> = {
  accept: ['accept_claim'],
  offer_refund: ['make_offer'],
  contest: ['provide_evidence', 'provide_supporting_info'],
  escalate_to_human: [],
};
