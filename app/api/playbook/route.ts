// Save or reset the merchant's Playbook (store policies, dispute rules, guardrail thresholds).

import { getDb } from '@/lib/db';
import { assertHourlyLimit, RateLimitError } from '@/lib/rate-limit';
import { defaultPlaybook, Playbook, savePlaybook } from '@/lib/settings';

export async function PUT(req: Request) {
  const body = await req.json().catch(() => null);
  const parsed = (body?.reset ? { success: true as const, data: defaultPlaybook() } : Playbook.safeParse(body)) as ReturnType<typeof Playbook.safeParse>;
  if (!parsed.success) return Response.json({ error: 'Some fields are missing or too long.' }, { status: 400 });
  const db = getDb();
  try {
    assertHourlyLimit(db, 'playbook.saved', Number(process.env.PLAYBOOK_SAVES_PER_HOUR ?? 30));
  } catch (e) {
    if (e instanceof RateLimitError) return Response.json({ error: e.message }, { status: 429 });
    throw e;
  }
  savePlaybook(db, parsed.data, 'owner (web)');
  return Response.json({ ok: true, playbook: parsed.data });
}
