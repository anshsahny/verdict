import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { ActionNotAllowedError, PayPalApiError, PayPalClient, type RequestLogEntry } from './client';
import type { PayPalDispute } from './dispute-schema';

const fixture = (id: string) => JSON.parse(readFileSync(`fixtures/disputes/snapshots/2026-11-10-before-gate1/${id}.json`, 'utf8')) as PayPalDispute;
const INQUIRY = fixture('PP-R-SLD-10197881');
const CHARGEBACK_REVIEW = fixture('PP-R-HRR-10197887');
const SNAD_INQUIRY = fixture('PP-R-GSO-10197884');

type Call = { url: string; method: string; headers: Record<string, string>; body: unknown };

// A scripted fetch: OAuth always succeeds; API calls get the queued responses in order.
function fakePayPal(responses: (Response | Error)[]) {
  const calls: Call[] = [];
  let tokens = 0;
  const fetchImpl = (async (url: string, init: RequestInit = {}) => {
    if (String(url).endsWith('/v1/oauth2/token')) {
      tokens++;
      return Response.json({ access_token: `tok-${tokens}`, expires_in: 3600 });
    }
    const headers = Object.fromEntries(Object.entries((init.headers ?? {}) as Record<string, string>));
    calls.push({ url: String(url), method: init.method ?? 'GET', headers, body: init.body });
    const next = responses.shift();
    if (!next) throw new Error('no scripted response');
    if (next instanceof Error) throw next;
    return next;
  }) as typeof fetch;
  const log: RequestLogEntry[] = [];
  const client = new PayPalClient({ clientId: 'id', clientSecret: 'secret', fetch: fetchImpl, sleep: async () => {}, log: (e) => log.push(e) });
  return { client, calls, log, tokenCount: () => tokens };
}
const ok = (body: unknown = { links: [] }) => Response.json(body, { headers: { 'paypal-debug-id': 'dbg1' } });
const err = (status: number, body: unknown) => Response.json(body, { status, headers: { 'paypal-debug-id': 'dbg2' } });

async function formInput(body: unknown) {
  const form = body as FormData;
  return JSON.parse(await (form.get('input') as Blob).text());
}

describe('PayPalClient reads', () => {
  it('getDispute parses the dispute and sends a bearer token', async () => {
    const { client, calls } = fakePayPal([ok(INQUIRY)]);
    const d = await client.getDispute('PP-R-SLD-10197881');
    expect(d.dispute_id).toBe('PP-R-SLD-10197881');
    expect(calls[0]).toMatchObject({ method: 'GET', url: expect.stringContaining('/v1/customer/disputes/PP-R-SLD-10197881') });
    expect(calls[0].headers.Authorization).toBe('Bearer tok-1');
    expect(calls[0].headers['PayPal-Request-Id']).toBeUndefined();
  });

  it('listDisputes pages with page_size and page', async () => {
    const { client, calls } = fakePayPal([ok({ items: [] })]);
    await client.listDisputes({ page: 2 });
    expect(calls[0].url).toContain('/v1/customer/disputes?page_size=50&page=2');
  });
});

describe('PayPalClient writes', () => {
  it('acceptClaim posts JSON with an idempotency key', async () => {
    const { client, calls } = fakePayPal([ok()]);
    await client.acceptClaim(INQUIRY, { note: 'Refunding in full.', accept_claim_type: 'REFUND' });
    expect(calls[0]).toMatchObject({ method: 'POST', url: expect.stringMatching(/PP-R-SLD-10197881\/accept-claim$/) });
    expect(JSON.parse(calls[0].body as string)).toEqual({ note: 'Refunding in full.', accept_claim_type: 'REFUND' });
    expect(calls[0].headers['PayPal-Request-Id']).toMatch(/^[0-9a-f-]{36}$/);
  });

  it('makeOffer posts the offer', async () => {
    const { client, calls } = fakePayPal([ok()]);
    await client.makeOffer(SNAD_INQUIRY, { note: 'Partial refund.', offer_type: 'REFUND', offer_amount: { currency_code: 'USD', value: '20.00' } });
    expect(calls[0].url).toMatch(/\/make-offer$/);
    expect(JSON.parse(calls[0].body as string).offer_amount).toEqual({ currency_code: 'USD', value: '20.00' });
  });

  it('provideEvidence sends multipart input and files', async () => {
    const { client, calls } = fakePayPal([ok()]);
    const evidences = [{ evidence_type: 'PROOF_OF_FULFILLMENT', notes: 'n', evidence_info: { tracking_info: [{ carrier_name: 'USPS', tracking_number: '1' }] } }];
    await client.provideEvidence(INQUIRY, evidences, [{ name: 'receipt.pdf', contentType: 'application/pdf', data: new Uint8Array([37, 80, 68, 70]) }]);
    expect(calls[0].url).toMatch(/\/provide-evidence$/);
    expect(await formInput(calls[0].body)).toEqual({ evidences });
    expect((calls[0].body as FormData).get('file1')).toBeInstanceOf(Blob);
    expect(calls[0].headers['Content-Type']).toBeUndefined(); // fetch sets the multipart boundary
  });

  it('provideSupportingInfo, requireEvidence and adjudicate hit the right endpoints', async () => {
    const { client, calls } = fakePayPal([ok(), ok(), ok()]);
    await client.provideSupportingInfo(CHARGEBACK_REVIEW, 'More detail.');
    await client.requireEvidence(CHARGEBACK_REVIEW, 'SELLER_EVIDENCE');
    await client.adjudicate(CHARGEBACK_REVIEW, 'SELLER_FAVOR');
    expect(calls.map((c) => c.url.split('/').pop())).toEqual(['provide-supporting-info', 'require-evidence', 'adjudicate']);
    expect(await formInput(calls[0].body)).toEqual({ notes: 'More detail.' });
    expect(JSON.parse(calls[1].body as string)).toEqual({ action: 'SELLER_EVIDENCE' });
    expect(JSON.parse(calls[2].body as string)).toEqual({ adjudication_outcome: 'SELLER_FAVOR' });
  });

  it('sendMessage and escalate (inquiry only)', async () => {
    const { client, calls } = fakePayPal([ok(), ok()]);
    await client.sendMessage(INQUIRY, 'Hi');
    await client.escalate(INQUIRY, 'Escalating');
    expect(calls.map((c) => c.url.split('/').pop())).toEqual(['send-message', 'escalate']);
  });
});

describe('PayPalClient guards', () => {
  it('refuses an action PayPal has not offered, without calling PayPal', async () => {
    const { client, calls } = fakePayPal([]);
    await expect(client.provideEvidence(SNAD_INQUIRY, [])).rejects.toBeInstanceOf(ActionNotAllowedError); // no provide_evidence link
    await expect(client.makeOffer(CHARGEBACK_REVIEW, { note: 'x', offer_type: 'REFUND' })).rejects.toThrow(/make_offer is not allowed/);
    await expect(client.adjudicate(INQUIRY, 'SELLER_FAVOR')).rejects.toThrow(ActionNotAllowedError);
    expect(calls).toHaveLength(0);
  });

  it('refuses sandbox helpers against live PayPal', async () => {
    const client = new PayPalClient({ clientId: 'id', clientSecret: 's', baseUrl: 'https://api-m.paypal.com', fetch: (async () => ok()) as typeof fetch });
    await expect(client.adjudicate(CHARGEBACK_REVIEW, 'SELLER_FAVOR')).rejects.toThrow(/sandbox-only/);
  });

  it('createDispute explains why it is unavailable', async () => {
    const { client } = fakePayPal([]);
    await expect(client.createDispute()).rejects.toThrow(/Resolution Center/);
  });
});

describe('PayPalClient transport', () => {
  it('retries 5xx and 429 with the same PayPal-Request-Id, then succeeds', async () => {
    const { client, calls, log } = fakePayPal([err(503, {}), err(429, {}), ok()]);
    await client.acceptClaim(INQUIRY, { note: 'x' });
    expect(calls).toHaveLength(3);
    expect(new Set(calls.map((c) => c.headers['PayPal-Request-Id'])).size).toBe(1);
    expect(log.map((l) => l.status)).toEqual([503, 429, 200]);
  });

  it('retries network errors', async () => {
    const { client, log } = fakePayPal([new Error('ECONNRESET'), ok(INQUIRY)]);
    await client.getDispute('PP-R-SLD-10197881');
    expect(log.map((l) => l.status)).toEqual(['network-error', 200]);
  });

  it('refreshes the token once on 401', async () => {
    const { client, calls, tokenCount } = fakePayPal([err(401, {}), ok(INQUIRY)]);
    await client.getDispute('PP-R-SLD-10197881');
    expect(tokenCount()).toBe(2);
    expect(calls[1].headers.Authorization).toBe('Bearer tok-2');
  });

  it('does not retry 4xx and surfaces PayPal issue codes (real sandbox error)', async () => {
    const real = JSON.parse(readFileSync('fixtures/smoke/lifecycle/1-adjudicate.json', 'utf8')).body;
    const { client, calls } = fakePayPal([err(400, real)]);
    const e = (await client.adjudicate(CHARGEBACK_REVIEW, 'SELLER_FAVOR').catch((x) => x)) as PayPalApiError;
    expect(e).toBeInstanceOf(PayPalApiError);
    expect(e.issues).toEqual(['ACTION_NOT_ALLOWED_IN_CURRENT_DISPUTE_STATE']);
    expect(e.debugId).toBe('dbg2');
    expect(calls).toHaveLength(1);
  });

  it('gives up after maxAttempts', async () => {
    const { client, calls } = fakePayPal([err(500, {}), err(500, {}), err(500, {}), err(500, {})]);
    await expect(client.getDispute('x')).rejects.toBeInstanceOf(PayPalApiError);
    expect(calls).toHaveLength(4);
  });

  it('never logs tokens or bodies', async () => {
    const { client, log } = fakePayPal([ok(INQUIRY)]);
    await client.getDispute('PP-R-SLD-10197881');
    expect(JSON.stringify(log)).not.toMatch(/tok-|Bearer|secret|evidences/);
  });
});
