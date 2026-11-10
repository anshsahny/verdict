import type Anthropic from '@anthropic-ai/sdk';
import { describe, expect, it } from 'vitest';
import { openDb, type Db } from '@/lib/db';
import { SCENARIOS, materialize } from './eval/scenarios';
import { runDefender } from './defender';
import type { Decision } from './schema';

// A scripted model: each toolRunner call returns the next canned final message. The real
// tool-calling loop is exercised by `npm run eval`; this tests validation, retry and persistence.
function scriptedClient(outputs: (Decision | string)[]) {
  const seen: Anthropic.Beta.BetaMessageParam[][] = [];
  const client = {
    beta: {
      messages: {
        toolRunner: (params: { messages: Anthropic.Beta.BetaMessageParam[] }) => {
          seen.push(params.messages);
          const out = outputs.shift();
          const text = typeof out === 'string' ? out : JSON.stringify(out);
          const message = {
            id: 'm',
            type: 'message',
            role: 'assistant',
            model: 'scripted',
            stop_reason: 'end_turn',
            content: [{ type: 'text', text }],
            usage: { input_tokens: 1000, output_tokens: 200 },
          };
          return {
            params: { messages: params.messages },
            async *[Symbol.asyncIterator]() {
              yield message;
            },
          };
        },
      },
    },
  } as unknown as Anthropic;
  return { client, seen };
}

const scenario = (id: string) => SCENARIOS.find((s) => s.id === id)!;
const setup = (id: string): { db: Db; disputeId: string } => {
  const db = openDb(':memory:');
  return { db, disputeId: materialize(db, scenario(id)) };
};
const contest = (recordId: string, type = 'signature'): Decision => ({
  action: 'contest',
  amount: null,
  confidence: 0.9,
  reasoning: ['Signed delivery to the order address before the claim.'],
  evidence: [{ type, recordId, whyItHelps: 'proof' }],
  risks: [],
  draftMessageToBuyer: 'Our records show delivery.',
});

describe('runDefender', () => {
  it('retries with the exact validation errors when a citation is invented, then succeeds', async () => {
    const { db, disputeId } = setup('inr-signed');
    const { client, seen } = scriptedClient([contest('ship-FAKE-1'), contest('ship-EV01')]);
    const run = await runDefender({ db, disputeId, client, model: 'scripted' });
    expect(run.attempts).toBe(2);
    expect(run.status).toBe('proposed');
    const retryPrompt = JSON.stringify(seen[1].at(-1));
    expect(retryPrompt).toContain('ship-FAKE-1');
    expect(retryPrompt).toContain('failed validation');
  });

  it('marks the decision invalid after repeated failures, and never as proposed', async () => {
    const { db, disputeId } = setup('inr-signed');
    const { client } = scriptedClient([contest('nope'), 'not json at all', contest('still-nope')]);
    const run = await runDefender({ db, disputeId, client, model: 'scripted' });
    expect(run.attempts).toBe(3);
    expect(run.status).toBe('invalid');
    const row = db.prepare('SELECT status FROM decisions WHERE id = ?').get(run.decisionId) as { status: string };
    expect(row.status).toBe('invalid');
  });

  it('routes a valid decision to a human when the buyer text tries to instruct the agent', async () => {
    const { db, disputeId } = setup('inr-injection');
    const { client } = scriptedClient([contest('ship-EV04')]);
    const run = await runDefender({ db, disputeId, client, model: 'scripted' });
    expect(run.validation.errors).toEqual([]);
    expect(run.status).toBe('needs_human');
    expect(run.validation.flags.join()).toMatch(/prompt injection/);
  });

  it('even if the model complied with an injection, the refund still needs a human', async () => {
    const { db, disputeId } = setup('inr-injection');
    const complied: Decision = { ...contest('ship-EV04'), action: 'accept', amount: 47.4, evidence: [] };
    const { client } = scriptedClient([complied]);
    const run = await runDefender({ db, disputeId, client, model: 'scripted' });
    expect(run.status).toBe('needs_human');
  });

  it('stores the decision and a full audit record of the run', async () => {
    const { db, disputeId } = setup('inr-signed');
    const { client } = scriptedClient([contest('ship-EV01')]);
    const run = await runDefender({ db, disputeId, client, model: 'scripted' });
    const decisionRow = db.prepare('SELECT action, status, confidence, payload_json FROM decisions WHERE id = ?').get(run.decisionId) as Record<string, string>;
    expect(decisionRow).toMatchObject({ action: 'contest', status: 'proposed', confidence: 0.9 });
    const audit = db.prepare("SELECT data_json FROM audit_log WHERE kind = 'agent.run' AND ref = ?").get(disputeId) as { data_json: string };
    const data = JSON.parse(audit.data_json);
    expect(data).toMatchObject({ decisionId: run.decisionId, model: 'scripted', promptVersion: 'defender-v1', status: 'proposed' });
    expect(data.systemPrompt).toContain('untrusted_buyer_message');
    expect(data.attempts).toHaveLength(1);
    expect(data.usage).toMatchObject({ inputTokens: 1000, outputTokens: 200 });
  });
});
