// Minimal PayPal REST helper for the sandbox scripts and webhook verification, plus the redaction
// used everywhere before logging or saving. The app's dispute client is lib/paypal/client.ts; this
// one stays deliberately thin so the scripts show raw sandbox behaviour. Secrets are never printed.

import { randomUUID } from 'node:crypto';

export const BASE_URL =
  process.env.PAYPAL_ENV === 'live' ? 'https://api-m.paypal.com' : 'https://api-m.sandbox.paypal.com';

type Creds = { id: string; secret: string };

export type RawResponse<T = unknown> = {
  status: number;
  ok: boolean;
  body: T;
  debugId?: string;
  headers: Record<string, string>;
};

const tokens = new Map<string, { value: string; expiresAt: number; scope: string }>();

export async function token(creds: Creds): Promise<{ value: string; scope: string }> {
  const cached = tokens.get(creds.id);
  if (cached && Date.now() < cached.expiresAt) return cached;
  const res = await fetch(`${BASE_URL}/v1/oauth2/token`, {
    method: 'POST',
    headers: {
      Authorization: `Basic ${Buffer.from(`${creds.id}:${creds.secret}`).toString('base64')}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: 'grant_type=client_credentials',
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`OAuth ${res.status}: ${redact(text).slice(0, 300)}`);
  const json = JSON.parse(text) as { access_token: string; expires_in: number; scope: string };
  const entry = { value: json.access_token, expiresAt: Date.now() + (json.expires_in - 60) * 1000, scope: json.scope };
  tokens.set(creds.id, entry);
  return entry;
}

type RequestOptions = {
  method?: string;
  json?: unknown;
  form?: FormData;
  headers?: Record<string, string>;
};

export async function call<T = unknown>(creds: Creds, path: string, opts: RequestOptions = {}): Promise<RawResponse<T>> {
  const { value } = await token(creds);
  const headers: Record<string, string> = { Authorization: `Bearer ${value}`, ...opts.headers };
  let body: BodyInit | undefined;
  if (opts.json !== undefined) {
    headers['Content-Type'] = 'application/json';
    body = JSON.stringify(opts.json);
  } else if (opts.form) {
    body = opts.form;
  }
  const method = opts.method ?? (body ? 'POST' : 'GET');
  if (method !== 'GET' && !headers['PayPal-Request-Id']) headers['PayPal-Request-Id'] = randomUUID();
  const res = await fetch(`${BASE_URL}${path}`, { method, headers, body });
  const text = await res.text();
  let parsed: unknown = text;
  try {
    parsed = text ? JSON.parse(text) : null;
  } catch {
    /* non-JSON body: keep the text */
  }
  return {
    status: res.status,
    ok: res.ok,
    body: parsed as T,
    debugId: res.headers.get('paypal-debug-id') ?? undefined,
    headers: Object.fromEntries(res.headers.entries()),
  };
}

// Unsigned JWT used by PayPal for acting on behalf of another account ("alg": "none").
export function authAssertion(clientId: string, subject: { payer_id?: string; email?: string }): string {
  const b64 = (o: object) => Buffer.from(JSON.stringify(o)).toString('base64url');
  return `${b64({ alg: 'none' })}.${b64({ iss: clientId, ...subject })}.`;
}

// Strip anything that looks like a credential or personal identifier before logging or saving.
const SECRET_KEYS = /^(access_token|refresh_token|nonce|client_secret|authorization|app_id|vault_id)$/i;
const PII_KEYS = /^(email_address|email|phone_number|national_number|given_name|surname|full_name|name_on_card|address_line_1|address_line_2|postal_code|account_id|payer_id)$/i;

export function redactValue(value: unknown, key = ''): unknown {
  if (SECRET_KEYS.test(key)) return '[REDACTED]';
  // A vault entry is a reusable payment token for the buyer: keep only its status.
  if (key === 'vault' && value && typeof value === 'object') {
    return { id: '[REDACTED]', status: (value as { status?: unknown }).status };
  }
  // Dispute payloads carry the buyer's display name as a plain `name` string.
  if ((key === 'buyer' || key === 'payer') && value && typeof value === 'object' && !Array.isArray(value)) {
    const v = value as Record<string, unknown>;
    const out = redactValue({ ...v, name: undefined }) as Record<string, unknown>;
    if (typeof v.name === 'string') out.name = '[REDACTED]';
    else if (v.name !== undefined) out.name = redactValue(v.name, 'name');
    return out;
  }
  if (PII_KEYS.test(key) && typeof value === 'string') return '[REDACTED]';
  if (Array.isArray(value)) return value.map((v) => redactValue(v));
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, redactValue(v, k)]));
  }
  return value;
}

export function redact(text: string): string {
  return text
    .replace(/"access_token"\s*:\s*"[^"]+"/g, '"access_token":"[REDACTED]"')
    .replace(/A21AA[\w-]+/g, '[REDACTED_TOKEN]')
    .replace(/[\w.+-]+@[\w-]+\.[\w.-]+/g, '[REDACTED_EMAIL]');
}

export function merchantCreds(): Creds {
  const id = process.env.PAYPAL_CLIENT_ID;
  const secret = process.env.PAYPAL_CLIENT_SECRET;
  if (!id || !secret) throw new Error('PAYPAL_CLIENT_ID and PAYPAL_CLIENT_SECRET must be set in .env.local');
  return { id, secret };
}

export function buyerCreds(): Creds | undefined {
  const id = process.env.PAYPAL_BUYER_CLIENT_ID;
  const secret = process.env.PAYPAL_BUYER_CLIENT_SECRET;
  return id && secret ? { id, secret } : undefined;
}
