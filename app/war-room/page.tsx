import type { Metadata } from 'next';
import { connection } from 'next/server';
import { getDb } from '@/lib/db';
import { getCaseFile, listDisputeRows } from '@/lib/views/disputes';
import type { WarRoomData } from '@/lib/ui/war-room-report';
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
    })),
    events,
    asOf: new Date().toISOString(),
  };
  return <WarRoom data={data} licenseKey={process.env.AG_STUDIO_LICENSE_KEY} aiEnabled={Boolean(process.env.ANTHROPIC_API_KEY)} />;
}
