// REPLAY only: put the shared demo back to its recorded starting point (the footer's "Reset demo").

import { audit, getDb } from '@/lib/db';
import { appMode } from '@/lib/mode';
import { hourlyLimitHit } from '@/lib/rate-limit';
import { resetReplay } from '@/lib/replay/seed';

export async function POST() {
  if (appMode() !== 'replay') return Response.json({ error: 'The demo can only be reset in REPLAY mode.' }, { status: 404 });
  const db = getDb();
  const limited = hourlyLimitHit(db, 'demo.reset', 30);
  if (limited) return Response.json({ error: limited }, { status: 429 });
  const disputes = resetReplay(db);
  audit(db, 'human', 'demo.reset', null, { disputes });
  return Response.json({ ok: true, disputes });
}
