import { describe, expect, it } from 'vitest';
import sandboxOrders from '@/fixtures/sandbox-orders.json';
import { openDb, type Db } from './index';
import { seedDemoStore } from './seed';

const TABLES = ['merchants', 'products', 'customers', 'orders', 'shipments'];
const dump = (db: Db) => Object.fromEntries(TABLES.map((t) => [t, db.prepare(`SELECT * FROM ${t} ORDER BY id`).all()]));

describe('seedDemoStore', () => {
  it('is idempotent: seeding again changes nothing', () => {
    const db = openDb(':memory:');
    const before = dump(db);
    seedDemoStore(db);
    seedDemoStore(db);
    expect(dump(db)).toEqual(before);
  });

  it('is deterministic across fresh databases', () => {
    expect(dump(openDb(':memory:'))).toEqual(dump(openDb(':memory:')));
  });

  it('builds the store the demo needs', () => {
    const db = openDb(':memory:');
    const n = (sql: string) => (db.prepare(sql).get() as { n: number }).n;
    expect(n('SELECT COUNT(*) n FROM products')).toBe(12);
    expect(n("SELECT COUNT(*) n FROM orders WHERE source = 'seed'")).toBe(40);
    expect(n("SELECT COUNT(*) n FROM orders WHERE source = 'sandbox'")).toBe(sandboxOrders.length);
    for (const status of ['DELIVERED', 'IN_TRANSIT', 'LOST', 'SHIPPED_UNTRACKED']) {
      expect(n(`SELECT COUNT(*) n FROM shipments WHERE status = '${status}'`), status).toBeGreaterThan(0);
    }
    expect(n('SELECT COUNT(*) n FROM shipments WHERE address_match = 0'), 'delivered to the wrong address').toBeGreaterThan(0);
    // Repeat customers exist (the customer-history tool needs them).
    expect(n('SELECT COUNT(*) n FROM (SELECT customer_id FROM orders GROUP BY customer_id HAVING COUNT(*) > 1)')).toBeGreaterThan(3);
  });

  it('links every real sandbox order to its PayPal capture, with delivery before the dispute', () => {
    const db = openDb(':memory:');
    for (const o of sandboxOrders) {
      const row = db
        .prepare('SELECT o.id, o.total_cents, s.delivered_at FROM orders o JOIN shipments s ON s.order_id = o.id WHERE o.paypal_capture_id = ?')
        .get(o.captureId) as { id: string; total_cents: number; delivered_at: string | null };
      expect(row.id).toBe(o.ref);
      expect(row.total_cents).toBe(Math.round(Number(o.amount) * 100));
      // Disputes were filed right after the PayPal capture; store delivery must come before that.
      if (row.delivered_at) expect(Date.parse(row.delivered_at)).toBeLessThan(Date.parse(o.createdAt));
    }
  });
});
