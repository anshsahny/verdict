// Run the Arena headless: buyer agent vs defender, scored by the SIMULATED arbiter.
//   npm run arena -- --runs 10                 10 new scenarios (random seed, printed)
//   npm run arena -- --runs 60 --seed 2026 --export    regenerate the committed sample benchmark
// Caps (ARENA_MAX_RUNS_PER_HOUR, ARENA_MAX_TOKENS) apply here too.

import { config } from 'dotenv';
config({ path: '.env.local', quiet: true });

import { mkdirSync, writeFileSync } from 'node:fs';
import { getDb } from '../lib/db';
import { ARBITER_LABEL } from '../lib/arena/arbiter';
import { computeBenchmark, projectPolicy } from '../lib/arena/benchmark';
import { assertArenaQuota } from '../lib/arena/caps';
import { runArenaScenario, type ArenaRunResult } from '../lib/arena/run';
import { SAMPLE_PATH } from '../lib/arena/sample';
import { generateScenarios } from '../lib/arena/scenarios';

const arg = (name: string, fallback?: string) => {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : fallback;
};
const runs = Number(arg('runs', '10'));
const seed = Number(arg('seed', String(Date.now() % 1_000_000)));
const concurrency = Number(arg('concurrency', '4'));
const exportSample = process.argv.includes('--export');

(async () => {
  const db = getDb();
  assertArenaQuota(db, runs);
  const scenarios = generateScenarios(seed, runs);
  console.log(`Arena: ${runs} runs, seed ${seed}. Outcomes by the ${ARBITER_LABEL}.`);

  const results: ArenaRunResult[] = new Array(scenarios.length);
  let next = 0;
  let failures = 0;
  await Promise.all(
    Array.from({ length: Math.min(concurrency, scenarios.length) }, async () => {
      while (next < scenarios.length) {
        const i = next++;
        try {
          results[i] = await runArenaScenario(db, scenarios[i]);
          process.stdout.write(results[i].verdict.rightCall ? '.' : 'x');
        } catch (e) {
          failures++;
          process.stdout.write('!');
          console.error(`\nrun ${scenarios[i].id} failed: ${(e as Error).message}`);
        }
      }
    }),
  );
  const done = results.filter(Boolean);
  console.log('\n');

  const head = ['#', 'type', 'variant', 'persona', 'truth', '$', 'agent', 'outcome', 'right'];
  const rows = done.map((r) => [
    String(r.scenario.index),
    r.scenario.type,
    r.scenario.variant,
    r.scenario.persona,
    r.scenario.truth.replace('_at_fault', ''),
    r.scenario.spec.amount.toFixed(2),
    `${r.decision?.action ?? 'invalid'}${r.decision?.amount != null ? ` $${r.decision.amount}` : ''}${r.offerReply ? (r.offerReply.accept ? ' (accepted)' : ' (declined)') : ''}`,
    r.verdict.outcome,
    r.verdict.rightCall ? 'yes' : 'NO',
  ]);
  const w = head.map((h, i) => Math.max(h.length, ...rows.map((r) => r[i].length)));
  const line = (r: string[]) => r.map((c, i) => c.padEnd(w[i])).join('  ');
  console.log(line(head));
  rows.forEach((r) => console.log(line(r)));

  const b = computeBenchmark(done);
  const pct = (x: number | null) => (x === null ? 'n/a' : `${Math.round(x * 100)}%`);
  console.log(`
SIMULATED benchmark (this batch)
  right call            ${pct(b.totals.rightCallRate)} (${b.totals.rightCalls}/${b.runs})
  contests won          ${pct(b.totals.contestWinRate)} (${b.totals.contestsWon}/${b.totals.contested})
  sent to a human       ${b.totals.escalated}
  disputed              $${b.totals.disputedUsd.toFixed(2)}; kept $${b.totals.retainedUsd.toFixed(2)}; refunded $${b.totals.refundedUsd.toFixed(2)}; fees $${b.totals.feesUsd.toFixed(2)}
  vs always-refund      saved $${b.savedVsAlwaysRefundUsd.toFixed(2)}
  avg decision / cost   ${b.avgDecisionSec.toFixed(1)}s / $${b.avgCostUsd.toFixed(3)} per dispute
Weak spots:${b.weakSpots.length ? b.weakSpots.map((s) => `\n  - ${s.text}`).join('') : ' none in this batch'}
Policy: auto-refund under $30 -> saved $${projectPolicy(done, 30).savedVsAlwaysRefundUsd.toFixed(2)} (${projectPolicy(done, 30).deltaVsAgentUsd >= 0 ? '+' : ''}${projectPolicy(done, 30).deltaVsAgentUsd.toFixed(2)} vs agent-only)`);

  if (exportSample) {
    mkdirSync('fixtures/arena', { recursive: true });
    writeFileSync(SAMPLE_PATH, JSON.stringify(done.map((r) => ({ ...r, mode: 'sample' })), null, 2) + '\n');
    console.log(`\nWrote ${done.length} runs to ${SAMPLE_PATH}`);
  }
  process.exitCode = failures ? 1 : 0;
})().catch((e) => {
  console.error('FAIL', (e as Error).message);
  process.exitCode = 1;
});
