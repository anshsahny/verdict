// Arena runs bound to real sandbox disputes (the Phase 4 live check). Three steps:
//   npm run arena:bound -- prepare   real vaulted orders + tracking + store records + buyer-agent claims;
//                                    prints what to file in the sandbox Resolution Center
//   npm run arena:bound -- run       defender responds to each filed dispute; action executed live
//   npm run arena:bound -- settle    sandbox adjudicate per the SIMULATED verdict; checks PayPal's outcome
// State: fixtures/arena/bound.json (no secrets; capture ids and claims only).

import { config } from 'dotenv';
config({ path: '.env.local', quiet: true });

import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { audit, getDb } from '../lib/db';
import { runDefender } from '../lib/agent/defender';
import { materialize } from '../lib/agent/eval/scenarios';
import { executeDecision } from '../lib/agent/executor';
import { arbitrate } from '../lib/arena/arbiter';
import { BuyerAgent } from '../lib/arena/buyer';
import { saveArenaRun, type ArenaRunResult } from '../lib/arena/run';
import { generateScenarios, type ArenaScenario } from '../lib/arena/scenarios';
import { getDispute, upsertDispute } from '../lib/disputes/store';
import { buildEvidencePacket } from '../lib/evidence/packet';
import { allowedActions } from '../lib/paypal/actions';
import { paypal } from '../lib/paypal/client';
import { redactValue } from '../lib/paypal-raw';
import { randomUUID } from 'node:crypto';

const STATE = 'fixtures/arena/bound.json';
type Bound = {
  n: number;
  scenario: ArenaScenario;
  paypalOrderId: string;
  captureId: string;
  storeOrderId: string;
  claim: string;
  filedAtEstimate: string;
  disputeId?: string;
  decisionId?: string;
  action?: string;
  paypalAction?: string | null;
  verdict?: ArenaRunResult['verdict'];
  runId?: string;
  finalOutcome?: string;
};

// Three item-not-received cases the Resolution Center can file: a contest the seller should win,
// a parcel the shop lost, and an ambiguous doorstep delivery. Amounts kept under $100.
const WANT: [string, string][] = [
  ['not_received', 'signed_delivery'],
  ['not_received', 'lost'],
  ['not_received', 'unsigned_delivery'],
];
function pickScenarios(): ArenaScenario[] {
  const pool = generateScenarios(4242, 200);
  return WANT.map(([type, variant]) => pool.find((s) => s.type === type && s.variant === variant && s.spec.amount <= 100)!);
}

const db = getDb();
const client = paypal();
const load = (): Bound[] => (existsSync(STATE) ? JSON.parse(readFileSync(STATE, 'utf8')) : []);
const save = (b: Bound[]) => writeFileSync(STATE, JSON.stringify(b, null, 2) + '\n');

async function prepare() {
  const state = existsSync('.smoke-state.json') ? JSON.parse(readFileSync('.smoke-state.json', 'utf8')) : {};
  if (!state.vaultId) throw new Error('No vaulted sandbox buyer. Approve the link from `npm run sandbox:smoke -- --approve`, then run `npm run sandbox:smoke`.');
  const buyer = new BuyerAgent();
  const out: Bound[] = [];
  const filedAt = new Date(Date.now() + 20 * 60_000).toISOString(); // you file within ~20 minutes
  for (const [i, s] of pickScenarios().entries()) {
    const n = i + 1;
    const ref = `ARN-${n}`;
    const product = db.prepare('SELECT name FROM products WHERE id = ?').get(s.spec.product) as { name: string };
    const order = await client.request<{ id: string; purchase_units: { payments: { captures: { id: string }[] } }[] }>('POST', '/v2/checkout/orders', {
      json: {
        intent: 'CAPTURE',
        purchase_units: [
          {
            reference_id: ref,
            invoice_id: `${ref}-${Date.now().toString(36)}`,
            description: `${ref} ${product.name}`,
            amount: { currency_code: 'USD', value: s.spec.amount.toFixed(2), breakdown: { item_total: { currency_code: 'USD', value: s.spec.amount.toFixed(2) } } },
            items: [{ name: product.name, quantity: '1', unit_amount: { currency_code: 'USD', value: s.spec.amount.toFixed(2) }, category: 'PHYSICAL_GOODS' }],
          },
        ],
        payment_source: { paypal: { vault_id: state.vaultId } },
      },
    });
    const captureId = order.purchase_units[0].payments.captures[0].id;
    // Store records for this scenario, linked to the real capture, timeline relative to the filing time.
    materialize(db, { ...s.spec, buyerMessage: '' }, { tag: String(n), orderPrefix: 'ARN-', prefix: 'ARN', captureId, filedAt, withDispute: false });
    const storeOrderId = `ARN-${n}`;
    const shipment = db.prepare('SELECT tracking_number FROM shipments WHERE order_id = ?').get(storeOrderId) as { tracking_number: string | null } | undefined;
    if (shipment?.tracking_number) {
      await client.request('POST', `/v2/checkout/orders/${order.id}/track`, { json: { capture_id: captureId, tracking_number: shipment.tracking_number, carrier: 'USPS', notify_payer: false } });
    }
    const claim = await buyer.writeClaim(s, { inputTokens: 0, outputTokens: 0 });
    out.push({ n, scenario: s, paypalOrderId: order.id, captureId, storeOrderId, claim, filedAtEstimate: filedAt });
    console.log(`\n${n}. $${s.spec.amount.toFixed(2)} "${ref} ${product.name}" (${s.variant}, ${s.persona} buyer)\n   File: Item not received. Paste this as the claim:\n   ${claim}`);
  }
  save(out);
  audit(db, 'system', 'arena.bound.prepared', null, out.map((b) => ({ n: b.n, scenarioId: b.scenario.id, captureId: b.captureId })));
  console.log(`\nSaved ${STATE}. When all three are filed (PayPal takes ~3 min to publish them), run: npm run arena:bound -- run`);
}

async function run() {
  const bound = load();
  for (const b of bound) {
    if (b.decisionId) continue;
    const row = db.prepare('SELECT id FROM disputes WHERE seller_transaction_id = ?').get(b.captureId) as { id: string } | undefined;
    if (!row) {
      console.log(`${b.n}. no dispute yet for capture ${b.captureId} (filed? PayPal publishes ~3 min after filing)`);
      continue;
    }
    b.disputeId = row.id;
    const def = await runDefender({ db, disputeId: row.id });
    b.decisionId = def.decisionId;
    b.action = def.decision?.action ?? 'invalid';
    const packet = buildEvidencePacket(db, getDispute(db, row.id)!);
    b.verdict = arbitrate(b.scenario, def.status === 'invalid' ? null : def.decision, packet, null);
    // Sandbox: the Arena approves its own recommendations (recorded as such); real disputes wait for a human.
    const exec = def.decision && def.decision.action !== 'escalate_to_human' ? await executeDecision(db, client, def.decisionId, { by: 'arena (sandbox auto-approve)' }) : null;
    b.paypalAction = exec?.paypalAction ?? null;
    const result: ArenaRunResult = {
      runId: randomUUID(),
      scenario: b.scenario,
      mode: 'live',
      claim: b.claim,
      decision: def.decision,
      defenderStatus: def.status,
      defenderErrors: def.validation.errors,
      offerReply: null,
      verdict: b.verdict,
      packet: { strength: packet.strength, rating: packet.rating },
      startedAt: new Date().toISOString(),
      latencyMs: def.latencyMs,
      costUsd: def.usage.costUsd,
      liveDisputeId: row.id,
    };
    saveArenaRun(db, result);
    b.runId = result.runId;
    console.log(`${b.n}. ${row.id}: agent ${b.action} (${def.status}) -> PayPal ${b.paypalAction ?? 'none'} ${exec ? `[${exec.status}${exec.error ? `: ${exec.error}` : ''}] now ${exec.disputeStateAfter ?? '?'}` : ''}; SIMULATED verdict ${b.verdict.outcome}`);
  }
  save(bound);
}

async function settle() {
  const bound = load();
  const rows: string[] = [];
  for (const b of bound) {
    if (!b.disputeId || !b.verdict) continue;
    let d = await client.getDispute(b.disputeId);
    upsertDispute(db, d, { full: true, source: 'poll' });
    if (d.status !== 'RESOLVED' && b.verdict.outcome !== 'ESCALATED' && allowedActions(d).includes('adjudicate')) {
      const outcome = b.verdict.outcome === 'SELLER_WINS' ? 'SELLER_FAVOR' : 'BUYER_FAVOR';
      const res = await client.adjudicate(d, outcome);
      audit(db, 'system', 'arena.bound.adjudicated', b.disputeId, { outcome, verdict: b.verdict.outcome, response: redactValue(res) });
      console.log(`${b.n}. adjudicated ${b.disputeId} ${outcome}`);
      await new Promise((r) => setTimeout(r, 90_000));
      d = await client.getDispute(b.disputeId);
      upsertDispute(db, d, { full: true, source: 'poll' });
    }
    const final = (d as { dispute_outcome?: { outcome_code?: string } }).dispute_outcome?.outcome_code ?? `${d.dispute_life_cycle_stage}/${d.status}`;
    b.finalOutcome = final;
    const expected = b.verdict.outcome === 'SELLER_WINS' ? 'RESOLVED_SELLER_FAVOUR' : b.verdict.outcome === 'ESCALATED' ? '(escalated)' : 'RESOLVED_BUYER_FAVOUR';
    rows.push(`${b.n}  ${b.disputeId}  ${b.scenario.variant.padEnd(18)} agent ${String(b.action).padEnd(17)} PayPal ${String(b.paypalAction).padEnd(24)} SIMULATED ${b.verdict.outcome.padEnd(12)} PayPal now ${final}  ${final === expected ? 'MATCH' : 'pending'}`);
  }
  save(bound);
  console.log(rows.join('\n'));
}

const cmd = process.argv[2];
(cmd === 'prepare' ? prepare() : cmd === 'run' ? run() : cmd === 'settle' ? settle() : Promise.reject(new Error('usage: prepare | run | settle'))).catch((e) => {
  console.error('FAIL', (e as Error).message);
  process.exitCode = 1;
});
