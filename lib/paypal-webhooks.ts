// Webhook signature verification through PayPal's verify-webhook-signature API.
// Server-side only: reads the merchant app credentials from the environment.

import { call, merchantCreds } from '@/lib/paypal-raw';

export type Verification = 'SUCCESS' | 'FAILURE' | 'ERROR';

export async function verifyWebhookSignature(headers: Headers, event: unknown): Promise<Verification> {
  const webhookId = process.env.PAYPAL_WEBHOOK_ID;
  if (!webhookId) return 'FAILURE';
  const body = {
    auth_algo: headers.get('paypal-auth-algo'),
    cert_url: headers.get('paypal-cert-url'),
    transmission_id: headers.get('paypal-transmission-id'),
    transmission_sig: headers.get('paypal-transmission-sig'),
    transmission_time: headers.get('paypal-transmission-time'),
    webhook_id: webhookId,
    webhook_event: event,
  };
  if (!body.transmission_id || !body.transmission_sig) return 'FAILURE';
  // The cert must come from PayPal; don't let a forged header point verification elsewhere.
  if (!body.cert_url || !/^https:\/\/api(-m)?\.(sandbox\.)?paypal\.com\//.test(body.cert_url)) return 'FAILURE';
  try {
    const res = await call<{ verification_status?: string }>(merchantCreds(), '/v1/notifications/verify-webhook-signature', { json: body });
    if (!res.ok) return 'ERROR';
    return res.body.verification_status === 'SUCCESS' ? 'SUCCESS' : 'FAILURE';
  } catch {
    return 'ERROR';
  }
}

