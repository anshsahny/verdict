// Run the defender agent on a dispute in the ledger and print its recommendation and trace.
//   npm run agent -- <disputeId>                 recommend (no PayPal action)
//   npm run agent -- --approve <decisionId>      execute an approved decision against PayPal
//   npm run agent -- --override <decisionId> <action> [amountUsd]
//   npm run agent -- --trace <decisionId>         markdown trace from the audit log

import { config } from 'dotenv';
config({ path: '.env.local', quiet: true });

import { getDb } from '../lib/db';
import { runDefender } from '../lib/agent/defender';
import { executeDecision } from '../lib/agent/executor';
import { AGENT_ACTIONS, type AgentAction } from '../lib/agent/schema';
import { paypal } from '../lib/paypal/client';

const args = process.argv.slice(2);
const db = getDb();

// Markdown trace of one decision from the audit log: tool calls, output, validation, approval.
function trace(decisionId: string): string {
  const run = db.prepare("SELECT at, ref, data_json FROM audit_log WHERE kind = 'agent.run' AND json_extract(data_json, '$.decisionId') = ?").get(decisionId) as
    | { at: string; ref: string; data_json: string }
    | undefined;
  if (!run) throw new Error(`no agent run for decision ${decisionId}`);
  const d = JSON.parse(run.data_json);
  const row = db.prepare('SELECT status, decided_by, executed_at, result_json, payload_json FROM decisions WHERE id = ?').get(decisionId) as Record<string, string | null>;
  const decision = JSON.parse(row.payload_json!).decision;
  const clip = (s: string, n = 600) => (s.length > n ? `${s.slice(0, n)}…` : s);
  return [
    `# Defender trace: ${run.ref}`,
    '',
    `Decision \`${decisionId}\` · ${run.at} · model \`${d.model}\` · prompt \`${d.promptVersion}\` · effort ${d.effort} · ${d.attempts.length} attempt(s) · ${(d.latencyMs / 1000).toFixed(1)} s · $${d.usage.costUsd.toFixed(4)}`,
    '',
    '## Tool calls',
    ...d.toolCalls.map((c: { name: string; input: unknown; output: string }, i: number) => `${i + 1}. \`${c.name}(${JSON.stringify(c.input)})\`\n   \`\`\`json\n   ${clip(c.output)}\n   \`\`\``),
    '',
    '## Decision (Zod-validated)',
    '```json',
    JSON.stringify(decision, null, 2),
    '```',
    '',
    `## Guardrails\nerrors: ${d.validation.errors.length ? d.validation.errors.join('; ') : 'none'} · flags: ${d.validation.flags.length ? d.validation.flags.join('; ') : 'none'} · routed: **${d.status}**`,
    '',
    `## Human step\nstatus **${row.status}**${row.decided_by ? ` by ${row.decided_by}` : ''}${row.executed_at ? ` at ${row.executed_at}` : ''}`,
    row.result_json ? `\n\`\`\`json\n${JSON.stringify(JSON.parse(row.result_json), null, 2)}\n\`\`\`` : '',
  ].join('\n');
}

(async () => {
  if (args[0] === '--trace') {
    console.log(trace(args[1]));
    return;
  }
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
