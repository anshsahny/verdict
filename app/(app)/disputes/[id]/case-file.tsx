'use client';

// The Case File: one dispute, in plain language. Where it stands (progress), what Verdict
// recommends and why, the evidence, and the owner's Approve / Edit / Override. Every PayPal action
// goes through /api/decisions/[id]/execute. Record citations are one click away ("Show sources").

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState, type ReactNode } from 'react';
import { DeadlineRing, StrengthGauge, Timeline, URGENCY, useNow } from '@/components/viz';
import { Badge, Button, Card, usd, useToast } from '@/components/ui';
import { computeDeadline, formatRemaining } from '@/lib/disputes/deadline';
import type { AppMode } from '@/lib/mode';
import type { CaseFile } from '@/lib/views/disputes';

const ACTION_TEXT: Record<string, (amount: number | null) => string> = {
  accept: (a) => `Refund ${usd(a)} in full`,
  offer_refund: (a) => `Offer a ${usd(a)} partial refund`,
  contest: () => 'Contest with your evidence',
  escalate_to_human: () => 'Handle this one yourself',
};
const ACTION_SHORT: Record<string, string> = { accept: 'Refund in full', offer_refund: 'Offer a partial refund', contest: 'Contest with evidence', escalate_to_human: 'Handle it yourself' };
const EVIDENCE_LABEL: Record<string, string> = {
  tracking: 'Tracking number',
  delivery_confirmation: 'Delivery scan',
  signature: 'Signature',
  address_match: 'Right address',
  address_mismatch: 'Wrong address',
  not_delivered: 'No delivery scan',
  untracked: 'No tracking',
  product_listing: 'Product listing',
  policy: 'Store policy',
  customer_history: 'Customer history',
  customer_note: 'Support note',
  refund_record: 'Refund on file',
  duplicate_payment: 'Duplicate payment',
  separate_orders: 'Separate orders',
};
// Guardrail flags, in the merchant's words.
function plainFlag(f: string): string {
  if (/prompt injection/i.test(f)) return 'The buyer’s message tries to give Verdict instructions. They were ignored; please check this one yourself.';
  if (/escalated/i.test(f)) return 'Verdict wants your judgment on this one.';
  const big = f.match(/\$([\d.,]+) is above the approval threshold \(\$([\d.,]+)\)/);
  if (big) return `Large dispute: $${big[1]} is above your $${big[2]} review threshold (Playbook).`;
  const conf = f.match(/Confidence ([\d.]+) is below ([\d.]+)/);
  if (conf) return `Verdict is only ${Math.round(Number(conf[1]) * 100)}% sure (your Playbook asks for ${Math.round(Number(conf[2]) * 100)}%).`;
  return f;
}

// "How Verdict decided": what the agent looked at (its tool calls) and the guardrails its answer went
// through. Every decision shown here already passed validation, so those checks are always met; the
// Playbook checks can flag it for the owner.
const LOOKED_AT: Record<string, string> = {
  get_dispute: 'The PayPal dispute',
  get_order: 'The order',
  get_tracking: 'Shipping and tracking',
  get_customer_history: 'Customer history',
  get_merchant_policy: 'Your Playbook',
  list_available_evidence: 'Evidence on file',
  build_evidence_packet: 'Evidence strength',
};

function HowDecided({ payload }: { payload: NonNullable<CaseFile['decision']>['payload'] }) {
  const flags = payload.validation.flags;
  const flagged = (re: RegExp) => flags.some((f) => re.test(f));
  const checks: [string, boolean][] = [
    ['The response is one PayPal allows right now, for no more than the disputed amount', true],
    ['Every piece of evidence points to a real record in your store', true],
    ['The buyer’s message was screened for instructions aimed at the AI', !flagged(/injection/i)],
    ['The amount is within your Playbook’s review threshold', !flagged(/approval threshold/)],
    ['Verdict is as sure as your Playbook requires', !flagged(/Confidence/)],
    ['Your Playbook gives a clear answer for this case', !flagged(/escalated/)],
  ];
  const looked = [...new Set(payload.trace?.tools ?? [])].map((t) => LOOKED_AT[t]).filter(Boolean);
  const passed = checks.filter(([, ok]) => ok).length;
  const t = payload.trace;
  return (
    <details className="mt-5 rounded-xl border border-v-border bg-v-raised px-4 py-3">
      <summary className="cursor-pointer text-sm font-medium text-v-ink">
        How Verdict decided
        <span className="ml-2 font-normal text-v-muted">
          {looked.length ? `checked ${looked.length} sources · ` : ''}
          {passed} of {checks.length} checks passed
        </span>
      </summary>
      {looked.length ? (
        <div className="mt-3">
          <p className="text-xs font-semibold uppercase tracking-wide text-v-faint">Looked at</p>
          <ul className="mt-1.5 flex flex-wrap gap-1.5">
            {looked.map((l) => (
              <li key={l} className="rounded-md bg-v-surface px-2 py-0.5 text-xs text-v-ink ring-1 ring-v-border">
                {l}
              </li>
            ))}
          </ul>
        </div>
      ) : null}
      <p className="mt-3 text-xs font-semibold uppercase tracking-wide text-v-faint">Checks before you see it</p>
      <ul className="mt-1.5 space-y-1 text-sm">
        {checks.map(([label, ok]) => (
          <li key={label} className={`flex gap-2 ${ok ? 'text-v-ink' : 'text-v-warn'}`}>
            <span aria-hidden className={ok ? 'text-v-win' : ''}>
              {ok ? '✓' : '⚑'}
            </span>
            <span>
              {label}
              <span className="sr-only">{ok ? ' (passed)' : ' (flagged for you)'}</span>
            </span>
          </li>
        ))}
      </ul>
      <p className="mt-3 text-xs text-v-muted">
        Claude ({payload.model}) with read-only tools: it can look things up but cannot act on PayPal.
        {t ? ` ${t.attempts === 1 ? 'Valid on the first try' : `Fixed after ${t.attempts - 1} failed check${t.attempts > 2 ? 's' : ''}`}, ${Math.round(t.latencyMs / 1000)} s.` : ''} Every step is in the audit log.
      </p>
    </details>
  );
}

const SUCCESS: Record<string, string> = {
  accept_claim: 'Refund sent to PayPal. PayPal closes the dispute in about a minute.',
  make_offer: 'Offer sent. The buyer can accept or decline it in PayPal.',
  provide_evidence: 'Evidence submitted. PayPal is now reviewing the case.',
  provide_supporting_info: 'Information submitted to PayPal’s review.',
};

// --- Progress -------------------------------------------------------------------------------------

function Progress({ status, outcome }: { status: string; outcome: string | null }) {
  const steps = ['Opened', 'Your response', status === 'WAITING_FOR_BUYER_RESPONSE' ? 'Buyer’s reply' : 'PayPal review', 'Closed'];
  const current = status === 'RESOLVED' ? 4 : status === 'WAITING_FOR_SELLER_RESPONSE' ? 1 : 2;
  return (
    <ol className="mt-5 flex items-center gap-2" aria-label="Dispute progress">
      {steps.map((s, i) => {
        const done = i < current;
        const now = i === current;
        return (
          <li key={s} className="flex flex-1 items-center gap-2" aria-current={now ? 'step' : undefined}>
            <span
              className={`flex size-6 shrink-0 items-center justify-center rounded-full text-xs font-bold ${done ? 'bg-v-win text-white' : now ? 'bg-v-accent text-v-accent-ink' : 'bg-v-highlight text-v-muted'}`}
              aria-hidden
            >
              {done ? '✓' : i + 1}
            </span>
            <span className={`text-sm ${now ? 'font-semibold text-v-ink' : done ? 'text-v-ink max-sm:sr-only' : 'text-v-muted max-sm:sr-only'}`}>
              {i === 3 && outcome ? outcome : s}
              <span className="sr-only">{done ? ' (done)' : now ? ' (current)' : ''}</span>
            </span>
            {i < steps.length - 1 ? <span className={`mx-1 h-px flex-1 ${done ? 'bg-v-win' : 'bg-v-border'}`} aria-hidden /> : null}
          </li>
        );
      })}
    </ol>
  );
}

// --- Recommendation and owner actions ---------------------------------------------------------------

function Section({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="mt-5">
      <h3 className="text-xs font-semibold uppercase tracking-wide text-v-faint">{label}</h3>
      <div className="mt-1.5">{children}</div>
    </div>
  );
}

function Recommendation({ cf, mode, showSources }: { cf: CaseFile; mode: AppMode; showSources: boolean }) {
  const router = useRouter();
  const toast = useToast();
  const [busy, setBusy] = useState<null | 'recommend' | 'execute'>(null);
  const [error, setError] = useState<string | null>(null);
  const [panel, setPanel] = useState<null | 'edit' | 'override'>(null);
  const [allReasons, setAllReasons] = useState(false);
  const dec = cf.decision;
  const d = dec?.payload.decision ?? null;
  const resolved = cf.raw.status === 'RESOLVED';
  const decided = dec && !['proposed', 'needs_human'].includes(dec.status);
  const [amount, setAmount] = useState<string>(d?.amount != null ? String(d.amount) : '');
  const [message, setMessage] = useState<string>(d?.draftMessageToBuyer ?? '');
  const choices = cf.raw.availableActions.filter((a) => a !== 'escalate_to_human');
  const [overrideAction, setOverrideAction] = useState<string>(choices.find((a) => a !== d?.action) ?? choices[0] ?? 'accept');

  async function call(url: string, body?: unknown) {
    setError(null);
    const res = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined });
    const json = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(json.error ?? `Request failed (${res.status})`);
    return json;
  }
  async function recommend() {
    setBusy('recommend');
    try {
      const r = await call(`/api/disputes/${cf.dispute.id}/recommend`);
      toast({ tone: 'accent', title: 'Verdict reviewed this dispute', body: r.decision ? ACTION_TEXT[r.decision.action]?.(r.decision.amount) : undefined });
      router.refresh();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(null);
    }
  }
  async function execute(body: unknown) {
    setBusy('execute');
    try {
      const r = await call(`/api/decisions/${dec!.id}/execute`, body);
      if (r.status === 'failed') {
        setError(`PayPal didn’t accept that: ${r.error}`);
        toast({ tone: 'danger', title: 'Nothing was changed', body: r.error });
      } else {
        toast({ tone: 'win', title: r.status === 'escalated' ? 'Kept for you to handle' : 'Done', body: SUCCESS[r.paypalAction] ?? 'Saved.' });
      }
      setPanel(null);
      router.refresh();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(null);
    }
  }

  if (!d) {
    return (
      <Card>
        <p className="text-xs font-semibold uppercase tracking-wide text-v-faint">Verdict’s recommendation</p>
        <h2 className="mt-1 text-lg font-semibold text-v-ink">{resolved ? 'This dispute is closed' : 'Let Verdict build the case'}</h2>
        <p className="mt-1 text-sm text-v-muted">
          {resolved
            ? 'No action is needed.'
            : 'Verdict reads the order, tracking, customer history and your Playbook, then proposes a response with the evidence attached. Nothing is sent to PayPal until you approve it.'}
        </p>
        {!resolved ? (
          <Button size="lg" className="mt-4" onClick={recommend} disabled={busy !== null}>
            {busy === 'recommend' ? 'Reviewing… about 10 seconds' : 'Review this dispute'}
          </Button>
        ) : null}
        {error ? (
          <p role="alert" className="mt-3 text-sm text-v-danger">
            {error}
          </p>
        ) : null}
      </Card>
    );
  }

  const flags = dec!.payload.validation.flags;
  const canAct = !resolved && !decided;
  const reasons = allReasons ? d.reasoning : d.reasoning.slice(0, 3);
  return (
    <Card className={dec!.status === 'needs_human' && canAct ? 'ring-1 ring-v-warn' : ''}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-xs font-semibold uppercase tracking-wide text-v-faint">Verdict recommends</p>
          <h2 className="mt-1 text-xl font-semibold tracking-tight text-v-ink">{ACTION_TEXT[d.action]?.(d.amount) ?? d.action}</h2>
        </div>
        <div className="flex flex-col items-end gap-1.5">
          {decided ? <Badge tone={dec!.status === 'failed' ? 'danger' : 'win'}>{dec!.status === 'executed' ? 'Approved' : dec!.status === 'escalated' ? 'Kept for you' : dec!.status}</Badge> : null}
          {dec!.status === 'needs_human' && canAct ? <Badge tone="warn">Needs your judgment</Badge> : null}
          <div className="flex items-center gap-2 text-xs text-v-muted" aria-label={`Confidence ${Math.round(d.confidence * 100)} percent`}>
            confidence
            <span className="h-1.5 w-20 overflow-hidden rounded-full bg-v-highlight" aria-hidden>
              <span className="block h-full rounded-full bg-v-accent" style={{ width: `${Math.round(d.confidence * 100)}%` }} />
            </span>
            <span className="tabular font-semibold text-v-ink">{Math.round(d.confidence * 100)}%</span>
          </div>
        </div>
      </div>

      {flags.length && canAct ? (
        <ul className="mt-4 space-y-1 rounded-xl bg-v-warn-soft p-3 text-sm text-v-warn">
          {flags.map((f) => (
            <li key={f}>⚑ {plainFlag(f)}</li>
          ))}
        </ul>
      ) : null}

      <Section label="Why">
        <ul className="space-y-2 text-sm text-v-ink">
          {reasons.map((r, i) => (
            <li key={i} className="flex gap-2">
              <span aria-hidden className="mt-1.5 size-1.5 shrink-0 rounded-full bg-v-accent" />
              <span>{r}</span>
            </li>
          ))}
        </ul>
        {d.reasoning.length > 3 ? (
          <button type="button" onClick={() => setAllReasons((v) => !v)} className="mt-2 text-sm font-medium text-v-accent hover:underline" aria-expanded={allReasons}>
            {allReasons ? 'Show less' : `Show full reasoning (${d.reasoning.length} steps)`}
          </button>
        ) : null}
      </Section>

      {d.evidence.length ? (
        <Section label="Evidence Verdict will use">
          <ul className="flex flex-wrap gap-2">
            {d.evidence.map((e) => (
              <li key={`${e.type}-${e.recordId}`} title={e.whyItHelps} className="rounded-lg border border-v-border bg-v-raised px-2.5 py-1 text-sm text-v-ink">
                ✓ {EVIDENCE_LABEL[e.type] ?? e.type}
                {showSources ? <code className="ml-1.5 text-[11px] text-v-muted">{e.recordId}</code> : null}
              </li>
            ))}
          </ul>
        </Section>
      ) : null}

      {d.risks.length ? (
        <details className="mt-5">
          <summary className="cursor-pointer text-xs font-semibold uppercase tracking-wide text-v-faint hover:text-v-ink">Risks to know ({d.risks.length})</summary>
          <ul className="mt-2 list-disc space-y-1 pl-5 text-sm text-v-muted">
            {d.risks.map((r, i) => (
              <li key={i}>{r}</li>
            ))}
          </ul>
        </details>
      ) : null}

      <Section label="Message to the buyer">
        <blockquote className="rounded-xl border-l-2 border-v-accent bg-v-raised p-3 text-sm text-v-ink">{d.draftMessageToBuyer}</blockquote>
      </Section>

      <HowDecided payload={dec!.payload} />

      {decided ? (
        <p className="mt-5 text-sm text-v-muted" suppressHydrationWarning>
          {dec!.status === 'executed' ? 'Approved' : dec!.status === 'escalated' ? 'Kept for manual handling' : dec!.status} by {dec!.decided_by ?? 'the owner'}
          {dec!.executed_at ? ` on ${new Date(dec!.executed_at).toLocaleString()}` : ''}.
        </p>
      ) : null}

      {canAct ? (
        <div className="mt-6 border-t border-v-border pt-5">
          <div className="flex flex-wrap gap-2">
            {d.action !== 'escalate_to_human' ? (
              <Button size="lg" onClick={() => execute({ mode: 'approve' })} disabled={busy !== null}>
                {busy === 'execute' ? 'Sending to PayPal…' : `Approve: ${ACTION_SHORT[d.action].toLowerCase()}`}
              </Button>
            ) : null}
            {d.action === 'accept' || d.action === 'offer_refund' ? (
              <Button variant="secondary" size="lg" onClick={() => setPanel(panel === 'edit' ? null : 'edit')} aria-expanded={panel === 'edit'}>
                Edit amount or message
              </Button>
            ) : null}
            <Button variant={d.action === 'escalate_to_human' ? 'primary' : 'secondary'} size="lg" onClick={() => setPanel(panel === 'override' ? null : 'override')} aria-expanded={panel === 'override'}>
              {d.action === 'escalate_to_human' ? 'Choose a response' : 'Do something else'}
            </Button>
          </div>

          {panel === 'edit' ? (
            <form
              className="mt-4 grid gap-3 rounded-xl border border-v-border bg-v-raised p-4"
              onSubmit={(ev) => {
                ev.preventDefault();
                execute({ mode: 'edit', amount: Number(amount), message });
              }}
            >
              <label className="grid gap-1 text-sm">
                <span className="text-v-muted">Amount (up to {usd(cf.dispute.amount)})</span>
                <input type="number" step="0.01" min="0.01" max={cf.dispute.amount} required value={amount} onChange={(e) => setAmount(e.target.value)} className="w-40 rounded-lg border border-v-border bg-v-surface px-3 py-1.5 tabular" />
              </label>
              <label className="grid gap-1 text-sm">
                <span className="text-v-muted">Message to the buyer</span>
                <textarea rows={3} value={message} onChange={(e) => setMessage(e.target.value)} className="rounded-lg border border-v-border bg-v-surface px-3 py-2" />
              </label>
              <div>
                <Button type="submit" disabled={busy !== null}>
                  Approve with my changes
                </Button>
              </div>
            </form>
          ) : null}

          {panel === 'override' ? (
            <form
              className="mt-4 grid gap-3 rounded-xl border border-v-border bg-v-raised p-4"
              onSubmit={(ev) => {
                ev.preventDefault();
                const needsAmount = overrideAction === 'accept' || overrideAction === 'offer_refund';
                execute({ mode: 'override', action: overrideAction, amount: needsAmount ? Number(amount || cf.dispute.amount) : null });
              }}
            >
              <fieldset className="grid gap-2 text-sm">
                <legend className="mb-1 text-v-muted">What should Verdict send to PayPal?</legend>
                {choices.map((a) => (
                  <label key={a} className="flex items-center gap-2">
                    <input type="radio" name="override" value={a} checked={overrideAction === a} onChange={() => setOverrideAction(a)} />
                    {ACTION_SHORT[a]}
                  </label>
                ))}
              </fieldset>
              {overrideAction === 'accept' || overrideAction === 'offer_refund' ? (
                <label className="grid gap-1 text-sm">
                  <span className="text-v-muted">Amount</span>
                  <input type="number" step="0.01" min="0.01" max={cf.dispute.amount} required value={amount || String(cf.dispute.amount)} onChange={(e) => setAmount(e.target.value)} className="w-40 rounded-lg border border-v-border bg-v-surface px-3 py-1.5 tabular" />
                </label>
              ) : null}
              <div>
                <Button type="submit" variant="dark" disabled={busy !== null}>
                  Send to PayPal
                </Button>
              </div>
            </form>
          ) : null}
          <p className="mt-3 text-xs text-v-muted">
            {mode === 'replay'
              ? 'REPLAY: this acts on recorded sandbox data using the transitions PayPal showed us. Nothing is sent to PayPal.'
              : 'Verdict re-checks the dispute with PayPal right before acting. Nothing happens without your click.'}
          </p>
        </div>
      ) : null}

      {!resolved && decided ? (
        <Button variant="ghost" size="sm" className="mt-4" onClick={recommend} disabled={busy !== null}>
          {busy === 'recommend' ? 'Reviewing…' : 'Ask Verdict again'}
        </Button>
      ) : null}
      {error ? (
        <p role="alert" className="mt-3 text-sm text-v-danger">
          {error}
        </p>
      ) : null}
    </Card>
  );
}

// --- Page -------------------------------------------------------------------------------------------

export function CaseFileView({ cf, mode }: { cf: CaseFile; mode: AppMode }) {
  const now = useNow(30_000, cf.asOf);
  const [showSources, setShowSources] = useState(false);
  const r = cf.dispute;
  const deadline = computeDeadline(r.dueAt, now);
  const outcomeText = r.state === 'Resolved' ? r.outcome : null;
  return (
    <div className="flex-1">
      <div className="border-b border-v-border bg-v-surface px-6 py-5">
        <nav aria-label="Breadcrumb" className="mb-2 text-sm text-v-muted">
          <Link href="/war-room" className="hover:text-v-ink hover:underline">
            War Room
          </Link>{' '}
          / Case
        </nav>
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight text-v-ink">
              {r.reason} · <span className="tabular">{usd(r.amount)}</span>
            </h1>
            <p className="mt-1 text-sm text-v-muted">
              {r.customer} · order {r.orderId} · {r.stage === 'Chargeback' ? 'chargeback (bank-level claim)' : 'PayPal inquiry'} · <span className="font-mono text-xs">PayPal case {r.id}</span>
            </p>
          </div>
          {r.dueAt ? (
            <div className="flex items-center gap-3 rounded-xl px-4 py-2.5" style={{ background: URGENCY[deadline.bucket].soft }}>
              <DeadlineRing dueAt={r.dueAt} now={now} size={44} />
              <div>
                <p className="text-xs text-v-muted">Respond within</p>
                <p className="text-lg font-semibold tabular" style={{ color: URGENCY[deadline.bucket].color }}>
                  {formatRemaining(deadline.msRemaining)}
                </p>
              </div>
            </div>
          ) : outcomeText ? (
            <Badge tone={r.outcome === 'Won' ? 'win' : 'muted'} className="px-3 py-1 text-sm">
              {outcomeText}
            </Badge>
          ) : null}
        </div>
        <Progress status={cf.raw.status} outcome={outcomeText} />
      </div>

      <div className="grid gap-5 p-6 lg:grid-cols-12">
        <div className="space-y-5 lg:col-span-7">
          <Recommendation cf={cf} mode={mode} showSources={showSources} />
          <Card title="What the buyer says" right={<Badge>written by the buyer</Badge>}>
            {cf.raw.buyerClaim ? <blockquote className="whitespace-pre-wrap text-sm text-v-ink">“{cf.raw.buyerClaim}”</blockquote> : <p className="text-sm text-v-muted">The buyer didn’t write a description.</p>}
          </Card>
          <Card title="History">
            <Timeline items={cf.timeline} />
          </Card>
        </div>

        <div className="space-y-5 lg:col-span-5">
          <Card
            title="Your evidence"
            subtitle={cf.raw.requestedEvidence.length ? `PayPal asked for ${cf.raw.requestedEvidence.map((t) => t.replace(/_/g, ' ').toLowerCase()).join(', ')}.` : undefined}
            right={
              <button type="button" onClick={() => setShowSources((v) => !v)} className="text-xs font-medium text-v-accent hover:underline" aria-pressed={showSources}>
                {showSources ? 'Hide sources' : 'Show sources'}
              </button>
            }
          >
            <div className="flex justify-center">
              <StrengthGauge value={cf.packet.strength} rating={cf.packet.rating} />
            </div>
            {cf.packet.items.length ? (
              <ul className="mt-3 divide-y divide-v-border">
                {cf.packet.items.map((i) => (
                  <li key={i.id} className="flex gap-3 py-2.5 text-sm">
                    <span aria-hidden className={`mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-full text-xs font-bold ${i.helps ? 'bg-v-win-soft text-v-win' : 'bg-v-danger-soft text-v-danger'}`}>
                      {i.helps ? '✓' : '!'}
                    </span>
                    <span className="min-w-0">
                      <span className="block font-medium text-v-ink">
                        <span className="sr-only">{i.helps ? 'Helps: ' : 'Hurts: '}</span>
                        {EVIDENCE_LABEL[i.kind] ?? i.kind}
                      </span>
                      <span className="block text-v-muted">{i.summary}</span>
                      {showSources ? (
                        <code className="text-[11px] text-v-faint">
                          source: {i.recordTable}/{i.recordId}
                        </code>
                      ) : null}
                    </span>
                  </li>
                ))}
              </ul>
            ) : null}
            {cf.packet.gaps.length ? (
              <div className="mt-3 rounded-xl bg-v-highlight p-3">
                <p className="text-xs font-semibold uppercase tracking-wide text-v-faint">Missing</p>
                <ul className="mt-1 list-disc pl-5 text-sm text-v-muted">
                  {cf.packet.gaps.map((g) => (
                    <li key={g}>{g}</li>
                  ))}
                </ul>
              </div>
            ) : null}
          </Card>

          <Card title="Order">
            {cf.order ? (
              <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 text-sm">
                <dt className="text-v-muted">Placed</dt>
                <dd className="text-v-ink" suppressHydrationWarning>
                  {cf.order.id} · {new Date(cf.order.createdAt).toLocaleDateString()}
                </dd>
                <dt className="text-v-muted">Items</dt>
                <dd className="text-v-ink">{cf.order.items.map((i) => `${i.qty} × ${i.name}`).join(', ')}</dd>
                <dt className="text-v-muted">Ship to</dt>
                <dd className="text-v-ink">
                  {cf.order.shipTo.city}, {cf.order.shipTo.region} {cf.order.shipTo.postal}
                </dd>
                {cf.shipment ? (
                  <>
                    <dt className="text-v-muted">Carrier</dt>
                    <dd className="text-v-ink">
                      {cf.shipment.carrier}
                      {cf.shipment.tracking ? <span className="block font-mono text-xs text-v-muted">{cf.shipment.tracking}</span> : ' · no tracking'}
                    </dd>
                    <dt className="text-v-muted">Status</dt>
                    <dd className="text-v-ink capitalize">
                      {cf.shipment.status.replace(/_/g, ' ').toLowerCase()}
                      {cf.shipment.signedBy ? ` · signed by ${cf.shipment.signedBy}` : ''}
                    </dd>
                  </>
                ) : null}
                {cf.order.note ? (
                  <>
                    <dt className="text-v-muted">Note</dt>
                    <dd className="text-v-ink">{cf.order.note}</dd>
                  </>
                ) : null}
              </dl>
            ) : (
              <p className="text-sm text-v-warn">No order in your store matches this PayPal payment. Check it before responding.</p>
            )}
          </Card>

          {cf.customer ? (
            <Card title="Customer">
              <p className="text-sm font-medium text-v-ink">{cf.customer.name}</p>
              <p className="text-sm text-v-muted" suppressHydrationWarning>
                {cf.customer.city}, {cf.customer.region} · {cf.customer.orders} order{cf.customer.orders === 1 ? '' : 's'} · customer since {new Date(cf.customer.firstSeen).toLocaleDateString()}
              </p>
            </Card>
          ) : null}
        </div>
      </div>
    </div>
  );
}
