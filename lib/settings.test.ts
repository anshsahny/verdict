import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { openDb } from '@/lib/db';
import { validateDecision } from '@/lib/agent/guardrails';
import type { Decision } from '@/lib/agent/schema';
import { makeTools } from '@/lib/agent/tools';
import { getDispute, upsertDispute } from '@/lib/disputes/store';
import { buildEvidencePacket } from '@/lib/evidence/packet';
import type { PayPalDispute } from '@/lib/paypal/dispute-schema';
import { defaultPlaybook, getPlaybook, savePlaybook } from './settings';

const fixture = (id: string) => JSON.parse(readFileSync(`fixtures/disputes/snapshots/2026-11-10-before-gate1/${id}.json`, 'utf8')) as PayPalDispute;

describe('Playbook', () => {
  it('defaults come from the seeded store policy, with the dispute rules split into a list', () => {
    const pb = getPlaybook(openDb(':memory:'));
    expect(pb).toEqual(defaultPlaybook());
    expect(pb.disputeRules.length).toBeGreaterThanOrEqual(5);
    expect(pb.disputeRules[0]).toMatch(/^Contest only when/);
  });

  it('saved thresholds change what the guardrails flag', () => {
    const db = openDb(':memory:');
    const raw = fixture('PP-R-SLD-10197881'); // $47.40
    upsertDispute(db, raw, { full: true, source: 'replay' });
    const ctx = (thresholds: { approvalUsd: number; minConfidence: number }) => ({ dispute: raw, packet: buildEvidencePacket(db, getDispute(db, raw.dispute_id)!), disputeAmount: 47.4, buyerText: '', thresholds });
    const d: Decision = { action: 'accept', amount: 47.4, confidence: 0.7, reasoning: ['r'], evidence: [], risks: [], draftMessageToBuyer: 'm' };

    savePlaybook(db, { ...defaultPlaybook(), approvalThresholdUsd: 40, minConfidence: 0.8 }, 'test');
    const pb = getPlaybook(db);
    const flags = validateDecision(d, ctx({ approvalUsd: pb.approvalThresholdUsd, minConfidence: pb.minConfidence })).flags.join(' ');
    expect(flags).toMatch(/above the approval threshold \(\$40\)/);
    expect(flags).toMatch(/Confidence 0.7 is below 0.8/);
    expect(validateDecision(d, ctx({ approvalUsd: 250, minConfidence: 0.6 })).flags).toEqual([]);
  });

  it('the agent sees the edited rules through get_merchant_policy', async () => {
    const db = openDb(':memory:');
    const raw = fixture('PP-R-SLD-10197881');
    upsertDispute(db, raw, { full: true, source: 'replay' });
    savePlaybook(db, { ...defaultPlaybook(), disputeRules: ['Always ask the owner before refunding anything over $40.'] }, 'test');
    const tools = makeTools({ db, disputeId: raw.dispute_id, calls: [] });
    const policyTool = tools.find((t) => t.name === 'get_merchant_policy')!;
    const out = JSON.parse(String(await (policyTool as unknown as { run: (i: unknown) => Promise<string> }).run({})));
    expect(out.disputes).toBe('Always ask the owner before refunding anything over $40.');
    expect(out.disputeRules).toEqual(['Always ask the owner before refunding anything over $40.']);
  });
});
