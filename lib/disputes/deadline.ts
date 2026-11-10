// Seller response deadlines → time remaining → urgency bucket, for the deadline clocks and the
// "deadlines < 48h" KPI.

export type DeadlineBucket = 'overdue' | 'critical' | 'urgent' | 'soon' | 'ok' | 'none';

export type Deadline = { dueAt: string | null; msRemaining: number | null; bucket: DeadlineBucket };

const HOUR = 3_600_000;

// Upper bounds (exclusive) for each bucket, in hours remaining.
export const BUCKET_LIMITS_HOURS = { critical: 24, urgent: 48, soon: 7 * 24 } as const;

/** `none` means PayPal isn't waiting on the seller (e.g. UNDER_REVIEW, RESOLVED): no clock. */
export function computeDeadline(dueAt: string | null | undefined, now: Date = new Date()): Deadline {
  if (!dueAt) return { dueAt: null, msRemaining: null, bucket: 'none' };
  const due = Date.parse(dueAt);
  if (Number.isNaN(due)) return { dueAt: null, msRemaining: null, bucket: 'none' };
  const ms = due - now.getTime();
  const hours = ms / HOUR;
  const bucket: DeadlineBucket =
    ms <= 0
      ? 'overdue'
      : hours < BUCKET_LIMITS_HOURS.critical
        ? 'critical'
        : hours < BUCKET_LIMITS_HOURS.urgent
          ? 'urgent'
          : hours < BUCKET_LIMITS_HOURS.soon
            ? 'soon'
            : 'ok';
  return { dueAt, msRemaining: ms, bucket };
}

/** "2d 4h", "5h 12m", "overdue by 3h". */
export function formatRemaining(ms: number | null): string {
  if (ms === null) return '—';
  const abs = Math.abs(ms);
  const d = Math.floor(abs / (24 * HOUR));
  const h = Math.floor((abs % (24 * HOUR)) / HOUR);
  const m = Math.floor((abs % HOUR) / 60_000);
  const text = d > 0 ? `${d}d ${h}h` : h > 0 ? `${h}h ${m}m` : `${m}m`;
  return ms <= 0 ? `overdue by ${text}` : text;
}
