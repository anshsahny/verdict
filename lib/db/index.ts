// The SQLite database: one file per environment, created and seeded on first open, so a fresh
// checkout or a fresh Render disk comes up with the demo store already in place.

import Database from 'better-sqlite3';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { SCHEMA, SCHEMA_VERSION } from './schema';
import { importArenaSampleIfEmpty } from '@/lib/arena/sample';
import { seedDemoStore } from './seed';

export type Db = Database.Database;

const DEFAULT_PATH = 'data/verdict.sqlite';

// Next.js dev reloads modules; keep one connection per process across reloads.
const globalForDb = globalThis as unknown as { verdictDb?: Db };

/** Open (or create) a database at `path`, apply the schema, and seed it if it is empty. */
export function openDb(path: string, { seed = true } = {}): Db {
  if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true });
  const db = new Database(path);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  db.pragma('busy_timeout = 5000');
  migrate(db);
  if (seed) {
    seedDemoStore(db);
    if (path !== ':memory:') importArenaSampleIfEmpty(db); // the precomputed Arena benchmark
  }
  return db;
}

function migrate(db: Db) {
  const current = db.pragma('user_version', { simple: true }) as number;
  if (current === SCHEMA_VERSION) return;
  if (current !== 0) throw new Error(`Database schema ${current} doesn't match this code (${SCHEMA_VERSION}). Run \`npm run seed -- --reset\`.`);
  db.transaction(() => {
    db.exec(SCHEMA);
    db.pragma(`user_version = ${SCHEMA_VERSION}`);
  })();
}

/** The app's shared connection, at DATABASE_PATH (default data/verdict.sqlite). */
export function getDb(): Db {
  if (!globalForDb.verdictDb) globalForDb.verdictDb = openDb(process.env.DATABASE_PATH || DEFAULT_PATH);
  return globalForDb.verdictDb;
}

export const nowIso = () => new Date().toISOString();

export function audit(db: Db, actor: string, kind: string, ref: string | null, data: unknown) {
  db.prepare('INSERT INTO audit_log (at, actor, kind, ref, data_json) VALUES (?, ?, ?, ?, ?)').run(
    nowIso(),
    actor,
    kind,
    ref,
    JSON.stringify(data),
  );
}
