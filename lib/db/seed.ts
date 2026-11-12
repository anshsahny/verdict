// The demo store: "Kiln & Co.", a fictional small pottery and kitchenware shop. Everything here is
// seeded demo data except the VRD-* orders, which are real PayPal sandbox orders (see
// fixtures/sandbox-orders.json) that the human disputed in the sandbox Resolution Center.
//
// Deterministic (fixed PRNG seed, fixed dates, fixed ids) and idempotent (INSERT OR IGNORE), so it
// is safe to run on every boot.

import sandboxOrders from '@/fixtures/sandbox-orders.json';
import type { Db } from './index';

export const MERCHANT_ID = 'kilnco';
const SEED = 20261112;
const SEED_NOW = '2026-11-09T12:00:00.000Z'; // dates are relative to this, not the wall clock
const SANDBOX_TIME_SHIFT_DAYS = 10;

export const MERCHANT_POLICY = {
  shipping: 'Orders ship within 2 business days. Tracked shipping on all orders over $30; signature required over $100.',
  returns: 'Returns accepted within 30 days of delivery for unused items. Buyer pays return shipping unless the item arrived damaged or not as described.',
  damaged: 'Damaged or not-as-described items: full refund or replacement after the buyer sends a photo.',
  lost: 'If tracking shows no movement for 10 days, we reship or refund in full.',
  handmade: 'Pieces are handmade; small variations in glaze and size (up to 5%) are expected and stated on every listing.',
  disputes: [
    'Contest only when our records directly refute the claim (e.g. tracked delivery to the order address before the dispute, a refund already issued, or separate orders behind a "duplicate").',
    'Refund in full when our own records show we are at fault (lost or stalled parcel past 10 days, wrong address, a real duplicate payment) or when we cannot prove delivery.',
    'For not-as-described claims about normal handmade variation on a delivered item that matches its listing, offer a partial refund (about 25-35%) and let the buyer keep the item.',
    'Damaged items: refund in full.',
    'Send to a human when there is no matching order, records conflict, an unauthorized claim lacks a solid account history, or anything looks unusual.',
  ].join(' '),
};

const PRODUCTS = [
  ['p-pourover', 'KC-PO-01', 'Ceramic pour-over set', 'coffee', 4200, 'Stoneware dripper with matching carafe, 600 ml. Matte white glaze.'],
  ['p-apron', 'KC-AP-02', 'Linen apron', 'textiles', 2850, 'Washed linen apron with two front pockets. One size, adjustable neck strap.'],
  ['p-board', 'KC-SB-03', 'Walnut serving board', 'serveware', 6400, 'Solid walnut board, 45 x 20 cm, finished with food-safe oil. Natural grain varies.'],
  ['p-mugs', 'KC-MG-04', 'Stoneware mug pair', 'coffee', 3675, 'Two 350 ml mugs, speckled oatmeal glaze. Dishwasher safe.'],
  ['p-vase', 'KC-VS-05', 'Hand-thrown vase', 'decor', 8900, 'Wheel-thrown vase, approx. 22 cm tall. Each piece is unique.'],
  ['p-towels', 'KC-TT-06', 'Tea towel set', 'textiles', 1925, 'Set of three cotton tea towels, 50 x 70 cm.'],
  ['p-grinder', 'KC-CG-07', 'Coffee grinder', 'coffee', 11800, 'Manual burr grinder with ceramic burrs and walnut handle. 30 g hopper.'],
  ['p-espresso', 'KC-EC-08', 'Espresso cups (4)', 'coffee', 4740, 'Set of four 90 ml espresso cups, glossy black glaze.'],
  ['p-plates', 'KC-DP-09', 'Glazed dinner plates (set of 4)', 'tableware', 9600, 'Four 27 cm dinner plates, celadon glaze. Microwave safe.'],
  ['p-matcha', 'KC-MW-10', 'Matcha whisk set', 'tea', 3400, 'Bamboo whisk, scoop and ceramic whisk holder.'],
  ['p-salt', 'KC-SC-11', 'Salt cellar', 'tableware', 2200, 'Lidded stoneware salt cellar with olive-wood spoon.'],
  ['p-trivet', 'KC-TR-12', 'Cast-iron trivet', 'kitchen', 2600, 'Round cast-iron trivet, 18 cm, rubber feet.'],
] as const;

const CUSTOMERS = [
  ['c-avery', 'Jordan Avery', 'Columbus', 'OH', null], // the sandbox buyer: placed the VRD-* orders
  ['c-okafor', 'Chidi Okafor', 'Austin', 'TX', null],
  ['c-lindqvist', 'Maja Lindqvist', 'Portland', 'OR', null],
  ['c-reyes', 'Sofia Reyes', 'Phoenix', 'AZ', 'Asked about glaze variation before ordering.'],
  ['c-tanaka', 'Ken Tanaka', 'Seattle', 'WA', null],
  ['c-osei', 'Ama Osei', 'Atlanta', 'GA', null],
  ['c-murphy', 'Liam Murphy', 'Boston', 'MA', null],
  ['c-nguyen', 'Linh Nguyen', 'San Jose', 'CA', null],
  ['c-schmidt', 'Hannah Schmidt', 'Denver', 'CO', null],
  ['c-patel', 'Ravi Patel', 'Chicago', 'IL', 'Opened a PayPal claim on a previous order with another shop (told support).'],
  ['c-dubois', 'Claire Dubois', 'New Orleans', 'LA', null],
  ['c-kim', 'Ji-woo Kim', 'Brooklyn', 'NY', null],
  ['c-garcia', 'Mateo Garcia', 'Miami', 'FL', null],
  ['c-novak', 'Petra Novak', 'Minneapolis', 'MN', null],
  ['c-hassan', 'Omar Hassan', 'Dearborn', 'MI', null],
  ['c-fischer', 'Lena Fischer', 'Madison', 'WI', null],
  ['c-brown', 'Marcus Brown', 'Charlotte', 'NC', null],
  ['c-silva', 'Beatriz Silva', 'San Diego', 'CA', null],
  ['c-walsh', 'Aoife Walsh', 'Philadelphia', 'PA', null],
  ['c-ito', 'Yuki Ito', 'Honolulu', 'HI', null],
] as const;

// Real sandbox orders: store-side shipment records for each (the store and its records are fictional).
const SANDBOX_SHIPMENTS: Record<string, { product: string; status: string; signedBy?: string; addressMatch?: boolean; days: number }> = {
  'VRD-1001': { product: 'p-pourover', status: 'DELIVERED', signedBy: 'J. AVERY', addressMatch: true, days: 3 },
  'VRD-1002': { product: 'p-apron', status: 'SHIPPED_UNTRACKED', days: 0 },
  'VRD-1003': { product: 'p-board', status: 'DELIVERED', addressMatch: true, days: 3 },
  'VRD-1004': { product: 'p-mugs', status: 'DELIVERED', addressMatch: true, days: 2 },
  'VRD-1005': { product: 'p-vase', status: 'SHIPPED_UNTRACKED', days: 0 },
  'VRD-1006': { product: 'p-towels', status: 'DELIVERED', addressMatch: false, days: 4 },
  'VRD-1007': { product: 'p-grinder', status: 'DELIVERED', signedBy: 'FRONT DESK', addressMatch: true, days: 2 },
  'VRD-1008': { product: 'p-espresso', status: 'SHIPPED_UNTRACKED', days: 0 },
  // The demo video's orders (npm run demo:orders).
  'VRD-1009': { product: 'p-plates', status: 'DELIVERED', addressMatch: true, days: 3 },
  'VRD-1010': { product: 'p-matcha', status: 'DELIVERED', addressMatch: true, days: 2 },
  'VRD-1011': { product: 'p-trivet', status: 'DELIVERED', addressMatch: true, days: 2 },
};

// mulberry32: small deterministic PRNG.
function prng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const DAY = 86_400_000;
const at = (base: string, days: number, hours = 0) => new Date(Date.parse(base) - days * DAY + hours * 3_600_000).toISOString();
const later = (iso: string, days: number, hours = 0) => new Date(Date.parse(iso) + days * DAY + hours * 3_600_000).toISOString();
// Real downtown ZIP codes, so addresses look right to the agent (and to anyone reading a case).
const CITY_ZIP: Record<string, string> = {
  Columbus: '43215', Austin: '78701', Portland: '97205', Phoenix: '85004', Seattle: '98101', Atlanta: '30303',
  Boston: '02108', 'San Jose': '95113', Denver: '80202', Chicago: '60601', 'New Orleans': '70112', Brooklyn: '11201',
  Miami: '33130', Minneapolis: '55401', Dearborn: '48126', Madison: '53703', Charlotte: '28202', 'San Diego': '92101',
  Philadelphia: '19103', Honolulu: '96813', Tucson: '85701',
};
export const postalFor = (city: string) => CITY_ZIP[city] ?? '00000';
/** A different, nearby ZIP in the same city (for wrong-address deliveries). */
export const nearbyPostal = (postal: string) => String(Number(postal) + 18).padStart(5, '0');

type ShipmentRow = {
  id: string;
  order_id: string;
  carrier: string;
  tracking_number: string | null;
  status: string;
  shipped_at: string | null;
  delivered_at: string | null;
  signed_by: string | null;
  delivered_to_json: string | null;
  address_match: number | null;
  events_json: string;
};

function shipment(
  orderId: string,
  shipTo: { city: string; region: string; postal: string },
  createdAt: string,
  spec: { status: string; tracking: string | null; transitDays: number; signedBy?: string | null; addressMatch?: boolean },
): ShipmentRow {
  const shippedAt = later(createdAt, 1, 3);
  const events: { at: string; status: string; location: string }[] = [];
  if (spec.tracking) events.push({ at: shippedAt, status: 'ACCEPTED', location: 'Columbus, OH' });
  let deliveredAt: string | null = null;
  let deliveredTo: { city: string; region: string; postal: string } | null = null;
  if (spec.status === 'IN_TRANSIT' || spec.status === 'LOST' || spec.status === 'DELIVERED') {
    events.push({ at: later(shippedAt, 1), status: 'IN_TRANSIT', location: 'Regional facility' });
  }
  if (spec.status === 'DELIVERED') {
    deliveredAt = later(shippedAt, spec.transitDays, 5);
    deliveredTo = spec.addressMatch === false ? { city: shipTo.city, region: shipTo.region, postal: nearbyPostal(shipTo.postal) } : shipTo;
    events.push({ at: deliveredAt, status: 'DELIVERED', location: `${deliveredTo.city}, ${deliveredTo.region} ${deliveredTo.postal}` });
  }
  return {
    id: `ship-${orderId}`,
    order_id: orderId,
    carrier: spec.tracking ? 'USPS' : 'USPS First-Class (untracked)',
    tracking_number: spec.tracking,
    status: spec.status,
    shipped_at: shippedAt,
    delivered_at: deliveredAt,
    signed_by: spec.signedBy ?? null,
    delivered_to_json: deliveredTo ? JSON.stringify(deliveredTo) : null,
    address_match: spec.status === 'DELIVERED' ? (spec.addressMatch === false ? 0 : 1) : null,
    events_json: JSON.stringify(events),
  };
}

export function seedDemoStore(db: Db) {
  const rand = prng(SEED);
  const pick = <T,>(xs: readonly T[]) => xs[Math.floor(rand() * xs.length)];

  const insertMerchant = db.prepare('INSERT OR IGNORE INTO merchants (id, name, paypal_merchant_id, policy_json, created_at) VALUES (?, ?, ?, ?, ?)');
  const insertProduct = db.prepare('INSERT OR IGNORE INTO products (id, merchant_id, sku, name, category, price_cents, description) VALUES (?, ?, ?, ?, ?, ?, ?)');
  const insertCustomer = db.prepare('INSERT OR IGNORE INTO customers (id, merchant_id, name, email, city, region, first_seen, notes) VALUES (?, ?, ?, ?, ?, ?, ?, ?)');
  const insertOrder = db.prepare(
    `INSERT OR IGNORE INTO orders (id, merchant_id, customer_id, status, currency, total_cents, items_json, ship_to_json, created_at, paypal_order_id, paypal_capture_id, source)
     VALUES (@id, @merchant_id, @customer_id, @status, 'USD', @total_cents, @items_json, @ship_to_json, @created_at, @paypal_order_id, @paypal_capture_id, @source)`,
  );
  const insertShipment = db.prepare(
    `INSERT OR IGNORE INTO shipments (id, order_id, carrier, tracking_number, status, shipped_at, delivered_at, signed_by, delivered_to_json, address_match, events_json)
     VALUES (@id, @order_id, @carrier, @tracking_number, @status, @shipped_at, @delivered_at, @signed_by, @delivered_to_json, @address_match, @events_json)`,
  );

  const products = new Map<string, { id: string; sku: string; name: string; price: number }>(
    PRODUCTS.map(([id, sku, name, , price]) => [id, { id, sku, name, price }]),
  );

  db.transaction(() => {
    insertMerchant.run(MERCHANT_ID, 'Kiln & Co.', 'KNT7TPTCVPK3N', JSON.stringify(MERCHANT_POLICY), at(SEED_NOW, 400));
    for (const [id, sku, name, category, price, description] of PRODUCTS) insertProduct.run(id, MERCHANT_ID, sku, name, category, price, description);
    CUSTOMERS.forEach(([id, name, city, region, notes], i) => {
      const email = `${name.toLowerCase().replace(/[^a-z]+/g, '.')}@example.com`;
      insertCustomer.run(id, MERCHANT_ID, name, email, city, region, at(SEED_NOW, 200 - i * 7), notes);
    });
    const shipToOf = (customerId: string) => {
      const c = CUSTOMERS.find(([id]) => id === customerId)!;
      return { city: c[2], region: c[3], postal: postalFor(c[2]) };
    };

    // 40 seeded orders over the ~7 weeks before SEED_NOW. Some customers repeat.
    for (let n = 0; n < 40; n++) {
      const id = `KC-${1001 + n}`;
      const customerId = n < 4 ? 'c-avery' : pick(CUSTOMERS)[0]; // the sandbox buyer is a repeat customer
      const lines = 1 + Math.floor(rand() * 2);
      const items = Array.from({ length: lines }, () => {
        const [pid] = pick(PRODUCTS);
        const p = products.get(pid)!;
        return { productId: p.id, sku: p.sku, name: p.name, qty: 1 + Math.floor(rand() * 2), unitCents: p.price };
      });
      const total = items.reduce((s, it) => s + it.qty * it.unitCents, 0);
      const createdAt = at(SEED_NOW, 50 - n * 1.2, Math.floor(rand() * 10));
      const roll = rand();
      const status = n >= 37 ? 'IN_TRANSIT' : roll < 0.06 ? 'LOST' : roll < 0.12 ? 'DELIVERED_WRONG' : roll < 0.2 ? 'SHIPPED_UNTRACKED' : 'DELIVERED';
      const shipTo = shipToOf(customerId);
      insertOrder.run({
        id,
        merchant_id: MERCHANT_ID,
        customer_id: customerId,
        status: status === 'IN_TRANSIT' || status === 'SHIPPED_UNTRACKED' || status === 'LOST' ? 'SHIPPED' : 'DELIVERED',
        total_cents: total,
        items_json: JSON.stringify(items),
        ship_to_json: JSON.stringify(shipTo),
        created_at: createdAt,
        paypal_order_id: null,
        paypal_capture_id: null,
        source: 'seed',
      });
      const tracking = status === 'SHIPPED_UNTRACKED' ? null : `94001118995600${String(200000 + n).padStart(8, '0')}`;
      insertShipment.run(
        shipment(id, shipTo, createdAt, {
          status: status === 'DELIVERED_WRONG' ? 'DELIVERED' : status,
          tracking,
          transitDays: 2 + Math.floor(rand() * 3),
          signedBy: total > 10000 && status === 'DELIVERED' ? 'RESIDENT' : null,
          addressMatch: status !== 'DELIVERED_WRONG',
        }),
      );
    }

    // The real sandbox orders. They were captured minutes before the buyer disputed them and the
    // sandbox can't backdate orders, so their store-side timeline is shifted back
    // SANDBOX_TIME_SHIFT_DAYS so that shipping and delivery precede the dispute (disclosed in the README).
    for (const o of sandboxOrders) {
      const spec = SANDBOX_SHIPMENTS[o.ref];
      if (!spec) continue;
      const p = products.get(spec.product)!;
      const createdAt = at(o.createdAt, SANDBOX_TIME_SHIFT_DAYS);
      const shipTo = shipToOf('c-avery');
      insertOrder.run({
        id: o.ref,
        merchant_id: MERCHANT_ID,
        customer_id: 'c-avery',
        status: spec.status === 'DELIVERED' ? 'DELIVERED' : 'SHIPPED',
        total_cents: Math.round(Number(o.amount) * 100),
        items_json: JSON.stringify([{ productId: p.id, sku: p.sku, name: p.name, qty: 1, unitCents: p.price }]),
        ship_to_json: JSON.stringify(shipTo),
        created_at: createdAt,
        paypal_order_id: o.orderId,
        paypal_capture_id: o.captureId,
        source: 'sandbox',
      });
      insertShipment.run(
        shipment(o.ref, shipTo, createdAt, {
          status: spec.status,
          tracking: o.tracking,
          transitDays: spec.days,
          signedBy: spec.signedBy ?? null,
          addressMatch: spec.addressMatch,
        }),
      );
    }
  })();
}
