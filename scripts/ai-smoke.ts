// Phase 0 AI smoke test: one Claude call that uses tools and returns a Zod-validated decision.
// The data is a tiny in-memory fixture; Phase 3 replaces it with the real defender agent.
//
//   npm run ai:smoke

import { config } from 'dotenv';
config({ path: '.env.local', quiet: true });

import Anthropic from '@anthropic-ai/sdk';
import { betaZodOutputFormat, betaZodTool } from '@anthropic-ai/sdk/helpers/beta/zod';
import { z } from 'zod';

const MODEL = process.env.ANTHROPIC_MODEL || 'claude-sonnet-5-5';

const ORDERS: Record<string, { id: string; total: string; shippedAt: string; trackingId: string }> = {
  'ord_1001': { id: 'ord_1001', total: '48.00', shippedAt: '2026-10-28', trackingId: 'trk_5501' },
};
const TRACKING: Record<string, { id: string; carrier: string; status: string; deliveredAt?: string; signedBy?: string }> = {
  'trk_5501': { id: 'trk_5501', carrier: 'USPS', status: 'DELIVERED', deliveredAt: '2026-11-01', signedBy: 'front desk' },
};

const Decision = z.object({
  action: z.enum(['accept', 'offer_refund', 'contest', 'escalate_to_human']),
  confidence: z.number().min(0).max(1),
  reasoning: z.array(z.string()).min(1),
  evidence: z.array(z.object({ type: z.string(), recordId: z.string(), whyItHelps: z.string() })),
});

const toolCalls: string[] = [];

const getOrder = betaZodTool({
  name: 'get_order',
  description: 'Look up a store order by id. Returns total, ship date and tracking id.',
  inputSchema: z.object({ orderId: z.string() }),
  run: async ({ orderId }) => {
    toolCalls.push(`get_order(${orderId})`);
    return JSON.stringify(ORDERS[orderId] ?? { error: 'not found' });
  },
});

const getTracking = betaZodTool({
  name: 'get_tracking',
  description: 'Look up a shipment by tracking id. Returns carrier, status and delivery details.',
  inputSchema: z.object({ trackingId: z.string() }),
  run: async ({ trackingId }) => {
    toolCalls.push(`get_tracking(${trackingId})`);
    return JSON.stringify(TRACKING[trackingId] ?? { error: 'not found' });
  },
});

(async () => {
  if (!process.env.ANTHROPIC_API_KEY) throw new Error('ANTHROPIC_API_KEY must be set in .env.local');
  const client = new Anthropic();
  const started = Date.now();

  const final = await client.beta.messages.toolRunner({
    model: MODEL,
    max_tokens: 4000,
    output_config: { effort: 'low', format: betaZodOutputFormat(Decision) },
    system:
      'You are a dispute clerk for a small online shop. Investigate with the tools before deciding. ' +
      'Every evidence item must cite a recordId returned by a tool.',
    tools: [getOrder, getTracking],
    messages: [
      {
        role: 'user',
        content: 'Dispute: buyer says order ord_1001 ($48.00) never arrived. Decide how to respond.',
      },
    ],
  });

  const text = final.content.flatMap((b) => (b.type === 'text' ? [b.text] : [])).join('');
  const parsed = Decision.safeParse(JSON.parse(text));
  const knownIds = new Set([...Object.keys(ORDERS), ...Object.keys(TRACKING)]);
  const citationsOk = parsed.success && parsed.data.evidence.every((e) => knownIds.has(e.recordId));

  console.log(`model        ${final.model}`);
  console.log(`stop_reason  ${final.stop_reason}`);
  console.log(`tool calls   ${toolCalls.join(', ') || 'none'}`);
  console.log(`latency      ${Date.now() - started} ms`);
  console.log(`tokens       in ${final.usage.input_tokens} / out ${final.usage.output_tokens} (last turn)`);
  if (!parsed.success) {
    console.log('FAIL   Zod validation:', parsed.error.message);
    process.exitCode = 1;
    return;
  }
  console.log('decision    ', JSON.stringify(parsed.data, null, 2));
  const pass = toolCalls.length > 0 && citationsOk;
  console.log(`${pass ? 'PASS' : 'FAIL'}   tool use: ${toolCalls.length > 0}, Zod valid: true, citations valid: ${citationsOk}`);
  process.exitCode = pass ? 0 : 1;
})().catch((e) => {
  console.error('FAIL   ai smoke aborted:', e instanceof Anthropic.APIError ? `${e.status} ${e.message}` : (e as Error).message);
  process.exitCode = 1;
});
