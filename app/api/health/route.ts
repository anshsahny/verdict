// Health check for Render: the server is up and the database answers.

import { getDb } from '@/lib/db';
import { appMode } from '@/lib/mode';

export const dynamic = 'force-dynamic';

export function GET() {
  try {
    const { n } = getDb().prepare('SELECT COUNT(*) AS n FROM disputes').get() as { n: number };
    return Response.json({ ok: true, mode: appMode(), disputes: n, commit: process.env.RENDER_GIT_COMMIT?.slice(0, 7) ?? null });
  } catch {
    return Response.json({ ok: false }, { status: 503 });
  }
}
