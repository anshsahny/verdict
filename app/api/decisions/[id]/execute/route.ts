// The owner's Approve / Edit / Override on an agent decision. This is the only web path that acts
// on PayPal, and it goes through the executor (which re-checks PayPal's allowed actions first).
// In REPLAY mode the executor's PayPal client is the replay transport (lib/paypal/replay.ts).

import { z } from 'zod';
import { getDb } from '@/lib/db';
import { executeDecision } from '@/lib/agent/executor';
import { AGENT_ACTIONS } from '@/lib/agent/schema';
import { paypal } from '@/lib/paypal/client';
import { hourlyLimitHit } from '@/lib/rate-limit';

const Body = z.discriminatedUnion('mode', [
  z.object({ mode: z.literal('approve') }),
  z.object({ mode: z.literal('edit'), amount: z.number().positive().max(100_000).optional(), message: z.string().max(2000).optional() }),
  z.object({ mode: z.literal('override'), action: z.enum(AGENT_ACTIONS), amount: z.number().positive().max(100_000).nullable(), message: z.string().max(2000).optional() }),
]);

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: 'Invalid request.' }, { status: 400 });

  const db = getDb();
  const body = parsed.data;
  const limited = hourlyLimitHit(db, 'decision.executed', Number(process.env.EXECUTIONS_MAX_PER_HOUR ?? 20));
  if (limited) return Response.json({ error: limited }, { status: 429 });
  try {
    const result = await executeDecision(db, paypal(), id, {
      by: 'owner (web)',
      ...(body.mode === 'edit' ? { edits: { amount: body.amount, message: body.message } } : {}),
      ...(body.mode === 'override' ? { override: { action: body.action, amount: body.amount, message: body.message } } : {}),
    });
    return Response.json(result, { status: result.status === 'failed' ? 422 : 200 });
  } catch (e) {
    const msg = (e as Error).message;
    // Known, user-facing refusals from the executor (already decided, no decision to approve).
    if (/only proposed or needs_human|no decision|no agent decision/.test(msg)) return Response.json({ error: msg }, { status: 409 });
    console.error('[execute] failed:', msg);
    return Response.json({ error: 'Could not reach PayPal. Nothing was changed; please try again.' }, { status: 502 });
  }
}
