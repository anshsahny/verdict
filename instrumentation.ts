// Runs once when the Next.js server starts: opens (and seeds) the database, then starts the
// dispute poller, which backs up webhooks. SYNC_POLL_SECONDS=0 turns polling off.

export async function register() {
  if (process.env.NEXT_RUNTIME !== 'nodejs') return;
  const { startDisputePoller } = await import('./lib/disputes/poller');
  startDisputePoller();
}
