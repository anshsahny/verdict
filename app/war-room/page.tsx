import type { Metadata } from 'next';
import { connection } from 'next/server';
import { getDb } from '@/lib/db';
import { getCaseFile, listDisputeRows } from '@/lib/views/disputes';
import type { WarRoomData } from '@/lib/ui/war-room-report';
import type { InboxItem, RecentItem } from './inbox';
import { WarRoom } from './war-room';

export const metadata: Metadata = { title: 'War Room' };

export default async function WarRoomPage() {
  await connection(); // live ledger: render per request
  const db = getDb();
  const rows = listDisputeRows(db);
  const events = rows.flatMap((r) =>
    (getCaseFile(db, r.id)?.timeline ?? [])
      .filter((t) => t.kind !== 'system')
      .map((t, i) => ({ ...t, detail: t.detail ?? '', id: `${r.id}-${i}`, disputeId: r.id })),
  );
  const data: WarRoomData = {
    // Queue order: open disputes by time left (no clock after those), then resolved.
    disputes: rows.map((r) => ({
      ...r,
      due48: ['overdue', 'critical', 'urgent'].includes(r.urgency) ? 1 : 0,
      queueRank: r.state === 'Resolved' ? 1e6 - Date.parse(r.filedAt) / 1e9 : (r.hoursLeft ?? 1e5),
    })).sort((a, b) => a.queueRank - b.queueRank),
    events,
    asOf: new Date().toISOString(),
  };
  // What needs the merchant: disputes waiting on them, soonest deadline first, with the latest recommendation.
  const latest = db.prepare(
    "SELECT action, amount_cents, status, confidence FROM decisions WHERE dispute_id = ? AND status IN ('proposed', 'needs_human') ORDER BY created_at DESC LIMIT 1",
  );
  const inbox: InboxItem[] = rows
    .filter((r) => r.status === 'Waiting on us')
    .sort((a, b) => (a.hoursLeft ?? 1e9) - (b.hoursLeft ?? 1e9))
    .map((r) => {
      const dec = latest.get(r.id) as { action: string; amount_cents: number | null; status: string; confidence: number | null } | undefined;
      return {
        id: r.id,
        reason: r.reason,
        amount: r.amount,
        customer: r.customer,
        dueAt: r.dueAt,
        rating: r.rating,
        recommendation: dec ? { action: dec.action, amount: dec.amount_cents != null ? dec.amount_cents / 100 : null, status: dec.status, summary: dec.status === 'needs_human' ? 'flagged for your review' : `${Math.round((dec.confidence ?? 0) * 100)}% confident` } : null,
      };
    });
  const recent: RecentItem[] = rows
    .filter((r) => r.state === 'Resolved')
    .slice(0, 5)
    .map((r) => ({ id: r.id, reason: r.reason, amount: r.amount, outcome: r.outcome, won: r.won === 1, closedAt: r.filedAt }));
  return (
    <WarRoom data={data} inbox={inbox} recent={recent} licenseKey={process.env.AG_STUDIO_LICENSE_KEY} aiEnabled={Boolean(process.env.ANTHROPIC_API_KEY)} />
  );
}
