// Run a few Arena scenarios and stream each round as server-sent events. Capped per request and
// per hour (ARENA_MAX_RUNS_PER_REQUEST, ARENA_MAX_RUNS_PER_HOUR, ARENA_MAX_TOKENS).

import { z } from 'zod';
import { getDb } from '@/lib/db';
import { ArenaQuotaError, assertArenaQuota, maxRunsPerRequest } from '@/lib/arena/caps';
import { runArenaScenario, type ArenaEvent } from '@/lib/arena/run';
import { generateScenarios } from '@/lib/arena/scenarios';

const Body = z.object({ runs: z.number().int().min(1).max(20), seed: z.number().int().min(1).max(2 ** 31).optional() });

export async function POST(req: Request) {
  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: 'Invalid request.' }, { status: 400 });
  const runs = Math.min(parsed.data.runs, maxRunsPerRequest());
  const db = getDb();
  try {
    assertArenaQuota(db, runs);
  } catch (e) {
    if (e instanceof ArenaQuotaError) return Response.json({ error: e.message }, { status: 429 });
    throw e;
  }

  const seed = parsed.data.seed ?? Math.floor(Math.random() * 1_000_000) + 1;
  const scenarios = generateScenarios(seed, runs);
  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      const send = (event: ArenaEvent | { type: 'done'; seed: number } | { type: 'error'; message: string }) =>
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(event)}\n\n`));
      for (const s of scenarios) {
        if (req.signal.aborted) break;
        try {
          await runArenaScenario(db, s, { onEvent: send });
        } catch (e) {
          console.error('[arena] run failed:', (e as Error).message);
          send({ type: 'error', message: `Run ${s.index} failed; continuing.` });
        }
      }
      send({ type: 'done', seed });
      controller.close();
    },
  });
  return new Response(stream, { headers: { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-store', Connection: 'keep-alive' } });
}
