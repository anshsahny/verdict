import { describe, expect, it } from 'vitest';
import { nowIso, openDb } from '@/lib/db';
import { materialize } from '@/lib/agent/eval/scenarios';
import type { Decision } from '@/lib/agent/schema';
import { getDispute } from '@/lib/disputes/store';
import { buildEvidencePacket } from '@/lib/evidence/packet';
import { ARBITER_LABEL, LOST_DISPUTE_FEE_USD, arbitrate } from './arbiter';
import { computeBenchmark, projectPolicy } from './benchmark';
import { ArenaQuotaError, assertArenaQuota } from './caps';
import { loadArenaRuns, saveArenaRun, type ArenaRunResult } from './run';
import { generateScenarios, type ArenaScenario } from './scenarios';

// A scenario with chosen facts, its evidence packet, and helpers to build decisions.
function scenarioWith(type: ArenaScenario['type'], variant: string, amount?: number) {
  for (let seed = 1; seed < 500; seed++) {
    const s = generateScenarios(seed, 25).find((x) => x.type === type && x.variant === variant && (amount === undefined || (amount > 100 ? x.spec.amount > 100 : x.spec.amount <= 100)));
    if (!s) continue;
    const db = openDb(':memory:');
    const id = materialize(db, { ...s.spec, buyerMessage: 'claim' }, { tag: 'T1', prefix: 'TEST' });
    const packet = buildEvidencePacket(db, getDispute(db, id)!);
    return { s, packet };
  }
  throw new Error(`no ${type}/${variant}`);
}
const decide = (action: Decision['action'], packet: ReturnType<typeof scenarioWith>['packet'], kinds: string[] = [], amount: number | null = null): Decision => ({
  action,
  amount,
  confidence: 0.9,
  reasoning: ['r'],
  evidence: packet.items.filter((i) => kinds.includes(i.kind)).map((i) => ({ type: i.kind, recordId: i.recordId, whyItHelps: 'x' })),
  risks: [],
  draftMessageToBuyer: 'm',
});

describe('generateScenarios', () => {
  it('is deterministic: same seed, same scenarios', () => {
    expect(generateScenarios(2026, 30)).toEqual(generateScenarios(2026, 30));
    expect(generateScenarios(2026, 30)).not.toEqual(generateScenarios(2027, 30));
  });

  it('covers every type and persona evenly in a batch of 20', () => {
    const s = generateScenarios(7, 20);
    const count = (k: (x: ArenaScenario) => string) => Object.values(s.reduce<Record<string, number>>((m, x) => ((m[k(x)] = (m[k(x)] ?? 0) + 1), m), {}));
    expect(count((x) => x.type)).toEqual([4, 4, 4, 4, 4]);
    expect(count((x) => x.persona)).toEqual([5, 5, 5, 5]);
  });

  it('every scenario builds a valid store and dispute', () => {
    for (const s of generateScenarios(99, 40)) {
      const db = openDb(':memory:');
      const id = materialize(db, { ...s.spec, buyerMessage: 'x' }, { tag: `T${s.index}`, prefix: 'TEST' });
      expect(getDispute(db, id)?.amount_cents).toBe(Math.round(s.spec.amount * 100));
    }
  });
});

describe('SIMULATED arbiter', () => {
  it('labels every verdict as simulated', () => {
    const { s, packet } = scenarioWith('not_received', 'lost');
    expect(arbitrate(s, decide('accept', packet, [], s.spec.amount), packet, null).label).toBe(ARBITER_LABEL);
  });

  it('INR: a cited signed, tracked delivery to the right address wins', () => {
    const { s, packet } = scenarioWith('not_received', 'signed_delivery');
    const v = arbitrate(s, decide('contest', packet, ['tracking', 'delivery_confirmation', 'signature', 'address_match']), packet, null);
    expect(v).toMatchObject({ outcome: 'SELLER_WINS', retainedUsd: s.spec.amount, refundUsd: 0, rightCall: true });
  });

  it('INR: forgetting to cite the delivery scan loses, with the fee', () => {
    const { s, packet } = scenarioWith('not_received', 'signed_delivery');
    const v = arbitrate(s, decide('contest', packet, ['tracking']), packet, null);
    expect(v).toMatchObject({ outcome: 'BUYER_WINS', refundUsd: s.spec.amount, feeUsd: LOST_DISPUTE_FEE_USD, rightCall: false });
    expect(v.rules.find((r) => r.rule === 'evidence completeness')?.passed).toBe(false);
  });

  it('INR over $100 needs a signature', () => {
    const { s, packet } = scenarioWith('not_received', 'unsigned_delivery', 101);
    const v = arbitrate(s, decide('contest', packet, ['tracking', 'delivery_confirmation', 'address_match']), packet, null);
    expect(v.outcome).toBe('BUYER_WINS');
    expect(v.rules.find((r) => r.rule === 'signature over $100')?.passed).toBe(false);
  });

  it('records against the seller sink a contest (delivered to the wrong address)', () => {
    const { s, packet } = scenarioWith('not_received', 'wrong_address');
    const v = arbitrate(s, decide('contest', packet, ['tracking', 'delivery_confirmation']), packet, null);
    expect(v.outcome).toBe('BUYER_WINS');
    expect(v.rules.find((r) => r.rule === 'no contradicting records')?.passed).toBe(false);
  });

  it('SNAD: the listing beats a variation complaint but never a damage complaint', () => {
    const variation = scenarioWith('not_as_described', 'variation');
    expect(arbitrate(variation.s, decide('contest', variation.packet, ['product_listing', 'policy']), variation.packet, null).outcome).toBe('SELLER_WINS');
    const damaged = scenarioWith('not_as_described', 'damaged');
    expect(arbitrate(damaged.s, decide('contest', damaged.packet, ['product_listing', 'policy']), damaged.packet, null).outcome).toBe('BUYER_WINS');
  });

  it('offers: accepted settles for the offer; declined is judged on the cited evidence', () => {
    const { s, packet } = scenarioWith('not_as_described', 'variation');
    const offer = decide('offer_refund', packet, ['product_listing'], 20);
    expect(arbitrate(s, offer, packet, { accept: true, reply: 'ok' })).toMatchObject({ outcome: 'SETTLED', refundUsd: 20, retainedUsd: s.spec.amount - 20 });
    const declined = arbitrate(s, offer, packet, { accept: false, reply: 'no' });
    expect(declined.outcome).toBe('SELLER_WINS');
    expect(declined.rules[0].rule).toBe('buyer declined offer');
  });

  it('duplicates: a prior refund or separate orders win; a real duplicate conceded is the right call', () => {
    const refunded = scenarioWith('duplicate', 'already_refunded');
    expect(arbitrate(refunded.s, decide('contest', refunded.packet, ['refund_record']), refunded.packet, null).outcome).toBe('SELLER_WINS');
    const real = scenarioWith('duplicate', 'real_duplicate');
    expect(arbitrate(real.s, decide('accept', real.packet, [], real.s.spec.amount), real.packet, null)).toMatchObject({ outcome: 'BUYER_WINS', rightCall: true });
  });

  it('only real, helpful citations count (a hurting record cited as support does not)', () => {
    const { s, packet } = scenarioWith('not_received', 'signed_delivery');
    const d = decide('contest', packet, ['tracking', 'delivery_confirmation']);
    d.evidence.push({ type: 'signature', recordId: 'made-up-id', whyItHelps: 'x' });
    expect(arbitrate(s, d, packet, null).outcome).toBe(s.spec.amount > 100 ? 'BUYER_WINS' : 'SELLER_WINS');
  });

  it('escalations and invalid decisions have no automatic outcome', () => {
    const { s, packet } = scenarioWith('unauthorized', 'new_account_untracked');
    expect(arbitrate(s, decide('escalate_to_human', packet), packet, null)).toMatchObject({ outcome: 'ESCALATED', refundUsd: 0, rightCall: true });
    expect(arbitrate(s, null, packet, null).outcome).toBe('ESCALATED');
  });
});

describe('caps', () => {
  const fakeRun = (startedAt: string, mode: ArenaRunResult['mode'] = 'simulated'): ArenaRunResult => {
    const s = generateScenarios(1, 1)[0];
    return {
      runId: `r-${Math.random()}`, scenario: s, mode, claim: 'c', decision: null, defenderStatus: 'invalid', defenderErrors: [], offerReply: null,
      verdict: { label: ARBITER_LABEL, outcome: 'ESCALATED', refundUsd: 0, feeUsd: 0, retainedUsd: 0, rules: [], rightCall: false },
      packet: { strength: 0, rating: 'none' }, startedAt, latencyMs: 0, costUsd: 0,
    };
  };

  it('enforces runs per hour, ignoring older runs and the imported sample', () => {
    process.env.ARENA_MAX_RUNS_PER_HOUR = '3';
    try {
      const db = openDb(':memory:');
      const now = new Date('2026-11-11T12:00:00Z');
      saveArenaRun(db, fakeRun('2026-11-11T10:00:00.000Z')); // two hours ago
      saveArenaRun(db, fakeRun('2026-11-11T11:30:00.000Z', 'sample'));
      saveArenaRun(db, fakeRun('2026-11-11T11:30:00.000Z'));
      saveArenaRun(db, fakeRun('2026-11-11T11:45:00.000Z'));
      expect(() => assertArenaQuota(db, 1, now)).not.toThrow();
      expect(() => assertArenaQuota(db, 2, now)).toThrow(ArenaQuotaError);
    } finally {
      delete process.env.ARENA_MAX_RUNS_PER_HOUR;
    }
  });
});

describe('benchmark', () => {
  const runsFor = (n: number) =>
    generateScenarios(5, n).map((s, i): ArenaRunResult => {
      const right = i % 3 !== 0;
      return {
        runId: `run-${i}`, scenario: s, mode: 'simulated', claim: 'c', decision: { action: 'contest', amount: null, confidence: 0.9, reasoning: ['r'], evidence: [], risks: [], draftMessageToBuyer: 'm' },
        defenderStatus: 'proposed', defenderErrors: [], offerReply: null,
        verdict: { label: ARBITER_LABEL, outcome: right ? 'SELLER_WINS' : 'BUYER_WINS', refundUsd: right ? 0 : s.spec.amount, feeUsd: right ? 0 : 15, retainedUsd: right ? s.spec.amount : 0, rules: [], rightCall: right },
        packet: { strength: 0.8, rating: 'strong' }, startedAt: nowIso(), latencyMs: 10_000, costUsd: 0.03,
      };
    });

  it('the benchmark from the database equals the benchmark from the runs (what the page shows)', () => {
    const db = openDb(':memory:');
    const runs = runsFor(15);
    runs.forEach((r) => saveArenaRun(db, r));
    const fromDb = loadArenaRuns(db);
    expect(fromDb).toHaveLength(15);
    expect(computeBenchmark(fromDb)).toEqual(computeBenchmark(runs));
  });

  it('adds up money and rates', () => {
    const runs = runsFor(9);
    const b = computeBenchmark(runs);
    const lost = runs.filter((r) => r.verdict.outcome === 'BUYER_WINS');
    expect(b.totals.contested).toBe(9);
    expect(b.totals.contestsWon).toBe(6);
    expect(b.totals.feesUsd).toBe(15 * lost.length);
    expect(b.savedVsAlwaysRefundUsd).toBeCloseTo(b.alwaysRefundLossUsd - b.lossUsd, 2);
    expect(b.weakSpots.length).toBeGreaterThan(0);
    expect(b.weakSpots[0].text).toMatch(/wrong call in \d+ of \d+/);
  });

  it('policy slider: threshold 0 changes nothing; a high threshold refunds everything', () => {
    const runs = runsFor(12);
    const b = computeBenchmark(runs);
    expect(projectPolicy(runs, 0)).toMatchObject({ autoRefunded: 0, deltaVsAgentUsd: 0, savedVsAlwaysRefundUsd: b.savedVsAlwaysRefundUsd });
    const all = projectPolicy(runs, 10_000);
    expect(all.autoRefunded).toBe(12);
    expect(all.savedVsAlwaysRefundUsd).toBe(0);
  });
});
