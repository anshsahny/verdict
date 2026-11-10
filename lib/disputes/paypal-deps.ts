// Live PayPal implementations of the ingest/sync dependencies. Phase 2's typed client replaces
// these calls; replay mode (Phase 6) swaps in recorded responses.

import { call, merchantCreds } from '@/lib/paypal-raw';
import { PayPalDispute } from '@/lib/paypal/dispute-schema';

const PAGE_SIZE = 50;

/** null: PayPal says the dispute isn't ours (404/403). undefined: PayPal unavailable or bad payload. */
export async function fetchDispute(id: string): Promise<PayPalDispute | null | undefined> {
  const res = await call<unknown>(merchantCreds(), `/v1/customer/disputes/${encodeURIComponent(id)}`);
  if (res.status === 404 || res.status === 403) return null;
  if (!res.ok) return undefined;
  const parsed = PayPalDispute.safeParse(res.body);
  return parsed.success ? parsed.data : undefined;
}

type Summary = { dispute_id: string; update_time: string; status: string; dispute_life_cycle_stage: string };

export async function listDisputes(): Promise<Summary[]> {
  const out: Summary[] = [];
  for (let page = 1; page <= 50; page++) {
    const res = await call<{ items?: Summary[] }>(merchantCreds(), `/v1/customer/disputes?page_size=${PAGE_SIZE}&page=${page}`);
    if (!res.ok) throw new Error(`list disputes failed: ${res.status}`);
    const items = res.body.items ?? [];
    out.push(...items);
    if (items.length < PAGE_SIZE) break;
  }
  return out;
}
