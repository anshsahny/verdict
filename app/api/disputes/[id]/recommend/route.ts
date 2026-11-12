// Ask the defender agent for a recommendation on one dispute. No PayPal action happens here.

import { getDb } from '@/lib/db';
import { runDefender } from '@/lib/agent/defender';
import { getDispute } from '@/lib/disputes/store';
import { hourlyLimitHit } from '@/lib/rate-limit';

export async function POST(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const db = getDb();
  if (!getDispute(db, id)) return Response.json({ error: 'Dispute not found.' }, { status: 404 });
  const limited = hourlyLimitHit(db, 'agent.run', Number(process.env.AGENT_MAX_RUNS_PER_HOUR ?? 30));
  if (limited) return Response.json({ error: limited }, { status: 429 });
  try {
    const run = await runDefender({ db, disputeId: id });
    return Response.json({ decisionId: run.decisionId, status: run.status, decision: run.decision, flags: run.validation.flags, errors: run.validation.errors, latencyMs: run.latencyMs, costUsd: run.usage.costUsd });
  } catch (e) {
    console.error('[recommend] failed:', (e as Error).message);
    return Response.json({ error: 'The agent could not finish. Please try again.' }, { status: 502 });
  }
}
