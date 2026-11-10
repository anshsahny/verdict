// Saves the current full PayPal representation of every sandbox dispute, redacted, to
// fixtures/disputes/<dispute_id>.json. These feed the tests and (Phase 6) replay mode.
//   npm run sandbox:capture

import { config } from 'dotenv';
config({ path: '.env.local', quiet: true });

import { mkdirSync, writeFileSync } from 'node:fs';
import { fetchDispute, listDisputes } from '../lib/disputes/paypal-deps';
import { redactValue } from '../lib/paypal-raw';

(async () => {
  mkdirSync('fixtures/disputes', { recursive: true });
  const summaries = await listDisputes();
  for (const s of summaries) {
    const d = await fetchDispute(s.dispute_id);
    if (!d) {
      console.log(`FAIL ${s.dispute_id}`);
      continue;
    }
    writeFileSync(`fixtures/disputes/${d.dispute_id}.json`, JSON.stringify(redactValue(d), null, 2) + '\n');
    console.log(`saved ${d.dispute_id} ${d.reason} ${d.dispute_life_cycle_stage}/${d.status}`);
  }
})().catch((e) => {
  console.error('FAIL', (e as Error).message);
  process.exitCode = 1;
});
