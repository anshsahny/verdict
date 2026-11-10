// Run the defender agent on a dispute in the ledger and print its recommendation and trace.
//   npm run agent -- <disputeId>                 recommend (no PayPal action)
//   npm run agent -- --approve <decisionId>      execute an approved decision against PayPal
//   npm run agent -- --override <decisionId> <action> [amountUsd]

import { config } from 'dotenv';
config({ path: '.env.local', quiet: true });

import { getDb } from '../lib/db';
import { runDefender } from '../lib/agent/defender';
import { executeDecision } from '../lib/agent/executor';
import { AGENT_ACTIONS, type AgentAction } from '../lib/agent/schema';
import { paypal } from '../lib/paypal/client';

const args = process.argv.slice(2);
const db = getDb();

(async () => {
  if (args[0] === '--approve' || args[0] === '--override') {
    const [, decisionId, action, amount] = args;
    if (args[0] === '--override' && !AGENT_ACTIONS.includes(action as AgentAction)) throw new Error(`action must be one of ${AGENT_ACTIONS.join(', ')}`);
    const r = await executeDecision(db, paypal(), decisionId, {
      by: process.env.USER ?? 'human',
      override: args[0] === '--override' ? { action: action as AgentAction, amount: amount ? Number(amount) : null } : undefined,
    });
    console.log(JSON.stringify(r, null, 2));
    return;
  }

  const disputeId = args[0];
  if (!disputeId) throw new Error('usage: npm run agent -- <disputeId>');
  const run = await runDefender({ db, disputeId });
  console.log(`\n${disputeId}  ${run.status.toUpperCase()}  decision ${run.decisionId}`);
  console.log(`model ${run.model}, ${run.attempts} attempt(s), ${run.toolCalls.length} tool calls, ${(run.latencyMs / 1000).toFixed(1)}s, $${run.usage.costUsd.toFixed(4)}`);
  console.log(`tools: ${run.toolCalls.map((c) => c.name).join(' → ')}`);
  if (run.validation.errors.length) console.log(`ERRORS: ${run.validation.errors.join(' | ')}`);
  if (run.validation.flags.length) console.log(`flags: ${run.validation.flags.join(' | ')}`);
  console.log(JSON.stringify(run.decision, null, 2));
})().catch((e) => {
  console.error('FAIL', (e as Error).message);
  process.exitCode = 1;
});
