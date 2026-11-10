// Creates a batch of real sandbox orders paid by the vaulted sandbox buyer (no interaction), some
// with tracking, so the human can open disputes on them in the sandbox Resolution Center.
// Writes fixtures/sandbox-orders.json (order + capture ids), which Phase 1 imports into the store.
//
//   npm run sandbox:orders            needs a vaulted buyer: run npm run sandbox:smoke first

import { config } from 'dotenv';
config({ path: '.env.local', quiet: true });

import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { call, merchantCreds } from '../lib/paypal-raw';

type Plan = { ref: string; item: string; value: string; tracking?: string; suggestedReason: string };

// Amounts are distinct so each order is easy to spot in the buyer's activity list.
const PLAN: Plan[] = [
  { ref: 'VRD-1001', item: 'Ceramic pour-over set', value: '42.00', tracking: '9400111899560000100101', suggestedReason: 'Item not received' },
  { ref: 'VRD-1002', item: 'Linen apron', value: '28.50', suggestedReason: 'Item not received' },
  { ref: 'VRD-1003', item: 'Walnut serving board', value: '64.00', tracking: '9400111899560000100103', suggestedReason: 'Not as described' },
  { ref: 'VRD-1004', item: 'Stoneware mug pair', value: '36.75', tracking: '9400111899560000100104', suggestedReason: 'Not as described' },
  { ref: 'VRD-1005', item: 'Hand-thrown vase', value: '89.00', suggestedReason: 'Unauthorized' },
  { ref: 'VRD-1006', item: 'Tea towel set', value: '19.25', tracking: '9400111899560000100106', suggestedReason: 'Item not received' },
  { ref: 'VRD-1007', item: 'Coffee grinder', value: '118.00', tracking: '9400111899560000100107', suggestedReason: 'Not as described' },
  { ref: 'VRD-1008', item: 'Espresso cups (4)', value: '47.40', suggestedReason: 'Item not received' },
];

(async () => {
  const state = existsSync('.smoke-state.json') ? JSON.parse(readFileSync('.smoke-state.json', 'utf8')) : {};
  if (!state.vaultId) throw new Error('No vaulted buyer. Run npm run sandbox:smoke and approve the link first.');
  const m = merchantCreds();
  const out = [];
  for (const p of PLAN) {
    const res = await call<any>(m, '/v2/checkout/orders', {
      json: {
        intent: 'CAPTURE',
        purchase_units: [
          {
            reference_id: p.ref,
            invoice_id: `${p.ref}-${Date.now().toString(36)}`,
            description: `${p.ref} ${p.item}`,
            amount: { currency_code: 'USD', value: p.value, breakdown: { item_total: { currency_code: 'USD', value: p.value } } },
            items: [{ name: p.item, quantity: '1', unit_amount: { currency_code: 'USD', value: p.value }, category: 'PHYSICAL_GOODS' }],
          },
        ],
        payment_source: { paypal: { vault_id: state.vaultId } },
      },
      headers: { Prefer: 'return=representation' },
    });
    const capture = res.body?.purchase_units?.[0]?.payments?.captures?.[0];
    if (!res.ok || capture?.status !== 'COMPLETED') {
      console.log(`FAIL ${p.ref} ${res.status} ${JSON.stringify(res.body?.details ?? res.body?.name ?? '')}`);
      continue;
    }
    let tracked = false;
    if (p.tracking) {
      const t = await call(m, `/v2/checkout/orders/${res.body.id}/track`, {
        json: { capture_id: capture.id, tracking_number: p.tracking, carrier: 'USPS', notify_payer: false },
      });
      tracked = t.ok;
    }
    out.push({ ref: p.ref, item: p.item, amount: p.value, orderId: res.body.id, captureId: capture.id, tracking: tracked ? p.tracking : null, suggestedReason: p.suggestedReason, createdAt: new Date().toISOString() });
    console.log(`PASS ${p.ref}  $${p.value.padStart(6)}  ${p.item.padEnd(24)} capture ${capture.id}  ${tracked ? 'tracked' : 'no tracking'}  -> dispute as: ${p.suggestedReason}`);
  }
  writeFileSync('fixtures/sandbox-orders.json', JSON.stringify(out, null, 2) + '\n');
  console.log(`\n${out.length}/${PLAN.length} orders written to fixtures/sandbox-orders.json`);
})().catch((e) => {
  console.error('FAIL', (e as Error).message);
  process.exitCode = 1;
});
