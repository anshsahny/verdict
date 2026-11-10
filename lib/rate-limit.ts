// Hourly caps for expensive or state-changing actions on the public URL, counted from the audit log
// (so they hold across restarts and need no extra store).

import type { Db } from '@/lib/db';

export class RateLimitError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'RateLimitError';
  }
}

export function assertHourlyLimit(db: Db, kind: string, limit: number, now = new Date()) {
  const since = new Date(now.getTime() - 3_600_000).toISOString();
  const { n } = db.prepare('SELECT COUNT(*) AS n FROM audit_log WHERE kind = ? AND at > ?').get(kind, since) as { n: number };
  if (n >= limit) throw new RateLimitError(`Limit reached: ${limit} per hour. Please try again later.`);
}

export const agentRunsPerHour = () => Number(process.env.AGENT_MAX_RUNS_PER_HOUR ?? 30);
