import type Anthropic from '@anthropic-ai/sdk';
import { describe, expect, it } from 'vitest';
import { openDb } from '@/lib/db';
import { SCENARIOS, materialize } from './eval/scenarios';
import { runDefender } from './defender';

// A model that keeps calling tools forever, burning 5k tokens per turn.
function runawayClient() {
  let turns = 0;
  const client = {
    beta: {
      messages: {
        toolRunner: (params: { messages: Anthropic.Beta.BetaMessageParam[] }) => ({
          params,
          async *[Symbol.asyncIterator]() {
            for (;;) {
              turns++;
              yield { id: 'm', role: 'assistant', stop_reason: 'tool_use', content: [], usage: { input_tokens: 4000, output_tokens: 1000 } };
            }
          },
        }),
      },
    },
  } as unknown as Anthropic;
  return { client, turns: () => turns };
}

describe('Arena token cap', () => {
  it('stops a runaway run at the token budget and marks it invalid', async () => {
    const db = openDb(':memory:');
    const disputeId = materialize(db, SCENARIOS[0]);
    const { client, turns } = runawayClient();
    const run = await runDefender({ db, disputeId, client, model: 'scripted', tokenBudget: 20_000 });
    expect(run.status).toBe('invalid');
    expect(run.validation.errors[0]).toMatch(/token budget exceeded/);
    expect(turns()).toBe(5); // 5 turns x 5k tokens crosses 20k
    expect(run.usage.inputTokens + run.usage.outputTokens).toBeLessThanOrEqual(25_000);
  });
});
