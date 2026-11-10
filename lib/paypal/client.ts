// Typed PayPal client for the dispute lifecycle. Every write is gated by allowedActions(), so
// nothing (agent, UI or script) can attempt an action PayPal hasn't offered for the dispute.
//
// - OAuth token cache, refreshed a minute early and once on a 401
// - retries with backoff on 429/5xx/network errors; writes reuse the same PayPal-Request-Id
// - request log entries carry method, path, status, timing and debug id, never bodies or tokens
// - `fetch` is injectable: tests pass recorded fixtures, replay mode passes recorded responses

import { randomUUID } from 'node:crypto';
import { allowedActions, type DisputeAction } from './actions';
import { PayPalDispute } from './dispute-schema';
import { redactValue } from '@/lib/paypal-raw';

export type Money = { currency_code: string; value: string };

export type RequestLogEntry = {
  method: string;
  path: string;
  status: number | 'network-error';
  ms: number;
  attempt: number;
  debugId?: string;
  requestId?: string;
};

export type PayPalClientOptions = {
  clientId: string;
  clientSecret: string;
  baseUrl?: string;
  fetch?: typeof fetch;
  log?: (entry: RequestLogEntry) => void;
  maxAttempts?: number;
  sleep?: (ms: number) => Promise<void>;
};

export class PayPalApiError extends Error {
  constructor(
    readonly status: number,
    readonly method: string,
    readonly path: string,
    readonly body: unknown,
    readonly debugId?: string,
  ) {
    const b = body as { name?: string; message?: string; details?: { issue?: string }[] } | undefined;
    const issues = (b?.details ?? []).map((d) => d.issue).filter(Boolean);
    super(`PayPal ${status} on ${method} ${path}: ${[b?.name, ...issues].filter(Boolean).join(' / ') || 'error'}`);
    this.name = 'PayPalApiError';
  }
  /** PayPal's issue codes, e.g. ['ACTION_NOT_ALLOWED_IN_CURRENT_DISPUTE_STATE']. */
  get issues(): string[] {
    return ((this.body as { details?: { issue?: string }[] })?.details ?? []).map((d) => d.issue ?? '').filter(Boolean);
  }
}

export class ActionNotAllowedError extends Error {
  constructor(
    readonly disputeId: string,
    readonly action: DisputeAction,
    readonly allowed: DisputeAction[],
  ) {
    super(`${action} is not allowed on ${disputeId} now (allowed: ${allowed.join(', ') || 'none'})`);
    this.name = 'ActionNotAllowedError';
  }
}

type RequestOptions = { json?: unknown; form?: FormData; requestId?: string };

export type EvidenceInput = {
  evidence_type: string;
  notes?: string;
  evidence_info?: { tracking_info?: { carrier_name: string; tracking_number: string; carrier_name_other?: string }[]; refund_ids?: string[] };
};
export type FileInput = { name: string; contentType: string; data: Uint8Array };

const RETRYABLE = (status: number) => status === 429 || status >= 500;

export class PayPalClient {
  private token?: { value: string; expiresAt: number };
  private readonly baseUrl: string;
  private readonly fetchImpl: typeof fetch;
  private readonly maxAttempts: number;
  private readonly sleep: (ms: number) => Promise<void>;

  constructor(private readonly opts: PayPalClientOptions) {
    this.baseUrl = opts.baseUrl ?? 'https://api-m.sandbox.paypal.com';
    this.fetchImpl = opts.fetch ?? fetch;
    this.maxAttempts = opts.maxAttempts ?? 4;
    this.sleep = opts.sleep ?? ((ms) => new Promise((r) => setTimeout(r, ms)));
  }

  // --- transport -----------------------------------------------------------------------------

  private async accessToken(force = false): Promise<string> {
    if (!force && this.token && Date.now() < this.token.expiresAt) return this.token.value;
    const res = await this.fetchImpl(`${this.baseUrl}/v1/oauth2/token`, {
      method: 'POST',
      headers: {
        Authorization: `Basic ${Buffer.from(`${this.opts.clientId}:${this.opts.clientSecret}`).toString('base64')}`,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: 'grant_type=client_credentials',
    });
    if (!res.ok) throw new PayPalApiError(res.status, 'POST', '/v1/oauth2/token', redactValue(await safeJson(res)));
    const json = (await res.json()) as { access_token: string; expires_in: number };
    this.token = { value: json.access_token, expiresAt: Date.now() + (json.expires_in - 60) * 1000 };
    return this.token.value;
  }

  async request<T>(method: 'GET' | 'POST' | 'PATCH', path: string, opts: RequestOptions = {}): Promise<T> {
    // One id for every attempt of a write, so a retried POST can't apply twice.
    const requestId = method === 'GET' ? undefined : (opts.requestId ?? randomUUID());
    let refreshed = false;
    for (let attempt = 1; ; attempt++) {
      const started = Date.now();
      const headers: Record<string, string> = { Authorization: `Bearer ${await this.accessToken()}` };
      if (requestId) headers['PayPal-Request-Id'] = requestId;
      let body: BodyInit | undefined;
      if (opts.json !== undefined) {
        headers['Content-Type'] = 'application/json';
        body = JSON.stringify(opts.json);
      } else if (opts.form) {
        body = opts.form; // fetch sets the multipart boundary
      }

      let res: Response;
      try {
        res = await this.fetchImpl(`${this.baseUrl}${path}`, { method, headers, body });
      } catch (e) {
        this.opts.log?.({ method, path, status: 'network-error', ms: Date.now() - started, attempt, requestId });
        if (attempt >= this.maxAttempts) throw e;
        await this.sleep(backoff(attempt));
        continue;
      }
      const debugId = res.headers.get('paypal-debug-id') ?? undefined;
      this.opts.log?.({ method, path, status: res.status, ms: Date.now() - started, attempt, debugId, requestId });

      if (res.ok) return (res.status === 204 ? undefined : await safeJson(res)) as T;
      if (res.status === 401 && !refreshed) {
        refreshed = true;
        await this.accessToken(true);
        continue;
      }
      if (RETRYABLE(res.status) && attempt < this.maxAttempts) {
        await this.sleep(backoff(attempt, res.headers.get('retry-after')));
        continue;
      }
      throw new PayPalApiError(res.status, method, path, redactValue(await safeJson(res)), debugId);
    }
  }

  // --- reads -----------------------------------------------------------------------------------

  async listDisputes(params: { pageSize?: number; page?: number; disputeState?: string } = {}) {
    const q = new URLSearchParams({ page_size: String(params.pageSize ?? 50), page: String(params.page ?? 1) });
    if (params.disputeState) q.set('dispute_state', params.disputeState);
    return this.request<{ items?: { dispute_id: string; update_time: string; status: string; dispute_life_cycle_stage: string }[] }>(
      'GET',
      `/v1/customer/disputes?${q}`,
    );
  }

  async getDispute(id: string): Promise<PayPalDispute> {
    const body = await this.request<unknown>('GET', `/v1/customer/disputes/${encodeURIComponent(id)}`);
    return PayPalDispute.parse(body);
  }

  // --- writes (each requires a fresh dispute so allowedActions can gate it) ---------------------

  private guard(dispute: PayPalDispute, action: DisputeAction) {
    const allowed = allowedActions(dispute);
    if (!allowed.includes(action)) throw new ActionNotAllowedError(dispute.dispute_id, action, allowed);
  }
  private path(dispute: PayPalDispute, action: string) {
    return `/v1/customer/disputes/${encodeURIComponent(dispute.dispute_id)}/${action}`;
  }

  /** Concede: PayPal refunds the buyer and closes the dispute. */
  async acceptClaim(
    dispute: PayPalDispute,
    body: { note: string; accept_claim_type?: string; refund_amount?: Money; accept_claim_reason?: string },
  ) {
    this.guard(dispute, 'accept_claim');
    return this.request<unknown>('POST', this.path(dispute, 'accept-claim'), { json: body });
  }

  /** Offer to settle (inquiry stage); the buyer accepts or declines in PayPal. */
  async makeOffer(dispute: PayPalDispute, body: { note: string; offer_type: string; offer_amount?: Money; return_shipping_address?: unknown }) {
    this.guard(dispute, 'make_offer');
    return this.request<unknown>('POST', this.path(dispute, 'make-offer'), { json: body });
  }

  /** Contest with evidence (multipart: `input` JSON + optional files). */
  async provideEvidence(dispute: PayPalDispute, evidences: EvidenceInput[], files: FileInput[] = []) {
    this.guard(dispute, 'provide_evidence');
    return this.request<unknown>('POST', this.path(dispute, 'provide-evidence'), { form: multipart({ evidences }, files) });
  }

  /** Add information while PayPal reviews a chargeback/arbitration. */
  async provideSupportingInfo(dispute: PayPalDispute, notes: string, files: FileInput[] = []) {
    this.guard(dispute, 'provide_supporting_info');
    return this.request<unknown>('POST', this.path(dispute, 'provide-supporting-info'), { form: multipart({ notes }, files) });
  }

  async sendMessage(dispute: PayPalDispute, message: string) {
    this.guard(dispute, 'send_message');
    return this.request<unknown>('POST', this.path(dispute, 'send-message'), { json: { message } });
  }

  async escalate(dispute: PayPalDispute, note: string) {
    this.guard(dispute, 'escalate');
    return this.request<unknown>('POST', this.path(dispute, 'escalate'), { json: { note } });
  }

  async acknowledgeReturnItem(dispute: PayPalDispute, note: string, acknowledgement_type: string) {
    this.guard(dispute, 'acknowledge_return_item');
    return this.request<unknown>('POST', this.path(dispute, 'acknowledge-return-item'), { json: { note, acknowledgement_type } });
  }

  async appeal(dispute: PayPalDispute, evidences: EvidenceInput[], files: FileInput[] = []) {
    this.guard(dispute, 'appeal');
    return this.request<unknown>('POST', this.path(dispute, 'appeal'), { form: multipart({ evidences }, files) });
  }

  // --- sandbox-only helpers --------------------------------------------------------------------

  /** Sandbox: move an UNDER_REVIEW dispute back to waiting on the seller (or buyer). */
  async requireEvidence(dispute: PayPalDispute, action: 'SELLER_EVIDENCE' | 'BUYER_EVIDENCE') {
    this.assertSandbox();
    this.guard(dispute, 'require_evidence');
    return this.request<unknown>('POST', this.path(dispute, 'require-evidence'), { json: { action } });
  }

  /** Sandbox: settle an UNDER_REVIEW dispute as PayPal's reviewers would. */
  async adjudicate(dispute: PayPalDispute, outcome: 'SELLER_FAVOR' | 'BUYER_FAVOR') {
    this.assertSandbox();
    this.guard(dispute, 'adjudicate');
    return this.request<unknown>('POST', this.path(dispute, 'adjudicate'), { json: { adjudication_outcome: outcome } });
  }

  /**
   * Sandbox dispute creation is not available to this app: PayPal rejects merchant-created disputes
   * (TRANSACTION_NOT_ELIGIBLE) and buyer impersonation needs permissions we don't have. Disputes are
   * filed in the sandbox Resolution Center instead. See docs/api-notes.md.
   */
  async createDispute(): Promise<never> {
    throw new Error('createDispute is unavailable to this app; file disputes in the sandbox Resolution Center (docs/api-notes.md)');
  }

  private assertSandbox() {
    if (!this.baseUrl.includes('sandbox')) throw new Error('sandbox-only method called against live PayPal');
  }
}

function multipart(input: unknown, files: FileInput[]): FormData {
  const form = new FormData();
  form.append('input', new Blob([JSON.stringify(input)], { type: 'application/json' }));
  files.forEach((f, i) => form.append(`file${i + 1}`, new Blob([f.data as BlobPart], { type: f.contentType }), f.name));
  return form;
}

async function safeJson(res: Response): Promise<unknown> {
  const text = await res.text();
  try {
    return text ? JSON.parse(text) : undefined;
  } catch {
    return text.slice(0, 500);
  }
}

function backoff(attempt: number, retryAfter?: string | null): number {
  const s = Number(retryAfter);
  if (retryAfter && Number.isFinite(s)) return Math.min(s * 1000, 10_000);
  return Math.min(250 * 2 ** (attempt - 1), 4000) + Math.floor(Math.random() * 100);
}

let shared: PayPalClient | undefined;

/** Process-wide client from env (merchant sandbox app), logging requests to the console. */
export function paypal(): PayPalClient {
  if (!shared) {
    const clientId = process.env.PAYPAL_CLIENT_ID;
    const clientSecret = process.env.PAYPAL_CLIENT_SECRET;
    if (!clientId || !clientSecret) throw new Error('PAYPAL_CLIENT_ID and PAYPAL_CLIENT_SECRET must be set');
    shared = new PayPalClient({
      clientId,
      clientSecret,
      baseUrl: process.env.PAYPAL_ENV === 'live' ? 'https://api-m.paypal.com' : 'https://api-m.sandbox.paypal.com',
      log: (e) => {
        if (process.env.PAYPAL_LOG !== 'off') console.log(`[paypal] ${e.method} ${e.path} ${e.status} ${e.ms}ms${e.attempt > 1 ? ` attempt ${e.attempt}` : ''}${e.debugId ? ` debug=${e.debugId}` : ''}`);
      },
    });
  }
  return shared;
}
