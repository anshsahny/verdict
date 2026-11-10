// The precomputed sample benchmark (fixtures/arena/sample.json, produced by
// `npm run arena -- --runs 60 --seed 2026 --export`). Loaded into an empty database on first open so
// the public URL shows Arena results instantly, with no model calls. Rows are marked mode='sample'.

import { existsSync, readFileSync } from 'node:fs';
import type { Db } from '@/lib/db';

export const SAMPLE_PATH = 'fixtures/arena/sample.json';

type SampleRun = {
  runId: string;
  scenario: { id: string; seed: number; type: string; persona: string; truth: string };
  startedAt: string;
  verdict: unknown;
  [k: string]: unknown;
};

export function importArenaSampleIfEmpty(db: Db, path = SAMPLE_PATH): number {
  if (!existsSync(path)) return 0;
  const { n } = db.prepare('SELECT COUNT(*) AS n FROM arena_runs').get() as { n: number };
  if (n > 0) return 0;
  const runs = JSON.parse(readFileSync(path, 'utf8')) as SampleRun[];
  const insertScenario = db.prepare('INSERT OR REPLACE INTO arena_scenarios (id, seed, dispute_type, persona, ground_truth, order_id, payload_json) VALUES (?, ?, ?, ?, ?, NULL, ?)');
  const insertRun = db.prepare("INSERT OR IGNORE INTO arena_runs (id, scenario_id, started_at, finished_at, mode, result_json, arbiter_json) VALUES (?, ?, ?, ?, 'sample', ?, ?)");
  db.transaction(() => {
    for (const r of runs) {
      const { runId, scenario, startedAt, verdict, mode: _mode, ...rest } = r;
      insertScenario.run(scenario.id, scenario.seed, scenario.type, scenario.persona, scenario.truth, JSON.stringify(scenario));
      insertRun.run(runId, scenario.id, startedAt, startedAt, JSON.stringify(rest), JSON.stringify(verdict));
    }
  })();
  return runs.length;
}
