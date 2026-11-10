// Polling fallback: list disputes from PayPal, fetch any that are new or changed since we last saw
// them, and upsert. Runs on an interval from instrumentation.ts, and on demand.

import { audit, type Db } from '@/lib/db';
import { PayPalDispute } from '@/lib/paypal/dispute-schema';
import { getDispute, recordDisputeEvent, upsertDispute } from './store';

type Summary = { dispute_id: string; update_time: string; status: string; dispute_life_cycle_stage: string };

export type SyncDeps = {
  db: Db;
  listDisputes: () => Promise<Summary[]>;
  fetchDispute: (id: string) => Promise<PayPalDispute | null | undefined>;
};

export type SyncReport = { listed: number; fetched: number; inserted: number; updated: number; failed: number };

export async function syncDisputes(deps: SyncDeps): Promise<SyncReport> {
  const report: SyncReport = { listed: 0, fetched: 0, inserted: 0, updated: 0, failed: 0 };
  const summaries = await deps.listDisputes();
  report.listed = summaries.length;
  for (const s of summaries) {
    const stored = getDispute(deps.db, s.dispute_id);
    const changed = !stored || !stored.raw_is_full || Date.parse(s.update_time) > Date.parse(stored.updated_at);
    if (!changed) continue;
    const full = await deps.fetchDispute(s.dispute_id).catch(() => undefined);
    if (!full) {
      report.failed++;
      continue;
    }
    report.fetched++;
    deps.db.transaction(() => {
      const r = upsertDispute(deps.db, full, { full: true, source: 'poll' });
      if (r === 'inserted' || r === 'updated') report[r]++;
      // Timeline entries only for changes a merchant would notice, not every update_time bump.
      const visible = !stored || stored.status !== full.status || stored.stage !== full.dispute_life_cycle_stage || stored.outcome !== (full.dispute_outcome?.outcome_code ?? null);
      if ((r === 'inserted' || r === 'updated') && visible) {
        recordDisputeEvent(deps.db, {
          disputeId: full.dispute_id,
          paypalEventId: null,
          eventType: r === 'inserted' ? 'POLL.DISPUTE.DISCOVERED' : 'POLL.DISPUTE.CHANGED',
          source: 'poll',
          status: full.status,
          stage: full.dispute_life_cycle_stage,
          payload: { update_time: full.update_time },
        });
      }
    })();
  }
  if (report.inserted || report.updated || report.failed) audit(deps.db, 'system', 'sync.disputes', null, report);
  return report;
}
