// Seeds the demo store (idempotent). The app also does this on first open.
//   npm run seed                 seed DATABASE_PATH (default data/verdict.sqlite)
//   npm run seed -- --reset      delete the database file first

import { config } from 'dotenv';
config({ path: '.env.local', quiet: true });

import { rmSync } from 'node:fs';
import { openDb } from '../lib/db';

const path = process.env.DATABASE_PATH || 'data/verdict.sqlite';
if (process.argv.includes('--reset')) {
  for (const suffix of ['', '-wal', '-shm']) rmSync(path + suffix, { force: true });
}
const db = openDb(path);
const count = (table: string) => (db.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get() as { n: number }).n;
console.log(
  `${path}: ${['merchants', 'products', 'customers', 'orders', 'shipments', 'disputes'].map((t) => `${t} ${count(t)}`).join(', ')}`,
);
db.close();
