// Arena scenario generator: deterministic from a seed. Each scenario is a store situation (orders,
// shipment, history) in the eval's Scenario shape, a buyer persona, the facts as the buyer knows
// them, and a hidden ground truth: who is actually at fault. The defender never sees the truth;
// the SIMULATED arbiter and the benchmark do.

import type { Scenario } from '@/lib/agent/eval/scenarios';
import type { AgentAction } from '@/lib/agent/schema';

export const PERSONAS = ['honest', 'mistaken', 'opportunistic', 'aggressive'] as const;
export type Persona = (typeof PERSONAS)[number];
export type GroundTruth = 'merchant_at_fault' | 'buyer_at_fault' | 'ambiguous';
export type ArenaType = Scenario['type'];

export type ArenaScenario = {
  id: string; // `${seed}-${index}`
  seed: number;
  index: number;
  type: ArenaType;
  variant: string;
  persona: Persona;
  truth: GroundTruth;
  complaint?: 'variation' | 'damaged' | 'wrong_item'; // not-as-described only
  buyerFacts: string; // what the buyer knows; the buyer agent writes the claim from this
  spec: Scenario; // store records + dispute shape (buyerMessage filled in by the buyer agent)
  rightActions: AgentAction[]; // responses that serve the merchant given the truth
};

type VariantDef = {
  variant: string;
  truth: GroundTruth;
  complaint?: ArenaScenario['complaint'];
  facts: string;
  rightActions: AgentAction[];
  build: (base: BaseSpec) => Partial<Scenario>;
};
type BaseSpec = { amount: number; product: string; qty: number; customer: string };

const D = (deliveredDays: number, signedBy: string | undefined, addressMatch = true) =>
  ({ status: 'DELIVERED', tracked: true, deliveredDays, signedBy, addressMatch }) as const;

const VARIANTS: Record<ArenaType, VariantDef[]> = {
  not_received: [
    { variant: 'signed_delivery', truth: 'buyer_at_fault', facts: 'The parcel was delivered and signed for at your address five days ago (someone in your household may have taken it in).', rightActions: ['contest'], build: () => ({ shipment: D(5, 'RESIDENT'), priorOrders: 1 }) },
    { variant: 'unsigned_delivery', truth: 'ambiguous', facts: 'Tracking says it was left at your door five days ago, but you did not find it.', rightActions: ['contest', 'escalate_to_human', 'offer_refund'], build: () => ({ shipment: D(5, undefined) }) },
    { variant: 'wrong_address', truth: 'merchant_at_fault', facts: 'The parcel never reached you. You later learn it was delivered to a different postal code.', rightActions: ['accept'], build: () => ({ shipment: D(4, undefined, false) }) },
    { variant: 'lost', truth: 'merchant_at_fault', facts: 'Tracking has not moved in two weeks; the parcel is lost.', rightActions: ['accept'], build: () => ({ shipment: { status: 'LOST', tracked: true, lastScanDays: 14 } }) },
    { variant: 'untracked', truth: 'merchant_at_fault', facts: 'Nothing arrived and there is no tracking number.', rightActions: ['accept'], build: () => ({ shipment: { status: 'SHIPPED_UNTRACKED' } }) },
  ],
  not_as_described: [
    { variant: 'variation', truth: 'buyer_at_fault', complaint: 'variation', facts: 'The item arrived intact. Its glaze/grain looks different from the photos, which is normal for handmade pieces (the listing says so).', rightActions: ['offer_refund', 'contest'], build: () => ({ shipment: D(6, undefined), priorOrders: 1 }) },
    { variant: 'damaged', truth: 'merchant_at_fault', complaint: 'damaged', facts: 'The item arrived broken; you have a photo of the damage.', rightActions: ['accept'], build: () => ({ shipment: D(3, undefined) }) },
    { variant: 'wrong_item', truth: 'merchant_at_fault', complaint: 'wrong_item', facts: 'You received a different product from the one you ordered.', rightActions: ['accept', 'escalate_to_human'], build: () => ({ shipment: D(3, undefined), order: { note: 'Warehouse flagged a possible SKU swap on this shipment.' } }) },
  ],
  unauthorized: [
    { variant: 'loyal_customer', truth: 'buyer_at_fault', facts: 'You placed this order yourself, like your five earlier orders, and it was delivered to your home.', rightActions: ['contest'], build: () => ({ shipment: D(6, 'RESIDENT'), priorOrders: 5 }) },
    { variant: 'new_account_mismatch', truth: 'merchant_at_fault', facts: 'You never ordered this; your account was compromised and the parcel went to a stranger.', rightActions: ['accept', 'escalate_to_human'], build: () => ({ shipment: D(4, undefined, false), customer: { newName: 'New Customer' } }) },
    { variant: 'new_account_untracked', truth: 'ambiguous', facts: 'You do not recognize the charge.', rightActions: ['escalate_to_human', 'accept'], build: () => ({ shipment: { status: 'SHIPPED_UNTRACKED' }, customer: { newName: 'New Customer' } }) },
  ],
  duplicate: [
    { variant: 'real_duplicate', truth: 'merchant_at_fault', facts: 'You paid twice for the same cart after a checkout timeout; only one parcel came.', rightActions: ['accept'], build: () => ({ order: { status: 'DUPLICATE_PAYMENT', note: 'Checkout retried after a timeout; second payment for the same cart. Only one parcel shipped.' } }) },
    { variant: 'separate_orders', truth: 'buyer_at_fault', facts: 'You actually placed two separate orders a day apart and received two parcels, but forgot about the second.', rightActions: ['contest'], build: () => ({ siblingOrder: true, shipment: D(4, undefined) }) },
    { variant: 'already_refunded', truth: 'buyer_at_fault', facts: 'You were charged twice, but the shop refunded the duplicate two days ago and you did not notice.', rightActions: ['contest'], build: () => ({ order: { status: 'DUPLICATE_PAYMENT', note: 'Duplicate checkout payment.', refundedDays: 2 } as Scenario['order'] }) },
  ],
  late_delivery: [
    { variant: 'arrived_after_claim', truth: 'buyer_at_fault', facts: 'The parcel was late; you filed the claim, then it arrived the next day.', rightActions: ['contest'], build: () => ({ shipment: D(-1, undefined) }) },
    { variant: 'stalled', truth: 'merchant_at_fault', facts: 'Tracking has been stuck for twelve days.', rightActions: ['accept'], build: () => ({ shipment: { status: 'IN_TRANSIT', tracked: true, lastScanDays: 12 } }) },
  ],
};

export const ARENA_TYPES = Object.keys(VARIANTS) as ArenaType[];

const PRODUCTS: [id: string, priceUsd: number][] = [
  ['p-pourover', 42], ['p-apron', 28.5], ['p-board', 64], ['p-mugs', 36.75], ['p-vase', 89], ['p-towels', 19.25],
  ['p-grinder', 118], ['p-espresso', 47.4], ['p-plates', 96], ['p-matcha', 34], ['p-salt', 22], ['p-trivet', 26],
];
const CUSTOMERS = ['c-okafor', 'c-lindqvist', 'c-reyes', 'c-tanaka', 'c-osei', 'c-murphy', 'c-nguyen', 'c-schmidt', 'c-dubois', 'c-kim', 'c-garcia', 'c-novak', 'c-hassan', 'c-fischer', 'c-brown', 'c-silva', 'c-walsh', 'c-ito'];

const REASON: Record<ArenaType, Scenario['reason']> = {
  not_received: 'MERCHANDISE_OR_SERVICE_NOT_RECEIVED',
  late_delivery: 'MERCHANDISE_OR_SERVICE_NOT_RECEIVED',
  not_as_described: 'MERCHANDISE_OR_SERVICE_NOT_AS_DESCRIBED',
  unauthorized: 'UNAUTHORISED',
  duplicate: 'DUPLICATE_TRANSACTION',
};

// mulberry32, as in the seed
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

/** `n` scenarios from `seed`. Same seed, same scenarios. Types and personas rotate so every mix appears. */
export function generateScenarios(seed: number, n: number): ArenaScenario[] {
  const rand = prng(seed);
  const pick = <T,>(xs: readonly T[]) => xs[Math.floor(rand() * xs.length)];
  const out: ArenaScenario[] = [];
  for (let i = 0; i < n; i++) {
    const type = ARENA_TYPES[i % ARENA_TYPES.length];
    const persona = PERSONAS[Math.floor(i / ARENA_TYPES.length) % PERSONAS.length];
    const def = pick(VARIANTS[type]);
    const [product, price] = pick(PRODUCTS);
    const qty = rand() < 0.15 ? 3 : rand() < 0.3 ? 2 : 1;
    const base: BaseSpec = { amount: Math.round(price * qty * 100) / 100, product, qty, customer: pick(CUSTOMERS) };
    const built = def.build(base);
    const spec: Scenario = {
      id: `${type}-${def.variant}`,
      type,
      situation: def.truth === 'buyer_at_fault' ? 'seller_should_win' : def.truth === 'merchant_at_fault' ? 'merchant_at_fault' : 'needs_human',
      description: def.facts,
      reason: REASON[type],
      stage: type === 'unauthorized' ? 'CHARGEBACK' : 'INQUIRY',
      amount: base.amount,
      product,
      qty,
      customer: { existing: base.customer },
      buyerMessage: '',
      expected: { action: def.rightActions[0] },
      ...built,
    };
    out.push({
      id: `${seed}-${i + 1}`,
      seed,
      index: i + 1,
      type,
      variant: def.variant,
      persona,
      truth: def.truth,
      complaint: def.complaint,
      buyerFacts: def.facts,
      spec,
      rightActions: def.rightActions,
    });
  }
  return out;
}
