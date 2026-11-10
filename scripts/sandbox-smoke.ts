// Phase 0 smoke test: prove the PayPal sandbox integrations Verdict depends on, printing PASS/FAIL
// per step and saving redacted responses to fixtures/smoke/.
//
//   npm run sandbox:smoke                 run every step
//   npm run sandbox:smoke -- --approve    start the one-time buyer approval (vaults the sandbox buyer)
//
// Local state (vault id, buyer email, approval order) lives in .smoke-state.json, which is git-ignored.

import { config } from 'dotenv';
config({ path: '.env.local', quiet: true });

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { authAssertion, buyerCreds, call, merchantCreds, redactValue, token, type RawResponse } from '../lib/paypal-raw';

type State = { approvalOrderId?: string; vaultId?: string; buyerEmail?: string; buyerPayerId?: string };
type Link = { href: string; rel: string; method?: string };
type Capture = { id: string; status: string; amount: { value: string; currency_code: string } };
type Order = {
  id: string;
  status: string;
  links?: Link[];
  payer?: { email_address?: string; payer_id?: string };
  payment_source?: { paypal?: { email_address?: string; account_id?: string; attributes?: { vault?: { id?: string; status?: string } } } };
  purchase_units?: { payments?: { captures?: Capture[] } }[];
};
type Dispute = {
  dispute_id: string;
  status: string;
  dispute_life_cycle_stage?: string;
  reason?: string;
  links?: Link[];
};

const STATE_FILE = '.smoke-state.json';
const FIXTURES = 'fixtures/smoke';
const results: { step: string; result: 'PASS' | 'FAIL' | 'SKIP' | 'PENDING'; note: string }[] = [];

const state: State = existsSync(STATE_FILE) ? JSON.parse(readFileSync(STATE_FILE, 'utf8')) : {};
const saveState = () => writeFileSync(STATE_FILE, JSON.stringify(state, null, 2));

function record(step: string, result: (typeof results)[number]['result'], note: string) {
  results.push({ step, result, note });
  console.log(`${result.padEnd(7)} ${step}  ${note}`);
}

function fixture(name: string, res: RawResponse) {
  mkdirSync(FIXTURES, { recursive: true });
  const safe = { status: res.status, debugId: res.debugId, body: redactValue(res.body) };
  writeFileSync(`${FIXTURES}/${name}.json`, JSON.stringify(safe, null, 2) + '\n');
}

const issue = (res: RawResponse) => {
  const b = res.body as { name?: string; details?: { issue?: string }[] } | string;
  if (typeof b !== 'object' || !b) return String(b).slice(0, 120);
  return [b.name, ...(b.details ?? []).map((d) => d.issue)].filter(Boolean).join(' / ');
};

const firstCapture = (o: Order) => o.purchase_units?.[0]?.payments?.captures?.[0];
const hasLink = (d: Dispute, rel: string) => d.links?.some((l) => l.rel === rel) ?? false;

const merchant = merchantCreds();
const run = Date.now().toString(36);

// --- a. OAuth ---------------------------------------------------------------------------------

async function stepOAuth() {
  try {
    const t = await token(merchant);
    const scopes = t.scope.split(' ');
    const want = ['disputes/read-seller', 'disputes/update-seller', 'disputes/create', 'shipping/trackers/readwrite', 'applications/webhooks'];
    const missing = want.filter((w) => !scopes.some((s) => s.endsWith(w)));
    record('a1 merchant OAuth', 'PASS', missing.length ? `missing scopes: ${missing.join(', ')}` : `scopes ok (${want.length} checked)`);
  } catch (e) {
    record('a1 merchant OAuth', 'FAIL', (e as Error).message);
    throw e;
  }
  const buyer = buyerCreds();
  if (!buyer) {
    record('a2 buyer OAuth', 'SKIP', 'no buyer app creds; buyer acts via PayPal-Auth-Assertion instead');
  } else {
    try {
      await token(buyer);
      record('a2 buyer OAuth', 'PASS', 'buyer app token ok');
    } catch (e) {
      record('a2 buyer OAuth', 'FAIL', (e as Error).message);
    }
  }
}

// --- b. Orders --------------------------------------------------------------------------------

// Guest card order: completes and captures on create, no buyer interaction.
async function stepCardOrder(): Promise<{ orderId: string; capture: Capture } | undefined> {
  const res = await call<Order>(merchant, '/v2/checkout/orders', {
    json: {
      intent: 'CAPTURE',
      purchase_units: [{ reference_id: `smoke-card-${run}`, amount: { currency_code: 'USD', value: '24.00' } }],
      payment_source: {
        card: {
          number: '4111111111111111',
          expiry: '2030-12',
          security_code: '123',
          name: 'Sandbox Tester',
          billing_address: { address_line_1: '1 Main St', admin_area_2: 'San Jose', admin_area_1: 'CA', postal_code: '95131', country_code: 'US' },
        },
      },
    },
    headers: { Prefer: 'return=representation' },
  });
  fixture('orders-create-card', res);
  const capture = res.ok ? firstCapture(res.body) : undefined;
  if (capture?.status === 'COMPLETED') {
    record('b1 card order + capture', 'PASS', `order ${res.body.id} status ${res.body.status}, capture ${capture.id}`);
    return { orderId: res.body.id, capture };
  }
  record('b1 card order + capture', 'FAIL', `${res.status} ${issue(res)}`);
}

async function createVaultApprovalOrder() {
  const base = process.env.APP_BASE_URL ?? 'http://localhost:3000';
  const res = await call<Order>(merchant, '/v2/checkout/orders', {
    json: {
      intent: 'CAPTURE',
      purchase_units: [{ reference_id: `smoke-vault-${run}`, amount: { currency_code: 'USD', value: '12.00' } }],
      payment_source: {
        paypal: {
          attributes: { vault: { store_in_vault: 'ON_SUCCESS', usage_type: 'MERCHANT', customer_type: 'CONSUMER' } },
          experience_context: {
            return_url: `${base}/smoke/approved`,
            cancel_url: `${base}/smoke/cancelled`,
            user_action: 'PAY_NOW',
            shipping_preference: 'NO_SHIPPING',
          },
        },
      },
    },
  });
  fixture('orders-create-vault-approval', res);
  const approve = res.body.links?.find((l) => l.rel === 'payer-action')?.href;
  if (!res.ok || !approve) {
    record('b2 buyer-account order', 'FAIL', `could not create approval order: ${res.status} ${issue(res)}`);
    return;
  }
  state.approvalOrderId = res.body.id;
  saveState();
  record('b2 buyer-account order', 'PENDING', 'needs one human approval (see below)');
  console.log(`\n  Log in as the sandbox PERSONAL account and approve:\n  ${approve}\n  Then run: npm run sandbox:smoke\n`);
}

// Buyer-account (PayPal wallet) order. First time: capture the order the human approved, which
// vaults the buyer. After that: merchant-initiated orders against the vault, no interaction.
async function stepWalletOrder(): Promise<{ orderId: string; capture: Capture } | undefined> {
  if (!state.vaultId && state.approvalOrderId) {
    const res = await call<Order>(merchant, `/v2/checkout/orders/${state.approvalOrderId}/capture`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Prefer: 'return=representation' },
    });
    fixture('orders-capture-vault-approval', res);
    const capture = res.ok ? firstCapture(res.body) : undefined;
    if (capture) {
      const pp = res.body.payment_source?.paypal;
      state.vaultId = pp?.attributes?.vault?.id;
      state.buyerEmail = pp?.email_address ?? res.body.payer?.email_address;
      state.buyerPayerId = pp?.account_id ?? res.body.payer?.payer_id;
      delete state.approvalOrderId;
      saveState();
      record('b2 buyer-account order', 'PASS', `approved order captured (${capture.id}); vault ${state.vaultId ? 'saved' : 'NOT returned'}`);
      return { orderId: res.body.id, capture };
    }
    const notApproved = issue(res).includes('ORDER_NOT_APPROVED');
    record('b2 buyer-account order', notApproved ? 'PENDING' : 'FAIL', notApproved ? 'approval link not used yet' : `${res.status} ${issue(res)}`);
    if (!notApproved) delete state.approvalOrderId, saveState();
    return;
  }
  if (!state.vaultId) {
    await createVaultApprovalOrder();
    return;
  }
  const res = await call<Order>(merchant, '/v2/checkout/orders', {
    json: {
      intent: 'CAPTURE',
      purchase_units: [{ reference_id: `smoke-wallet-${run}`, amount: { currency_code: 'USD', value: '36.00' } }],
      payment_source: { paypal: { vault_id: state.vaultId } },
    },
    headers: { Prefer: 'return=representation' },
  });
  fixture('orders-create-vaulted', res);
  const capture = res.ok ? firstCapture(res.body) : undefined;
  if (capture?.status === 'COMPLETED') {
    record('b2 buyer-account order', 'PASS', `vaulted order ${res.body.id} captured ${capture.id}, no interaction`);
    return { orderId: res.body.id, capture };
  }
  record('b2 buyer-account order', 'FAIL', `vaulted order: ${res.status} ${issue(res)} (status ${res.body?.status})`);
}

// --- c. Tracking ------------------------------------------------------------------------------

async function stepTracking(order: { orderId: string; capture: Capture }) {
  const res = await call(merchant, `/v2/checkout/orders/${order.orderId}/track`, {
    json: { capture_id: order.capture.id, tracking_number: `9400111899${Date.now().toString().slice(-12)}`, carrier: 'USPS', notify_payer: false },
  });
  fixture('orders-track', res);
  record('c  add tracking', res.ok ? 'PASS' : 'FAIL', res.ok ? `${res.status} tracker added to ${order.capture.id}` : `${res.status} ${issue(res)}`);
}

// --- d. Disputes ------------------------------------------------------------------------------

function disputeForm(transactionId: string, value: string) {
  const form = new FormData();
  const input = {
    disputed_transactions: [{ buyer_transaction_id: transactionId }],
    reason: 'MERCHANDISE_OR_SERVICE_NOT_RECEIVED',
    dispute_amount: { currency_code: 'USD', value },
    extensions: { merchant_contacted: false },
  };
  form.append('input', new Blob([JSON.stringify(input)], { type: 'application/json' }));
  return form;
}

async function stepCreateDispute(card?: { capture: Capture }, wallet?: { capture: Capture }) {
  const attempts: { label: string; capture: Capture; headers: Record<string, string> }[] = [];
  if (wallet && state.buyerEmail) {
    attempts.push({ label: 'wallet+assertion', capture: wallet.capture, headers: { 'PayPal-Auth-Assertion': authAssertion(merchant.id, { email: state.buyerEmail }) } });
  }
  if (card) attempts.push({ label: 'card', capture: card.capture, headers: {} });
  if (!attempts.length) {
    record('d1 create dispute (API)', 'SKIP', 'no captured transaction to dispute');
    return;
  }
  const notes: string[] = [];
  for (const a of attempts) {
    const res = await call(merchant, '/v1/customer/disputes', { form: disputeForm(a.capture.id, a.capture.amount.value), headers: a.headers });
    fixture(`disputes-create-${a.label.replace('+', '-')}`, res);
    if (res.ok) {
      record('d1 create dispute (API)', 'PASS', `${a.label}: ${res.status}`);
      return;
    }
    notes.push(`${a.label}: ${res.status} ${issue(res)}`);
  }
  record('d1 create dispute (API)', 'FAIL', `${notes.join('; ')} -> fallback: Resolution Center`);
}

async function stepListAndGet(): Promise<Dispute | undefined> {
  const list = await call<{ items?: Dispute[] }>(merchant, '/v1/customer/disputes?page_size=50');
  fixture('disputes-list', list);
  if (!list.ok) {
    record('d2 list disputes', 'FAIL', `${list.status} ${issue(list)}`);
    return;
  }
  const items = list.body.items ?? [];
  record('d2 list disputes', 'PASS', `${items.length} dispute(s) visible to merchant`);
  if (!items.length) {
    record('d3 get dispute', 'SKIP', 'no disputes yet');
    return;
  }
  const res = await call<Dispute>(merchant, `/v1/customer/disputes/${items[0].dispute_id}`);
  fixture('disputes-get', res);
  if (!res.ok) {
    record('d3 get dispute', 'FAIL', `${res.status} ${issue(res)}`);
    return;
  }
  const d = res.body;
  const rels = (d.links ?? []).map((l) => l.rel).filter((r) => r !== 'self');
  record('d3 get dispute', 'PASS', `${d.dispute_id} ${d.reason} ${d.dispute_life_cycle_stage}/${d.status} links=[${rels.join(',')}]`);
  return d;
}

// --- e. Sandbox lifecycle helpers ---------------------------------------------------------------

// Walks the newest dispute forward using whatever HATEOAS links it offers:
// provide-evidence (when waiting for us) -> require-evidence -> adjudicate (when under review).
async function stepLifecycle(start?: Dispute) {
  if (!start) {
    record('e  evidence + adjudicate', 'SKIP', 'no dispute to walk');
    return;
  }
  let d = start;
  const trail: string[] = [`${d.dispute_life_cycle_stage}/${d.status}`];
  for (let i = 0; i < 4 && d.status !== 'RESOLVED'; i++) {
    let res: RawResponse;
    let action: string;
    if (hasLink(d, 'provide_evidence') || hasLink(d, 'provide-evidence')) {
      action = 'provide-evidence';
      const form = new FormData();
      const input = {
        evidences: [
          {
            evidence_type: 'PROOF_OF_FULFILLMENT',
            evidence_info: { tracking_info: [{ carrier_name: 'USPS', tracking_number: '9400111899223334445566' }] },
            notes: 'Verdict smoke test: shipped with tracking; delivered per carrier record.',
          },
        ],
      };
      form.append('input', new Blob([JSON.stringify(input)], { type: 'application/json' }));
      res = await call(merchant, `/v1/customer/disputes/${d.dispute_id}/provide-evidence`, { form });
    } else if (d.status === 'UNDER_REVIEW' && hasLink(d, 'adjudicate')) {
      action = 'adjudicate';
      res = await call(merchant, `/v1/customer/disputes/${d.dispute_id}/adjudicate`, { json: { adjudication_outcome: 'SELLER_FAVOR' } });
    } else if (hasLink(d, 'require_evidence') || hasLink(d, 'require-evidence')) {
      action = 'require-evidence';
      res = await call(merchant, `/v1/customer/disputes/${d.dispute_id}/require-evidence`, { json: { action: 'SELLER_EVIDENCE' } });
    } else if (hasLink(d, 'escalate')) {
      action = 'escalate';
      res = await call(merchant, `/v1/customer/disputes/${d.dispute_id}/escalate`, { json: { note: 'Verdict smoke test: escalating to claim.' } });
    } else {
      trail.push('no actionable link');
      break;
    }
    fixture(`disputes-${action}`, res);
    trail.push(`${action}:${res.status}${res.ok ? '' : ` ${issue(res)}`}`);
    if (!res.ok) break;
    const next = await call<Dispute>(merchant, `/v1/customer/disputes/${d.dispute_id}`);
    if (!next.ok) break;
    d = next.body;
    trail.push(`${d.dispute_life_cycle_stage}/${d.status}`);
  }
  const ok = trail.some((t) => /^(provide-evidence|require-evidence|adjudicate|escalate):2/.test(t));
  record('e  evidence + adjudicate', ok ? 'PASS' : 'FAIL', trail.join(' -> '));
}

// --- main -------------------------------------------------------------------------------------

(async () => {
  if (process.argv.includes('--approve')) {
    delete state.approvalOrderId;
    await createVaultApprovalOrder();
    return;
  }
  await stepOAuth();
  const card = await stepCardOrder();
  const wallet = await stepWalletOrder();
  const tracked = wallet ?? card;
  if (tracked) await stepTracking(tracked);
  else record('c  add tracking', 'SKIP', 'no capture');
  await stepCreateDispute(card, wallet);
  const dispute = await stepListAndGet();
  await stepLifecycle(dispute);

  console.log('\nStep                          Result');
  for (const r of results) console.log(`${r.step.padEnd(30)}${r.result}`);
  const needed = ['a1', 'b1', 'd2'];
  const failed = results.filter((r) => needed.some((n) => r.step.startsWith(n)) && r.result === 'FAIL');
  process.exitCode = failed.length ? 1 : 0;
})().catch((e) => {
  console.error('FAIL   smoke aborted:', (e as Error).message);
  process.exitCode = 1;
});
