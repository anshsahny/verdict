// The only path from an agent decision to PayPal: a human approves (optionally editing the amount
// or message) or overrides the action. The dispute is re-fetched first and the action re-checked
// against what PayPal allows now, so a stale recommendation can't fire.

import { audit, nowIso, type Db } from '@/lib/db';
import { getDispute, upsertDispute } from '@/lib/disputes/store';
import { buildEvidencePacket, toPayPalEvidences } from '@/lib/evidence/packet';
import { allowedActions, requestedEvidence } from '@/lib/paypal/actions';
import { PayPalApiError, type PayPalClient } from '@/lib/paypal/client';
import { redactValue } from '@/lib/paypal-raw';
import type { AgentAction, Decision } from './schema';

type ExecuteOptions = {
  by: string; // who approved; recorded in decisions.decided_by
  edits?: { amount?: number; message?: string };
  override?: { action: AgentAction; amount: number | null; message?: string };
};

type ExecuteResult = {
  decisionId: string;
  action: AgentAction;
  paypalAction: string | null;
  status: 'executed' | 'escalated' | 'failed';
  error?: string;
  disputeStateAfter?: string;
};

type DecisionRow = { id: string; dispute_id: string; status: string; payload_json: string };

const money = (usd: number) => ({ currency_code: 'USD', value: usd.toFixed(2) });

function defaultNote(action: AgentAction, amount: number | null): string {
  if (action === 'accept') return `We're sorry for the trouble. We have issued a refund of $${(amount ?? 0).toFixed(2)} through PayPal.`;
  if (action === 'offer_refund') return `We'd like to offer a refund of $${(amount ?? 0).toFixed(2)} to resolve this.`;
  return '';
}

export async function executeDecision(db: Db, client: PayPalClient, decisionId: string, opts: ExecuteOptions): Promise<ExecuteResult> {
  const row = db.prepare('SELECT id, dispute_id, status, payload_json FROM decisions WHERE id = ?').get(decisionId) as DecisionRow | undefined;
  if (!row) throw new Error(`no decision ${decisionId}`);
  if (row.status !== 'proposed' && row.status !== 'needs_human' && !(row.status === 'invalid' && opts.override)) {
    throw new Error(`decision ${decisionId} is ${row.status}; only proposed or needs_human decisions can be approved`);
  }
  const proposed = (JSON.parse(row.payload_json) as { decision: Decision | null }).decision;
  if (!proposed && !opts.override) throw new Error('no agent decision to approve; override instead');

  const action = opts.override?.action ?? proposed!.action;
  const amount = opts.override ? opts.override.amount : (opts.edits?.amount ?? proposed!.amount);
  // The agent's draft was written for its own action; an override to a different action gets a
  // neutral note for that action unless the human wrote one.
  const draftFits = proposed && proposed.action === action;
  const message = opts.override?.message ?? opts.edits?.message ?? (draftFits ? proposed.draftMessageToBuyer : defaultNote(action, amount));

  const finish = (status: ExecuteResult['status'], paypalAction: string | null, result: unknown, extra: Partial<ExecuteResult> = {}): ExecuteResult => {
    db.prepare('UPDATE decisions SET status = ?, decided_by = ?, executed_at = ?, result_json = ? WHERE id = ?').run(
      status,
      opts.by,
      nowIso(),
      JSON.stringify({ action, amount, message, override: Boolean(opts.override), edited: Boolean(opts.edits), paypalAction, result }),
      decisionId,
    );
    audit(db, 'human', `decision.${status}`, row.dispute_id, { decisionId, by: opts.by, action, amount, override: opts.override ?? null, edits: opts.edits ?? null, paypalAction, result });
    return { decisionId, action, paypalAction, status, ...extra };
  };

  if (action === 'escalate_to_human') return finish('escalated', null, 'no PayPal action');

  // Fresh state from PayPal, re-checked against what is allowed now.
  const dispute = await client.getDispute(row.dispute_id);
  upsertDispute(db, dispute, { full: true, source: 'poll' });
  const allowed = allowedActions(dispute);
  const disputeAmount = Number(dispute.dispute_amount.value);
  const fail = (error: string) => finish('failed', null, { error }, { error });

  if ((action === 'accept' || action === 'offer_refund') && (amount === null || !(amount > 0) || amount > disputeAmount + 0.001)) {
    return fail(`amount must be between 0 and ${disputeAmount}`);
  }

  try {
    let paypalAction: string;
    let response: unknown;
    if (action === 'accept') {
      if (!allowed.includes('accept_claim')) return fail(`accept_claim not allowed now (${allowed.join(', ') || 'none'})`);
      const partial = amount! < disputeAmount - 0.001;
      paypalAction = 'accept_claim';
      response = await client.acceptClaim(dispute, {
        note: message || 'Refunding as requested.',
        accept_claim_type: partial ? 'PARTIAL_REFUND' : 'REFUND',
        ...(partial ? { refund_amount: money(amount!) } : {}),
      });
    } else if (action === 'offer_refund') {
      if (!allowed.includes('make_offer')) return fail(`make_offer not allowed now (${allowed.join(', ') || 'none'})`);
      paypalAction = 'make_offer';
      response = await client.makeOffer(dispute, { note: message || 'We would like to offer a partial refund.', offer_type: 'REFUND', offer_amount: money(amount!) });
    } else {
      // contest: the cited records (or, on an override, every helpful record), plus disclosures.
      const packet = buildEvidencePacket(db, getDispute(db, row.dispute_id)!);
      const cited = proposed?.action === 'contest' && !opts.override ? proposed.evidence : null;
      const selected = cited ? packet.items.filter((i) => cited.some((c) => c.recordId === i.recordId && c.type === i.kind)) : packet.items.filter((i) => i.helps);
      const evidences = toPayPalEvidences(selected, { stage: dispute.dispute_life_cycle_stage, requested: requestedEvidence(dispute), disclosures: packet.items });
      if (!evidences.length) return fail('no helpful evidence to submit');
      if (allowed.includes('provide_evidence')) {
        paypalAction = 'provide_evidence';
        response = await client.provideEvidence(dispute, evidences);
      } else if (allowed.includes('provide_supporting_info')) {
        paypalAction = 'provide_supporting_info';
        response = await client.provideSupportingInfo(dispute, evidences.map((e) => e.notes).join(' ').slice(0, 2000));
      } else {
        return fail(`no evidence action allowed now (${allowed.join(', ') || 'none'})`);
      }
    }

    const after = await client.getDispute(row.dispute_id);
    upsertDispute(db, after, { full: true, source: 'poll' });
    const state = `${after.dispute_life_cycle_stage}/${after.status}`;
    return finish('executed', paypalAction, { response: redactValue(response), after: state }, { disputeStateAfter: state });
  } catch (e) {
    const error = e instanceof PayPalApiError ? `${e.status} ${e.issues.join(',') || e.message}` : (e as Error).message;
    return fail(error);
  }
}
