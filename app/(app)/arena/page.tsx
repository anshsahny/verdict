import type { Metadata } from 'next';
import { connection } from 'next/server';
import { getDb } from '@/lib/db';
import { computeBenchmark, projectPolicy } from '@/lib/arena/benchmark';
import { maxRunsPerHour, maxRunsPerRequest } from '@/lib/arena/caps';
import { loadArenaRuns } from '@/lib/arena/run';
import { toArenaRow } from '@/lib/ui/arena-report';
import { Arena } from './arena';

export const metadata: Metadata = { title: 'Arena' };

export default async function ArenaPage() {
  await connection();
  const runs = loadArenaRuns(getDb());
  const bench = computeBenchmark(runs);
  // The policy slider's curve: "auto-refund under $X", recomputed from stored runs (no model calls).
  const policy = Array.from({ length: 41 }, (_, i) => projectPolicy(runs, i * 5));
  return (
    <Arena
      rows={runs.map(toArenaRow)}
      bench={{
        runs: bench.runs,
        rightCallRate: bench.totals.rightCallRate,
        contestWinRate: bench.totals.contestWinRate,
        saved: bench.savedVsAlwaysRefundUsd,
        escalated: bench.totals.escalated,
        avgDecisionSec: bench.avgDecisionSec,
        avgCostUsd: bench.avgCostUsd,
        weakSpots: bench.weakSpots.map((w) => w.text),
        live: runs.filter((r) => r.mode === 'live').length,
      }}
      policy={policy}
      caps={{ perRequest: maxRunsPerRequest(), perHour: maxRunsPerHour() }}
      licenseKey={process.env.AG_STUDIO_LICENSE_KEY}
    />
  );
}
