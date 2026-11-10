// Interval poller around syncDisputes. One per process, even across dev hot reloads.

import { getDb } from '@/lib/db';
import { fetchDispute, listDisputes } from './paypal-deps';
import { syncDisputes } from './sync';

const DEFAULT_SECONDS = 20;
const globalForPoller = globalThis as unknown as { verdictPoller?: NodeJS.Timeout; verdictPollRunning?: boolean };

export function startDisputePoller() {
  const db = getDb(); // seeds on first boot
  const seconds = Number(process.env.SYNC_POLL_SECONDS ?? DEFAULT_SECONDS);
  if (!seconds || globalForPoller.verdictPoller || !process.env.PAYPAL_CLIENT_ID) return;

  const tick = async () => {
    if (globalForPoller.verdictPollRunning) return; // a slow sandbox call shouldn't stack runs
    globalForPoller.verdictPollRunning = true;
    try {
      const r = await syncDisputes({ db, listDisputes, fetchDispute });
      if (r.inserted || r.updated || r.failed) console.log(`[sync] listed ${r.listed}, new ${r.inserted}, changed ${r.updated}, failed ${r.failed}`);
    } catch (e) {
      console.log(`[sync] failed: ${(e as Error).message}`);
    } finally {
      globalForPoller.verdictPollRunning = false;
    }
  };
  globalForPoller.verdictPoller = setInterval(tick, seconds * 1000);
  void tick();
  console.log(`[sync] polling PayPal disputes every ${seconds}s`);
}
