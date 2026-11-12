// Filming helper: sync one PayPal dispute into the store through the normal sync path, for when the
// poller is off (SYNC_POLL_SECONDS=0) so a dispute's arrival can be shown on cue.
//
//   npm run sync:one -- <disputeId>

import { config } from 'dotenv';
config({ path: '.env.local', quiet: true });

import { getDb } from '../lib/db';
import { fetchDispute, listDisputes } from '../lib/disputes/paypal-deps';
import { syncDisputes } from '../lib/disputes/sync';

const id = process.argv[2];
if (!id) throw new Error('usage: npm run sync:one -- <disputeId>');

syncDisputes({ db: getDb(), fetchDispute, listDisputes: async () => (await listDisputes()).filter((s) => s.dispute_id === id) })
  .then((r) => console.log(r.inserted ? `${id} arrived` : `${id}: listed ${r.listed}, new ${r.inserted}, changed ${r.updated}`))
  .catch((e) => {
    console.error('FAIL', (e as Error).message);
    process.exitCode = 1;
  });
