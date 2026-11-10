// PayPal webhook receiver. Phase 0 version: verifies the signature with PayPal's
// verify-webhook-signature API and records the redacted event under fixtures/webhooks/ in dev.
// Phase 1 replaces the fixture write with an idempotent upsert into the disputes ledger.

import { mkdir, writeFile } from 'node:fs/promises';
import { redactValue } from '@/lib/paypal-raw';
import { verifyWebhookSignature } from '@/lib/paypal-webhooks';

export async function POST(request: Request) {
  const raw = await request.text();
  let event: { id?: string; event_type?: string; resource?: { dispute_id?: string } };
  try {
    event = JSON.parse(raw);
  } catch {
    return Response.json({ error: 'invalid JSON' }, { status: 400 });
  }

  const verification = await verifyWebhookSignature(request.headers, event);
  console.log(
    `[webhook] ${event.event_type ?? 'unknown'} ${event.id ?? ''} dispute=${event.resource?.dispute_id ?? '-'} verification=${verification}`,
  );

  if (process.env.NODE_ENV !== 'production') {
    await mkdir('fixtures/webhooks', { recursive: true });
    const name = `${event.event_type ?? 'unknown'}-${event.id ?? Date.now()}.json`.replace(/[^\w.-]/g, '_');
    await writeFile(`fixtures/webhooks/${name}`, JSON.stringify({ verification, event: redactValue(event) }, null, 2) + '\n');
  }

  // Reject unverified events. PayPal retries on non-2xx, so a transient verification outage
  // (verification === 'ERROR') gets another chance later.
  if (verification === 'SUCCESS') return Response.json({ ok: true });
  return Response.json({ error: 'signature verification failed' }, { status: verification === 'ERROR' ? 503 : 400 });
}
