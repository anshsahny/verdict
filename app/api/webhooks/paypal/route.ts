// PayPal webhook receiver: signature-verified, idempotent by event id, upserts the disputes ledger.

import { mkdir, writeFile } from 'node:fs/promises';
import { getDb } from '@/lib/db';
import { ingestWebhook } from '@/lib/disputes/ingest';
import { fetchDispute } from '@/lib/disputes/paypal-deps';
import { redactValue } from '@/lib/paypal-raw';
import { verifyWebhookSignature } from '@/lib/paypal-webhooks';

export async function POST(request: Request) {
  const raw = await request.text();
  const result = await ingestWebhook(raw, request.headers, { db: getDb(), verify: verifyWebhookSignature, fetchDispute });
  console.log(`[webhook] ${result.outcome}${'disputeId' in result && result.disputeId ? ` ${result.disputeId}` : ''}${'reason' in result ? ` (${result.reason})` : ''}`);

  // In dev, keep a redacted copy of each accepted event as a fixture for replay mode and tests.
  if (process.env.NODE_ENV !== 'production' && result.outcome !== 'rejected') {
    try {
      const event = JSON.parse(raw) as { id?: string; event_type?: string };
      await mkdir('fixtures/webhooks', { recursive: true });
      const name = `${event.event_type ?? 'unknown'}-${event.id ?? Date.now()}.json`.replace(/[^\w.-]/g, '_');
      await writeFile(`fixtures/webhooks/${name}`, JSON.stringify({ verification: 'SUCCESS', event: redactValue(event) }, null, 2) + '\n');
    } catch {
      /* fixture capture is best-effort */
    }
  }

  if (result.status === 200) return Response.json({ ok: true, outcome: result.outcome });
  return Response.json({ error: result.reason }, { status: result.status });
}
