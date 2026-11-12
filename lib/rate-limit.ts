// Hourly caps for expensive or state-changing actions on the public URL, counted from the audit log
// (so they hold across restarts and need no extra store).

import type { Db } from '@/lib/db';

/** The message to send back (with a 429) if `kind` already happened `limit` times in the last hour. */
export function hourlyLimitHit(db: Db, kind: string, limit: number, now = new Date()): string | null {
  const since = new Date(now.getTime() - 3_600_000).toISOString();
  const { n } = db.prepare('SELECT COUNT(*) AS n FROM audit_log WHERE kind = ? AND at > ?').get(kind, since) as { n: number };
  return n >= limit ? `Limit reached: ${limit} per hour. Please try again later.` : null;
}
