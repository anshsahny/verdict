// The merchant's Playbook: store policies, dispute rules and guardrail thresholds. Stored in
// merchants.policy_json; the agent reads the policies (get_merchant_policy) and the guardrails read
// the thresholds, so editing the Playbook changes what Verdict does.

import { z } from 'zod';
import { audit, type Db } from '@/lib/db';
import { MERCHANT_ID, MERCHANT_POLICY } from '@/lib/db/seed';

export const Playbook = z.object({
  shipping: z.string().trim().min(1).max(600),
  returns: z.string().trim().min(1).max(600),
  damaged: z.string().trim().min(1).max(600),
  lost: z.string().trim().min(1).max(600),
  handmade: z.string().trim().min(1).max(600),
  disputeRules: z.array(z.string().trim().min(1).max(400)).min(1).max(12),
  approvalThresholdUsd: z.number().min(0).max(100_000),
  minConfidence: z.number().min(0).max(1),
});
export type Playbook = z.infer<typeof Playbook>;

const DEFAULT_RULES = MERCHANT_POLICY.disputes.split(/(?<=\.)\s+(?=[A-Z])/);

export function defaultPlaybook(): Playbook {
  return {
    shipping: MERCHANT_POLICY.shipping,
    returns: MERCHANT_POLICY.returns,
    damaged: MERCHANT_POLICY.damaged,
    lost: MERCHANT_POLICY.lost,
    handmade: MERCHANT_POLICY.handmade,
    disputeRules: DEFAULT_RULES,
    approvalThresholdUsd: Number(process.env.APPROVAL_THRESHOLD ?? 250),
    minConfidence: Number(process.env.MIN_CONFIDENCE ?? 0.6),
  };
}

export function getPlaybook(db: Db, merchantId = MERCHANT_ID): Playbook {
  const row = db.prepare('SELECT policy_json FROM merchants WHERE id = ?').get(merchantId) as { policy_json: string } | undefined;
  const stored = row ? (JSON.parse(row.policy_json) as Record<string, unknown>) : {};
  const base = defaultPlaybook();
  const rules = Array.isArray(stored.disputeRules) ? stored.disputeRules : typeof stored.disputes === 'string' ? stored.disputes.split(/(?<=\.)\s+(?=[A-Z])/) : base.disputeRules;
  const merged = { ...base, ...stored, disputeRules: rules };
  const parsed = Playbook.safeParse(merged);
  return parsed.success ? parsed.data : base;
}

/** Saves the Playbook. The agent-facing `disputes` text is kept in step with the rules list. */
export function savePlaybook(db: Db, next: Playbook, by: string, merchantId = MERCHANT_ID) {
  const policy = { ...next, disputes: next.disputeRules.join(' ') };
  db.prepare('UPDATE merchants SET policy_json = ? WHERE id = ?').run(JSON.stringify(policy), merchantId);
  audit(db, 'human', 'playbook.saved', merchantId, { by, approvalThresholdUsd: next.approvalThresholdUsd, minConfidence: next.minConfidence, rules: next.disputeRules.length });
}
