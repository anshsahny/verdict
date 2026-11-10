// Arena benchmark: aggregates stored runs into win rates, money, weak spots, and policy
// projections. Pure functions over stored results (no model calls), so the Arena page and the
// policy slider are instant and free. All numbers come from SIMULATED runs.

import type { ArenaRunResult } from './run';
import type { ArenaType, Persona } from './scenarios';

export type Slice = {
  runs: number;
  contested: number;
  contestsWon: number;
  contestWinRate: number | null;
  rightCalls: number;
  rightCallRate: number;
  escalated: number;
  disputedUsd: number;
  retainedUsd: number;
  refundedUsd: number;
  feesUsd: number;
};

export type WeakSpot = { type: ArenaType; variant: string; runs: number; wrong: number; costUsd: number; text: string };

export type Benchmark = {
  runs: number;
  totals: Slice;
  byType: Record<string, Slice>;
  byPersona: Record<string, Slice>;
  alwaysRefundLossUsd: number; // baseline: refund every dispute in full
  lossUsd: number; // refunds + fees under the agent
  savedVsAlwaysRefundUsd: number;
  weakSpots: WeakSpot[];
  avgDecisionSec: number;
  avgCostUsd: number;
};

const VARIANT_TEXT: Record<string, string> = {
  signed_delivery: 'a signed delivery',
  unsigned_delivery: 'an unsigned doorstep delivery',
  wrong_address: 'delivery to the wrong address',
  lost: 'a lost parcel',
  untracked: 'an untracked shipment',
  variation: 'normal handmade variation',
  damaged: 'a damaged item',
  wrong_item: 'a wrong item sent',
  loyal_customer: 'a long-standing customer',
  new_account_mismatch: 'a new account shipping elsewhere',
  new_account_untracked: 'a new account with an untracked parcel',
  real_duplicate: 'a real duplicate payment',
  separate_orders: 'two genuine separate orders',
  already_refunded: 'a duplicate that was already refunded',
  arrived_after_claim: 'a parcel that arrived after the claim',
  stalled: 'a stalled parcel',
};
const TYPE_TEXT: Record<ArenaType, string> = {
  not_received: 'Item-not-received',
  late_delivery: 'Late-delivery',
  not_as_described: 'Not-as-described',
  unauthorized: 'Unauthorized',
  duplicate: 'Duplicate-charge',
};

function slice(runs: ArenaRunResult[]): Slice {
  const contested = runs.filter((r) => r.decision?.action === 'contest' || (r.decision?.action === 'offer_refund' && r.offerReply && !r.offerReply.accept));
  const won = contested.filter((r) => r.verdict.outcome === 'SELLER_WINS');
  const sum = (f: (r: ArenaRunResult) => number) => Math.round(runs.reduce((s, r) => s + f(r), 0) * 100) / 100;
  return {
    runs: runs.length,
    contested: contested.length,
    contestsWon: won.length,
    contestWinRate: contested.length ? won.length / contested.length : null,
    rightCalls: runs.filter((r) => r.verdict.rightCall).length,
    rightCallRate: runs.length ? runs.filter((r) => r.verdict.rightCall).length / runs.length : 0,
    escalated: runs.filter((r) => r.verdict.outcome === 'ESCALATED').length,
    disputedUsd: sum((r) => r.scenario.spec.amount),
    retainedUsd: sum((r) => r.verdict.retainedUsd),
    refundedUsd: sum((r) => r.verdict.refundUsd),
    feesUsd: sum((r) => r.verdict.feeUsd),
  };
}

const groupBy = <K extends string>(runs: ArenaRunResult[], key: (r: ArenaRunResult) => K) =>
  runs.reduce<Record<string, ArenaRunResult[]>>((m, r) => ((m[key(r)] ??= []).push(r), m), {});

export function computeBenchmark(runs: ArenaRunResult[]): Benchmark {
  const totals = slice(runs);
  const byType = Object.fromEntries(Object.entries(groupBy(runs, (r) => r.scenario.type)).map(([k, v]) => [k, slice(v)]));
  const byPersona = Object.fromEntries(Object.entries(groupBy(runs, (r) => r.scenario.persona as Persona)).map(([k, v]) => [k, slice(v)]));

  // Weak spots: fact patterns where the agent most often made the wrong call, weighted by money.
  const weakSpots = Object.values(groupBy(runs, (r) => `${r.scenario.type}|${r.scenario.variant}`))
    .map((group): WeakSpot => {
      const { type, variant } = group[0].scenario;
      const wrong = group.filter((r) => !r.verdict.rightCall);
      const cost = Math.round(wrong.reduce((s, r) => s + r.verdict.refundUsd + r.verdict.feeUsd, 0) * 100) / 100;
      const verbs = [...new Set(wrong.map((r) => (r.verdict.outcome === 'BUYER_WINS' && r.decision?.action !== 'accept' ? 'loses the contest' : r.decision?.action === 'accept' ? 'refunds' : r.verdict.outcome === 'ESCALATED' ? 'escalates' : 'settles')))];
      return {
        type,
        variant,
        runs: group.length,
        wrong: wrong.length,
        costUsd: cost,
        text: `${TYPE_TEXT[type]} claims with ${VARIANT_TEXT[variant] ?? variant}: wrong call in ${wrong.length} of ${group.length} (${verbs.join(' / ')})${cost ? `, $${cost.toFixed(2)} lost` : ''}.`,
      };
    })
    .filter((w) => w.wrong > 0)
    .sort((a, b) => b.wrong / b.runs - a.wrong / a.runs || b.costUsd - a.costUsd)
    .slice(0, 5);

  const alwaysRefundLossUsd = totals.disputedUsd;
  const lossUsd = Math.round((totals.refundedUsd + totals.feesUsd) * 100) / 100;
  const timed = runs.filter((r) => r.latencyMs > 0);
  return {
    runs: runs.length,
    totals,
    byType,
    byPersona,
    alwaysRefundLossUsd,
    lossUsd,
    // Escalated disputes are excluded on both sides: their outcome isn't decided by the agent.
    savedVsAlwaysRefundUsd: Math.round((alwaysRefundLossUsd - lossUsd - escalatedAmount(runs)) * 100) / 100,
    weakSpots,
    avgDecisionSec: timed.length ? timed.reduce((s, r) => s + r.latencyMs, 0) / timed.length / 1000 : 0,
    avgCostUsd: runs.length ? runs.reduce((s, r) => s + (r.costUsd ?? 0), 0) / runs.length : 0,
  };
}

const escalatedAmount = (runs: ArenaRunResult[]) => runs.filter((r) => r.verdict.outcome === 'ESCALATED').reduce((s, r) => s + r.scenario.spec.amount, 0);

export type PolicyProjection = {
  autoRefundUnderUsd: number;
  autoRefunded: number;
  lossUsd: number;
  savedVsAlwaysRefundUsd: number;
  rightCallRate: number;
  deltaVsAgentUsd: number; // negative = the policy loses money compared with letting the agent handle everything
};

/**
 * Policy slider: "auto-refund every dispute under $X" applied to the stored runs. Disputes under the
 * threshold are refunded in full with no review; the rest keep the agent's recorded outcome.
 */
export function projectPolicy(runs: ArenaRunResult[], autoRefundUnderUsd: number): PolicyProjection {
  let loss = 0;
  let right = 0;
  let autoRefunded = 0;
  let escalated = 0;
  for (const r of runs) {
    const amount = r.scenario.spec.amount;
    if (amount < autoRefundUnderUsd) {
      autoRefunded++;
      loss += amount;
      if (r.scenario.rightActions.includes('accept')) right++;
    } else {
      loss += r.verdict.refundUsd + r.verdict.feeUsd;
      if (r.verdict.rightCall) right++;
      if (r.verdict.outcome === 'ESCALATED') escalated += amount;
    }
  }
  const base = computeBenchmark(runs);
  const total = runs.reduce((s, r) => s + r.scenario.spec.amount, 0);
  const round = (x: number) => Math.round(x * 100) / 100;
  const saved = round(total - loss - escalated);
  return {
    autoRefundUnderUsd,
    autoRefunded,
    lossUsd: round(loss),
    savedVsAlwaysRefundUsd: saved,
    rightCallRate: runs.length ? right / runs.length : 0,
    deltaVsAgentUsd: round(saved - base.savedVsAlwaysRefundUsd),
  };
}
