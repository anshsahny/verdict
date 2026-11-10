// Cost and abuse caps for Arena runs (the public URL can trigger them). Env-configurable.

import type { Db } from '@/lib/db';

export const maxRunsPerHour = () => Number(process.env.ARENA_MAX_RUNS_PER_HOUR ?? 20);
export const maxTokensPerRun = () => Number(process.env.ARENA_MAX_TOKENS ?? 60_000);
export const maxRunsPerRequest = () => Number(process.env.ARENA_MAX_RUNS_PER_REQUEST ?? 5);

export class ArenaQuotaError extends Error {
  constructor(
    readonly used: number,
    readonly limit: number,
  ) {
    super(`Arena limit reached: ${used} runs in the last hour (limit ${limit}). The sample benchmark is always available.`);
    this.name = 'ArenaQuotaError';
  }
}

/** Throws unless `requested` more runs fit in the hourly limit. Imported sample runs don't count. */
export function assertArenaQuota(db: Db, requested: number, now = new Date()): void {
  const since = new Date(now.getTime() - 3_600_000).toISOString();
  const { n } = db.prepare("SELECT COUNT(*) AS n FROM arena_runs WHERE started_at > ? AND mode != 'sample'").get(since) as { n: number };
  if (n + requested > maxRunsPerHour()) throw new ArenaQuotaError(n, maxRunsPerHour());
}
