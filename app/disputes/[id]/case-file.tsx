'use client';

// The Case File: everything about one dispute, the agent's recommendation, and the owner's
// Approve / Edit / Override. Every PayPal action goes through /api/decisions/[id]/execute.

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState, type ReactNode } from 'react';
import { DeadlineRing, StrengthGauge, Timeline, URGENCY, useNow } from '@/components/viz';
import { computeDeadline, formatRemaining } from '@/lib/disputes/deadline';
import type { AppMode } from '@/lib/mode';
import type { CaseFile } from '@/lib/views/disputes';

const ACTION_TEXT: Record<string, string> = {
  accept: 'Refund in full',
  offer_refund: 'Offer a partial refund',
  contest: 'Contest with evidence',
  escalate_to_human: 'Handle it yourself',
};
const usd = (n: number | null | undefined) => (n == null ? '—' : `$${n.toFixed(2)}`);

function Card({ title, children, right, className = '' }: { title: string; children: ReactNode; right?: ReactNode; className?: string }) {
  return (
    <section className={`rounded-xl border border-v-border bg-v-surface p-5 ${className}`} aria-label={title}>
      <div className="mb-3 flex items-center justify-between gap-2">
        <h2 className="text-sm font-semibold text-v-ink">{title}</h2>
        {right}
      </div>
      {children}
    </section>
  );
}

function Pill({ tone, children }: { tone: 'win' | 'warn' | 'danger' | 'muted' | 'sim' | 'accent'; children: ReactNode }) {
  const map = {
    win: 'bg-v-win-soft text-v-win',
    warn: 'bg-v-warn-soft text-v-warn',
    danger: 'bg-v-danger-soft text-v-danger',
    muted: 'bg-v-highlight text-v-muted',
    sim: 'bg-v-sim-soft text-v-sim',
    accent: 'bg-v-info-soft text-v-accent',
  };
  return <span className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-semibold ${map[tone]}`}>{children}</span>;
}

// --- Recommendation and owner actions -------------------------------------------------------------

function Recommendation({ cf, mode }: { cf: CaseFile; mode: AppMode }) {
  const router = useRouter();
  const [busy, setBusy] = useState<null | 'recommend' | 'execute'>(null);
  const [error, setError] = useState<string | null>(null);
  const [panel, setPanel] = useState<null | 'edit' | 'override'>(null);
  const dec = cf.decision;
  const d = dec?.payload.decision ?? null;
  const resolved = cf.raw.status === 'RESOLVED';
  const decided = dec && !['proposed', 'needs_human'].includes(dec.status);
  const [amount, setAmount] = useState<string>(d?.amount != null ? String(d.amount) : '');
  const [message, setMessage] = useState<string>(d?.draftMessageToBuyer ?? '');
  const [overrideAction, setOverrideAction] = useState<string>(cf.raw.availableActions.find((a) => a !== d?.action) ?? 'accept');

  async function call(url: string, body?: unknown) {
    setError(null);
    const res = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined });
    const json = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(json.error ?? json.status ?? `Request failed (${res.status})`);
    return json;
  }
  async function recommend() {
    setBusy('recommend');
    try {
      await call(`/api/disputes/${cf.dispute.id}/recommend`);
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
      if (r.status === 'failed') setError(`PayPal refused: ${r.error}`);
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
      <Card title="Verdict's recommendation">
        <p className="text-sm text-v-muted">
          {resolved ? 'This dispute is closed.' : "Verdict hasn't reviewed this dispute yet. It reads the order, tracking, customer history and your playbook, then proposes a response. Nothing is sent to PayPal until you approve."}
        </p>
        {!resolved ? (
          <button type="button" onClick={recommend} disabled={busy !== null} className="mt-4 rounded-md bg-v-accent px-4 py-2 text-sm font-semibold text-v-accent-ink disabled:opacity-60">
            {busy === 'recommend' ? 'Investigating… (about 10 seconds)' : 'Ask Verdict to review'}
          </button>
        ) : null}
        {error ? <p role="alert" className="mt-3 text-sm text-v-danger">{error}</p> : null}
      </Card>
    );
  }

  const flags = dec!.payload.validation.flags;
  const canAct = !resolved && !decided;
  return (
    <Card
      title="Verdict's recommendation"
      right={
        <span className="flex items-center gap-2">
          {dec!.status === 'needs_human' ? <Pill tone="warn">Needs your judgment</Pill> : null}
          {decided ? <Pill tone={dec!.status === 'failed' ? 'danger' : 'win'}>{dec!.status === 'executed' ? 'Approved' : dec!.status}</Pill> : null}
        </span>
      }
    >
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <p className="text-lg font-semibold text-v-ink">
          {ACTION_TEXT[d.action]}
          {d.amount != null ? <span className="tabular"> · {usd(d.amount)}</span> : null}
        </p>
        <span className="text-sm text-v-muted tabular">confidence {Math.round(d.confidence * 100)}%</span>
      </div>

      {flags.length ? (
        <ul className="mt-3 space-y-1 rounded-lg bg-v-warn-soft p-3 text-sm text-v-warn">
          {flags.map((f) => (
            <li key={f}>⚑ {f}</li>
          ))}
        </ul>
      ) : null}

      <h3 className="mt-4 text-xs font-semibold uppercase tracking-wide text-v-faint">Reasoning</h3>
      <ol className="mt-1 list-decimal space-y-1.5 pl-5 text-sm text-v-ink">
        {d.reasoning.map((r, i) => (
          <li key={i}>{r}</li>
        ))}
      </ol>

      {d.evidence.length ? (
        <>
          <h3 className="mt-4 text-xs font-semibold uppercase tracking-wide text-v-faint">Evidence cited</h3>
          <ul className="mt-1 space-y-1 text-sm">
            {d.evidence.map((e) => (
              <li key={`${e.type}-${e.recordId}`} className="flex gap-2">
                <code className="shrink-0 rounded bg-v-highlight px-1.5 py-0.5 text-[11px] text-v-muted">{e.recordId}</code>
                <span className="text-v-ink">{e.whyItHelps}</span>
              </li>
            ))}
          </ul>
        </>
      ) : null}

      {d.risks.length ? (
        <>
          <h3 className="mt-4 text-xs font-semibold uppercase tracking-wide text-v-faint">Risks</h3>
          <ul className="mt-1 list-disc space-y-1 pl-5 text-sm text-v-muted">
            {d.risks.map((r, i) => (
              <li key={i}>{r}</li>
            ))}
          </ul>
        </>
      ) : null}

      <h3 className="mt-4 text-xs font-semibold uppercase tracking-wide text-v-faint">Message to the buyer</h3>
      <blockquote className="mt-1 rounded-lg border-l-2 border-v-accent bg-v-raised p-3 text-sm text-v-ink">{d.draftMessageToBuyer}</blockquote>

      {decided ? (
        <p className="mt-4 text-sm text-v-muted" suppressHydrationWarning>
          {dec!.decided_by ? `${dec!.decided_by} · ` : ''}
          {dec!.executed_at ? new Date(dec!.executed_at).toLocaleString() : ''} · result: {JSON.stringify((dec!.result as { paypalAction?: string })?.paypalAction ?? dec!.status)}
        </p>
      ) : null}

      {canAct ? (
        <div className="mt-5 border-t border-v-border pt-4">
          <div className="flex flex-wrap gap-2">
            {d.action !== 'escalate_to_human' ? (
              <button type="button" onClick={() => execute({ mode: 'approve' })} disabled={busy !== null} className="rounded-md bg-v-accent px-4 py-2 text-sm font-semibold text-v-accent-ink disabled:opacity-60">
                {busy === 'execute' ? 'Sending to PayPal…' : `Approve: ${ACTION_TEXT[d.action].toLowerCase()}`}
              </button>
            ) : null}
            {d.action === 'accept' || d.action === 'offer_refund' ? (
              <button type="button" onClick={() => setPanel(panel === 'edit' ? null : 'edit')} aria-expanded={panel === 'edit'} className="rounded-md border border-v-border px-4 py-2 text-sm font-medium text-v-ink hover:bg-v-highlight">
                Edit
              </button>
            ) : null}
            <button type="button" onClick={() => setPanel(panel === 'override' ? null : 'override')} aria-expanded={panel === 'override'} className="rounded-md border border-v-border px-4 py-2 text-sm font-medium text-v-ink hover:bg-v-highlight">
              Override
            </button>
          </div>

          {panel === 'edit' ? (
            <form
              className="mt-4 grid gap-3"
              onSubmit={(ev) => {
                ev.preventDefault();
                execute({ mode: 'edit', amount: Number(amount), message });
              }}
            >
              <label className="grid gap-1 text-sm">
                <span className="text-v-muted">Amount (USD, max {usd(cf.dispute.amount)})</span>
                <input type="number" step="0.01" min="0.01" max={cf.dispute.amount} required value={amount} onChange={(e) => setAmount(e.target.value)} className="w-40 rounded-md border border-v-border bg-v-surface px-3 py-1.5 tabular" />
              </label>
              <label className="grid gap-1 text-sm">
                <span className="text-v-muted">Message to the buyer</span>
                <textarea rows={3} value={message} onChange={(e) => setMessage(e.target.value)} className="rounded-md border border-v-border bg-v-surface px-3 py-2" />
              </label>
              <div>
                <button type="submit" disabled={busy !== null} className="rounded-md bg-v-accent px-4 py-2 text-sm font-semibold text-v-accent-ink disabled:opacity-60">
                  Approve edited response
                </button>
              </div>
            </form>
          ) : null}

          {panel === 'override' ? (
            <form
              className="mt-4 grid gap-3"
              onSubmit={(ev) => {
                ev.preventDefault();
                const needsAmount = overrideAction === 'accept' || overrideAction === 'offer_refund';
                execute({ mode: 'override', action: overrideAction, amount: needsAmount ? Number(amount || cf.dispute.amount) : null });
              }}
            >
              <fieldset className="grid gap-1 text-sm">
                <legend className="mb-1 text-v-muted">Instead, do this</legend>
                {cf.raw.availableActions
                  .filter((a) => a !== 'escalate_to_human')
                  .map((a) => (
                    <label key={a} className="flex items-center gap-2">
                      <input type="radio" name="override" value={a} checked={overrideAction === a} onChange={() => setOverrideAction(a)} />
                      {ACTION_TEXT[a]}
                    </label>
                  ))}
              </fieldset>
              {overrideAction === 'accept' || overrideAction === 'offer_refund' ? (
                <label className="grid gap-1 text-sm">
                  <span className="text-v-muted">Amount (USD)</span>
                  <input type="number" step="0.01" min="0.01" max={cf.dispute.amount} required value={amount || String(cf.dispute.amount)} onChange={(e) => setAmount(e.target.value)} className="w-40 rounded-md border border-v-border bg-v-surface px-3 py-1.5 tabular" />
                </label>
              ) : null}
              <div>
                <button type="submit" disabled={busy !== null} className="rounded-md bg-v-ink px-4 py-2 text-sm font-semibold text-v-canvas disabled:opacity-60">
                  Override and send to PayPal
                </button>
              </div>
            </form>
          ) : null}
          <p className="mt-3 text-xs text-v-faint">
            {mode === 'replay'
              ? 'REPLAY: this acts on recorded sandbox data with the transitions PayPal showed us. Nothing is sent to PayPal.'
              : 'Verdict re-checks the dispute with PayPal before acting. Nothing happens without your click.'}
          </p>
        </div>
      ) : null}

      {!resolved && decided ? (
        <button type="button" onClick={recommend} disabled={busy !== null} className="mt-4 text-sm font-medium text-v-accent hover:underline">
          {busy === 'recommend' ? 'Investigating…' : 'Ask Verdict again'}
        </button>
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
  const r = cf.dispute;
  const deadline = computeDeadline(r.dueAt, now);
  const outcomeTone = r.outcome === 'Won' ? 'win' : r.state === 'Resolved' ? 'danger' : 'muted';
  return (
    <div className="flex-1">
      <div className="border-b border-v-border bg-v-surface px-6 py-4">
        <nav aria-label="Breadcrumb" className="mb-1 text-xs text-v-muted">
          <Link href="/war-room" className="hover:text-v-ink hover:underline">
            War Room
          </Link>{' '}
          / <span className="font-mono">{r.id}</span>
        </nav>
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div>
            <h1 className="text-xl font-semibold tracking-tight text-v-ink">
              {r.reason} · <span className="tabular">{usd(r.amount)}</span>
            </h1>
            <div className="mt-1.5 flex flex-wrap items-center gap-2">
              <Pill tone="accent">{r.stage}</Pill>
              <Pill tone={r.state === 'Resolved' ? outcomeTone : 'muted'}>{r.state === 'Resolved' ? r.outcome : r.status}</Pill>
              <span className="text-sm text-v-muted">
                {r.customer} · order {r.orderId}
              </span>
            </div>
          </div>
          {r.dueAt ? (
            <div className="flex items-center gap-3 rounded-lg px-3 py-2" style={{ background: URGENCY[deadline.bucket].soft }}>
              <DeadlineRing dueAt={r.dueAt} now={now} size={44} />
              <div>
                <p className="text-xs text-v-muted">Respond within</p>
                <p className="text-lg font-semibold tabular" style={{ color: URGENCY[deadline.bucket].color }}>
                  {formatRemaining(deadline.msRemaining)}
                </p>
              </div>
            </div>
          ) : null}
        </div>
      </div>

      <div className="grid gap-5 p-6 lg:grid-cols-12">
        <div className="space-y-5 lg:col-span-7">
          <Recommendation cf={cf} mode={mode} />
          <Card title="What the buyer says" right={<Pill tone="muted">buyer-written, untrusted</Pill>}>
            {cf.raw.buyerClaim ? <blockquote className="whitespace-pre-wrap text-sm text-v-ink">“{cf.raw.buyerClaim}”</blockquote> : <p className="text-sm text-v-muted">The buyer didn&apos;t write a description.</p>}
          </Card>
          <Card title="Timeline">
            <Timeline items={cf.timeline} />
          </Card>
        </div>

        <div className="space-y-5 lg:col-span-5">
          <Card title="Evidence" right={cf.raw.requestedEvidence.length ? <span className="text-xs text-v-muted">PayPal asked for: {cf.raw.requestedEvidence.map((t) => t.replace(/_/g, ' ').toLowerCase()).join(', ')}</span> : null}>
            <div className="flex justify-center">
              <StrengthGauge value={cf.packet.strength} rating={cf.packet.rating} />
            </div>
            {cf.packet.items.length ? (
              <ul className="mt-3 divide-y divide-v-border">
                {cf.packet.items.map((i) => (
                  <li key={i.id} className="flex gap-3 py-2 text-sm">
                    <span aria-hidden className={`mt-0.5 font-bold ${i.helps ? 'text-v-win' : 'text-v-danger'}`}>
                      {i.helps ? '✓' : '✗'}
                    </span>
                    <span className="min-w-0">
                      <span className="sr-only">{i.helps ? 'Helps:' : 'Hurts:'} </span>
                      <span className="text-v-ink">{i.summary}</span>
                      <code className="ml-1 text-[11px] text-v-faint">
                        [{i.recordTable}:{i.recordId}]
                      </code>
                    </span>
                  </li>
                ))}
              </ul>
            ) : null}
            {cf.packet.gaps.length ? (
              <div className="mt-3 rounded-lg bg-v-highlight p-3">
                <p className="text-xs font-semibold uppercase tracking-wide text-v-faint">Missing</p>
                <ul className="mt-1 list-disc pl-5 text-sm text-v-muted">
                  {cf.packet.gaps.map((g) => (
                    <li key={g}>{g}</li>
                  ))}
                </ul>
              </div>
            ) : null}
          </Card>

          <Card title="Order and shipment">
            {cf.order ? (
              <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5 text-sm">
                <dt className="text-v-muted">Order</dt>
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
                      {cf.shipment.tracking ? <code className="ml-1 text-xs text-v-muted">{cf.shipment.tracking}</code> : ' (no tracking)'}
                    </dd>
                    <dt className="text-v-muted">Status</dt>
                    <dd className="text-v-ink">
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
              <p className="text-sm text-v-warn">No store order matches this PayPal transaction.</p>
            )}
          </Card>

          {cf.customer ? (
            <Card title="Customer">
              <p className="text-sm text-v-ink">{cf.customer.name}</p>
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
