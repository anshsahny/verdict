// Runs once when the Next.js server starts: opens (and seeds) the database, then either starts the
// dispute poller (LIVE; backs up webhooks; SYNC_POLL_SECONDS=0 turns it off) or loads the recorded
// sandbox disputes (REPLAY).

export async function register() {
  if (process.env.NEXT_RUNTIME !== 'nodejs') return;
  const { appMode } = await import('./lib/mode');
  if (appMode() === 'replay') {
    // Recorded sandbox data, no live PayPal calls (no poller).
    const [{ getDb }, { importReplayIfEmpty, replayNeedsReset, resetReplay }] = await Promise.all([import('./lib/db'), import('./lib/replay/seed')]);
    const n = importReplayIfEmpty(getDb());
    console.log(`[replay] REPLAY mode${n ? `: loaded ${n} recorded sandbox disputes` : ''}`);
    // The hosted demo is shared: reset it once it has been idle after someone used it, and keep the
    // shifted dates fresh.
    setInterval(() => {
      const db = getDb();
      if (replayNeedsReset(db)) console.log(`[replay] reset: reloaded ${resetReplay(db)} recorded sandbox disputes`);
    }, 5 * 60_000).unref();
    return;
  }
  const { startDisputePoller } = await import('./lib/disputes/poller');
  startDisputePoller();
}
