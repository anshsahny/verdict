// Builds fixtures/replay/seed.json for REPLAY mode: recorded sandbox disputes (as they were before
// we acted on them) plus the agent's recorded recommendations for them, reset to "awaiting approval".
//   npm run replay:export
// Everything is from real sandbox runs; no API keys or personal data (fixtures are redacted).

import { config } from 'dotenv';
config({ path: '.env.local', quiet: true });

import { mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { getDb } from '../lib/db';

const SNAPSHOT = 'fixtures/disputes/snapshots/2026-11-10-before-gate1';

const db = getDb();
const disputes = readdirSync(SNAPSHOT)
  .filter((f) => f.endsWith('.json'))
  .map((f) => JSON.parse(readFileSync(`${SNAPSHOT}/${f}`, 'utf8')));

// The latest recommendation the agent made for each of these disputes, if any.
const decisions = disputes.flatMap((d) => {
  const row = db
    .prepare("SELECT id, dispute_id, action, amount_cents, confidence, payload_json, status, created_at FROM decisions WHERE dispute_id = ? AND status != 'invalid' ORDER BY created_at DESC LIMIT 1")
    .get(d.dispute_id) as Record<string, unknown> | undefined;
  if (!row) return [];
  const payload = JSON.parse(String(row.payload_json));
  const awaiting = payload.validation?.flags?.length ? 'needs_human' : 'proposed';
  return [{ ...row, status: awaiting } as Record<string, unknown>];
});

mkdirSync('fixtures/replay', { recursive: true });
writeFileSync('fixtures/replay/seed.json', JSON.stringify({ source: SNAPSHOT, disputes, decisions }, null, 2) + '\n');
console.log(`fixtures/replay/seed.json: ${disputes.length} disputes, ${decisions.length} recorded recommendations (${decisions.map((d) => `${String(d.dispute_id).slice(5, 8)}:${d.action}`).join(', ')})`);
