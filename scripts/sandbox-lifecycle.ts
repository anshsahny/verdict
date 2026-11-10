// Gate 1 live run: drives real sandbox disputes through the lifecycle with the typed client and
// the evidence packet builder, verifying every state change by re-fetching from PayPal.
// Writes a log to fixtures/runs/gate1.json (redacted) and prints a table.
//
//   npm run sandbox:lifecycle -- --dry-run     show the plan and what each dispute allows
//   npm run sandbox:lifecycle                  execute (each step is one-shot on real disputes)

import { config } from 'dotenv';
config({ path: '.env.local', quiet: true });

import { mkdirSync, writeFileSync } from 'node:fs';
import { audit, getDb } from '../lib/db';
import { getDispute, upsertDispute } from '../lib/disputes/store';
import { buildEvidencePacket, toPayPalEvidences } from '../lib/evidence/packet';
import { allowedActions, requestedEvidence } from '../lib/paypal/actions';
import { paypal, PayPalApiError } from '../lib/paypal/client';
import type { PayPalDispute } from '../lib/paypal/dispute-schema';
import { redactValue } from '../lib/paypal-raw';

type Step = {
  disputeId: string;
  why: string;
  run: (d: PayPalDispute) => Promise<unknown>;
  expect: (d: PayPalDispute) => boolean;
  expectText: string;
};

const db = getDb();
const client = paypal();

const PLAN: Step[] = [
  {
    disputeId: 'PP-R-SUQ-10197882',
    why: 'VRD-1001 INR chargeback; signed, tracked delivery to the right address (packet: strong). Settle as a reviewer would.',
    run: (d) => client.adjudicate(d, 'SELLER_FAVOR'),
    expect: (d) => d.status === 'RESOLVED',
    expectText: 'RESOLVED (seller favour)',
  },
  {
    disputeId: 'PP-R-HRR-10197887',
    why: 'VRD-1006 INR chargeback; delivered to the wrong postal code (packet: weak). Reopen for seller evidence.',
    run: (d) => client.requireEvidence(d, 'SELLER_EVIDENCE'),
    expect: (d) => d.status === 'WAITING_FOR_SELLER_RESPONSE',
    expectText: 'WAITING_FOR_SELLER_RESPONSE',
  },
  {
    disputeId: 'PP-R-HRR-10197887',
    why: 'Submit the evidence packet, disclosing the address mismatch (records that hurt us are included).',
    run: (d) => {
      const packet = buildEvidencePacket(db, getDispute(db, d.dispute_id)!);
      const evidences = toPayPalEvidences(packet.items, { stage: d.dispute_life_cycle_stage, requested: requestedEvidence(d), disclosures: packet.items });
      return client.provideEvidence(d, evidences);
    },
    expect: (d) => d.status === 'UNDER_REVIEW',
    expectText: 'UNDER_REVIEW',
  },
  {
    disputeId: 'PP-R-FGG-10198062',
    why: '$18 payment with no store order (packet: none). Concede with a full refund.',
    run: (d) => client.acceptClaim(d, { note: 'No matching order in our records; refunding in full.', accept_claim_type: 'REFUND' }),
    expect: (d) => d.status === 'RESOLVED',
    expectText: 'RESOLVED (buyer favour, refunded)',
  },
  {
    disputeId: 'PP-R-ERW-10197885',
    why: 'VRD-1004 SNAD inquiry (packet: moderate, no photos). Offer a partial refund.',
    run: (d) =>
      client.makeOffer(d, {
        note: 'Sorry the mugs were not what you expected. Glaze varies on handmade pieces; we can refund $15.00 and you keep the mugs.',
        offer_type: 'REFUND',
        offer_amount: { currency_code: 'USD', value: '15.00' },
      }),
    expect: (d) => d.status !== 'WAITING_FOR_SELLER_RESPONSE',
    expectText: 'no longer waiting on the seller',
  },
];

const waitFor = async (id: string, ok: (d: PayPalDispute) => boolean, tries = 10) => {
  let d = await client.getDispute(id);
  for (let i = 1; i < tries && !ok(d); i++) {
    await new Promise((r) => setTimeout(r, 3000));
    d = await client.getDispute(id);
  }
  return d;
};

(async () => {
  const dry = process.argv.includes('--dry-run');
  const log: unknown[] = [];
  const rows: string[][] = [];
  mkdirSync('fixtures/runs', { recursive: true });

  for (const [n, step] of PLAN.entries()) {
    const before = await client.getDispute(step.disputeId);
    const allowed = allowedActions(before);
    const state = (d: PayPalDispute) => `${d.dispute_life_cycle_stage}/${d.status}`;
    if (dry) {
      rows.push([String(n + 1), step.disputeId, state(before), allowed.join(',')]);
      continue;
    }
    const started = new Date().toISOString();
    let response: unknown;
    let error: string | undefined;
    try {
      response = await step.run(before);
    } catch (e) {
      error = e instanceof PayPalApiError ? `${e.status} ${e.issues.join(',')}` : (e as Error).message;
    }
    const after = error ? before : await waitFor(step.disputeId, step.expect);
    const passed = !error && step.expect(after);
    upsertDispute(db, after, { full: true, source: 'poll' });
    audit(db, 'human', 'gate1.step', step.disputeId, { step: n + 1, why: step.why, error, before: state(before), after: state(after) });
    const outcome = (after as { dispute_outcome?: { outcome_code?: string } }).dispute_outcome?.outcome_code;
    rows.push([String(n + 1), step.disputeId, state(before), error ? `ERROR ${error}` : `${state(after)}${outcome ? ` ${outcome}` : ''}`, passed ? 'PASS' : 'FAIL']);
    log.push({ step: n + 1, disputeId: step.disputeId, why: step.why, started, before: state(before), allowedBefore: allowed, response: redactValue(response), error, after: redactValue(after), expected: step.expectText, passed });
  }

  if (dry) {
    console.log('step  dispute            state now                              allowed now');
    for (const r of rows) console.log(`${r[0].padEnd(6)}${r[1].padEnd(19)}${r[2].padEnd(39)}${r[3]}`);
    return;
  }
  writeFileSync('fixtures/runs/gate1.json', JSON.stringify(log, null, 2) + '\n');
  console.log('step  dispute            before                                 after                                       result');
  for (const r of rows) console.log(`${r[0].padEnd(6)}${r[1].padEnd(19)}${r[2].padEnd(39)}${r[3].padEnd(44)}${r[4]}`);
  process.exitCode = rows.every((r) => r[4] === 'PASS') ? 0 : 1;
})().catch((e) => {
  console.error('FAIL', (e as Error).message);
  process.exitCode = 1;
});
