// Zod schema for the parts of a PayPal dispute that Verdict stores. Lenient on purpose: webhook
// resources are partial (no due date, evidences or allowed options; see docs/api-notes.md), and
// unknown fields pass through untouched into raw_json.

import { z } from 'zod';

const Money = z.object({ currency_code: z.string(), value: z.string() });

export const PayPalDispute = z
  .object({
    dispute_id: z.string().min(1),
    create_time: z.string(),
    update_time: z.string(),
    reason: z.string(),
    status: z.string(),
    dispute_life_cycle_stage: z.string(),
    dispute_channel: z.string().optional(),
    dispute_amount: Money,
    seller_response_due_date: z.string().optional(),
    dispute_outcome: z.object({ outcome_code: z.string().optional() }).passthrough().optional(),
    disputed_transactions: z
      .array(
        z
          .object({
            seller_transaction_id: z.string().optional(),
            buyer_transaction_id: z.string().optional(),
          })
          .passthrough(),
      )
      .optional(),
    links: z.array(z.object({ href: z.string(), rel: z.string(), method: z.string().optional() })).optional(),
  })
  .passthrough();

export type PayPalDispute = z.infer<typeof PayPalDispute>;

export const PayPalWebhookEvent = z
  .object({
    id: z.string().min(1),
    event_type: z.string().min(1),
    create_time: z.string().optional(),
    resource: z.unknown(),
  })
  .passthrough();

export type PayPalWebhookEvent = z.infer<typeof PayPalWebhookEvent>;

export const toCents = (value: string) => Math.round(Number(value) * 100);
