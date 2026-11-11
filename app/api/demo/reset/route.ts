// REPLAY only: put the shared demo back to its recorded starting point (the footer's "Reset demo").

import { audit, getDb } from '@/lib/db';
import { appMode } from '@/lib/mode';
import { assertHourlyLimit, RateLimitError } from '@/lib/rate-limit';
import { resetReplay } from '@/lib/replay/seed';

export async function POST() {
  if (appMode() !== 'replay') return Response.json({ error: 'The demo can only be reset in REPLAY mode.' }, { status: 404 });
  const db = getDb();
  try {
    assertHourlyLimit(db, 'demo.reset', 30);
  } catch (e) {
    if (e instanceof RateLimitError) return Response.json({ error: e.message }, { status: 429 });
    throw e;
  }
  const disputes = resetReplay(db);
  audit(db, 'human', 'demo.reset', null, { disputes });
  return Response.json({ ok: true, disputes });
}
