// One Arena run: the buyer agent files a claim, the defender responds, the buyer answers any offer,
// and the SIMULATED arbiter rules. Store records live in a throwaway in-memory database; the run's
// result is saved to the main database's arena tables.

import type Anthropic from '@anthropic-ai/sdk';
import { randomUUID } from 'node:crypto';
import { nowIso, openDb, type Db } from '@/lib/db';
import { runDefender } from '@/lib/agent/defender';
import { EVAL_NOW, materialize } from '@/lib/agent/eval/scenarios';
import type { Decision } from '@/lib/agent/schema';
import { getDispute } from '@/lib/disputes/store';
import { buildEvidencePacket } from '@/lib/evidence/packet';
import { arbitrate, type Verdict } from './arbiter';
import { BuyerAgent, type BuyerUsage } from './buyer';
import { maxTokensPerRun } from './caps';
import type { ArenaScenario } from './scenarios';

const PRICE = { input: 2, output: 10 }; // USD per million tokens (Sonnet 5.5), for cost reporting

export type ArenaRunResult = {
  runId: string;
  scenario: ArenaScenario;
  mode: 'simulated' | 'live' | 'sample';
  claim: string;
  decision: Decision | null;
  defenderStatus: string;
  defenderErrors: string[];
  offerReply: { accept: boolean; reply: string } | null;
  verdict: Verdict;
  packet: { strength: number; rating: string };
  startedAt: string;
  latencyMs: number; // defender time to a recommendation
  costUsd: number;
  liveDisputeId?: string; // bound runs only
};

export type ArenaEvent =
  | { type: 'start'; scenario: ArenaScenario }
  | { type: 'claim'; scenarioId: string; claim: string }
  | { type: 'decision'; scenarioId: string; action: string; amount: number | null; status: string; flags: string[] }
  | { type: 'offer_reply'; scenarioId: string; accept: boolean; reply: string }
  | { type: 'verdict'; scenarioId: string; result: ArenaRunResult };

export async function runArenaScenario(
  mainDb: Db,
  s: ArenaScenario,
  opts: { client?: Anthropic; buyer?: BuyerAgent; onEvent?: (e: ArenaEvent) => void } = {},
): Promise<ArenaRunResult> {
  const emit = opts.onEvent ?? (() => {});
  emit({ type: 'start', scenario: s });
  const startedAt = nowIso();
  const buyer = opts.buyer ?? new BuyerAgent(opts.client);
  const buyerUsage: BuyerUsage = { inputTokens: 0, outputTokens: 0 };

  const claim = await buyer.writeClaim(s, buyerUsage);
  emit({ type: 'claim', scenarioId: s.id, claim });
  const spec = { ...s.spec, buyerMessage: claim };
  const sim = openDb(':memory:');
  try {
    const disputeId = materialize(sim, spec, { tag: `A${s.index}`, prefix: 'ARENA' });
    const run = await runDefender({ db: sim, disputeId, client: opts.client, now: EVAL_NOW, tokenBudget: maxTokensPerRun() });
    const packet = buildEvidencePacket(sim, getDispute(sim, disputeId)!);
    emit({ type: 'decision', scenarioId: s.id, action: run.decision?.action ?? 'invalid', amount: run.decision?.amount ?? null, status: run.status, flags: run.validation.flags });

    let offerReply: ArenaRunResult['offerReply'] = null;
    if (run.decision?.action === 'offer_refund' && run.decision.amount) {
      offerReply = await buyer.respondToOffer(s, claim, run.decision.amount, run.decision.draftMessageToBuyer, buyerUsage);
      emit({ type: 'offer_reply', scenarioId: s.id, ...offerReply });
    }
    const verdict = arbitrate(s, run.status === 'invalid' ? null : run.decision, packet, offerReply);
    const costUsd = run.usage.costUsd + (buyerUsage.inputTokens * PRICE.input + buyerUsage.outputTokens * PRICE.output) / 1_000_000;

    const result: ArenaRunResult = {
      runId: randomUUID(),
      scenario: s,
      mode: 'simulated',
      claim,
      decision: run.decision,
      defenderStatus: run.status,
      defenderErrors: run.validation.errors,
      offerReply,
      verdict,
      packet: { strength: packet.strength, rating: packet.rating },
      startedAt,
      latencyMs: run.latencyMs,
      costUsd,
    };
    saveArenaRun(mainDb, result);
    emit({ type: 'verdict', scenarioId: s.id, result });
    return result;
  } finally {
    sim.close();
  }
}

export function saveArenaRun(db: Db, r: ArenaRunResult) {
  const s = r.scenario;
  db.transaction(() => {
    db.prepare(
      `INSERT OR REPLACE INTO arena_scenarios (id, seed, dispute_type, persona, ground_truth, order_id, payload_json) VALUES (?, ?, ?, ?, ?, NULL, ?)`,
    ).run(s.id, s.seed, s.type, s.persona, s.truth, JSON.stringify(s));
    db.prepare(`INSERT OR REPLACE INTO arena_runs (id, scenario_id, started_at, finished_at, mode, result_json, arbiter_json) VALUES (?, ?, ?, ?, ?, ?, ?)`).run(
      r.runId,
      s.id,
      r.startedAt,
      nowIso(),
      r.mode,
      JSON.stringify({ claim: r.claim, decision: r.decision, defenderStatus: r.defenderStatus, defenderErrors: r.defenderErrors, offerReply: r.offerReply, packet: r.packet, latencyMs: r.latencyMs, costUsd: r.costUsd, liveDisputeId: r.liveDisputeId }),
      JSON.stringify(r.verdict),
    );
  })();
}

/** Every stored run, rebuilt from the database (what the benchmark and the Arena page read). */
export function loadArenaRuns(db: Db): ArenaRunResult[] {
  const rows = db
    .prepare('SELECT r.id, r.started_at, r.mode, r.result_json, r.arbiter_json, s.payload_json FROM arena_runs r JOIN arena_scenarios s ON s.id = r.scenario_id ORDER BY r.started_at')
    .all() as { id: string; started_at: string; mode: ArenaRunResult['mode']; result_json: string; arbiter_json: string; payload_json: string }[];
  return rows.map((row) => {
    const res = JSON.parse(row.result_json);
    return {
      runId: row.id,
      scenario: JSON.parse(row.payload_json),
      mode: row.mode,
      startedAt: row.started_at,
      verdict: JSON.parse(row.arbiter_json),
      ...res,
    } as ArenaRunResult;
  });
}
