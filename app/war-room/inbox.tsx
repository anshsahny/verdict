'use client';

// The top of the War Room: what needs the merchant today, in plain language, one card per dispute
// waiting on them, plus a first-visit welcome. The analytics (AG Studio) sit below this.

import { useEffect, useState } from 'react';
import { DeadlineRing, URGENCY, useNow } from '@/components/viz';
import { Badge, ButtonLink, Card, usd, type Tone } from '@/components/ui';
import { computeDeadline, formatRemaining } from '@/lib/disputes/deadline';

export type InboxItem = {
  id: string;
  reason: string;
  amount: number;
  customer: string;
  dueAt: string | null;
  rating: string;
  recommendation: { action: string; amount: number | null; status: string; summary: string } | null;
};
export type RecentItem = { id: string; reason: string; amount: number; outcome: string; won: boolean; closedAt: string };

const SUGGEST: Record<string, (amount: number | null) => string> = {
  accept: (a) => `Refund ${usd(a)} in full`,
  offer_refund: (a) => `Offer a ${usd(a)} partial refund`,
  contest: () => 'Contest with your evidence',
  escalate_to_human: () => 'Needs your judgment',
};
const RATING_TONE: Record<string, Tone> = { strong: 'win', moderate: 'warn', weak: 'danger', none: 'muted' };

export function Welcome() {
  const [show, setShow] = useState(false);
  useEffect(() => {
    try {
      setShow(localStorage.getItem('verdict-welcome-dismissed') !== '1');
    } catch {
      setShow(true);
    }
  }, []);
  if (!show) return null;
  const dismiss = () => {
    try {
      localStorage.setItem('verdict-welcome-dismissed', '1');
    } catch {
      /* fine: it just shows again next time */
    }
    setShow(false);
  };
  const steps = [
    ['Watches PayPal', 'Every new dispute arrives here within seconds, with its response deadline.'],
    ['Builds your case', 'Verdict reads the order, tracking, customer history and your Playbook, then drafts a response with the evidence.'],
    ['You decide', 'Approve, edit or override with one click. Nothing is sent to PayPal without you.'],
  ];
  return (
    <section className="relative overflow-hidden rounded-2xl border border-v-border bg-gradient-to-br from-v-info-soft to-v-surface p-6" aria-labelledby="welcome-title">
      <button type="button" onClick={dismiss} className="absolute right-4 top-4 rounded-md px-2 text-lg text-v-muted hover:bg-v-highlight hover:text-v-ink" aria-label="Dismiss welcome">
        ×
      </button>
      <h2 id="welcome-title" className="text-lg font-semibold text-v-ink">
        Your AI dispute clerk for PayPal
      </h2>
      <p className="mt-1 max-w-2xl text-sm text-v-muted">Small shops lose disputes they should win: deadlines slip and evidence is thin. Verdict handles the busywork; you keep the final say.</p>
      <ol className="mt-5 grid gap-4 sm:grid-cols-3">
        {steps.map(([t, d], i) => (
          <li key={t} className="flex gap-3">
            <span className="flex size-7 shrink-0 items-center justify-center rounded-full bg-v-accent text-sm font-bold text-v-accent-ink" aria-hidden>
              {i + 1}
            </span>
            <div>
              <p className="text-sm font-semibold text-v-ink">{t}</p>
              <p className="text-sm text-v-muted">{d}</p>
            </div>
          </li>
        ))}
      </ol>
    </section>
  );
}

export function Inbox({ items, recent, asOf }: { items: InboxItem[]; recent: RecentItem[]; asOf: string }) {
  const now = useNow(30_000, asOf);
  return (
    <div className="grid gap-5 xl:grid-cols-3">
      <Card
        className="xl:col-span-2"
        padded={false}
        title="Needs your decision"
        subtitle={items.length ? 'Soonest deadline first. Open a case to see Verdict’s reasoning and evidence.' : undefined}
        right={items.length ? <Badge tone="accent">{items.length} waiting</Badge> : null}
      >
        {items.length ? (
          <ul className="divide-y divide-v-border border-t border-v-border">
            {items.map((it) => {
              const d = computeDeadline(it.dueAt, now);
              const rec = it.recommendation;
              return (
                <li key={it.id} className="flex flex-wrap items-center gap-4 px-5 py-4 sm:flex-nowrap">
                  <div className="flex w-28 shrink-0 items-center gap-2.5">
                    <DeadlineRing dueAt={it.dueAt} now={now} size={36} />
                    <div>
                      <p className="text-sm font-semibold tabular" style={{ color: URGENCY[d.bucket].color }}>
                        {it.dueAt ? formatRemaining(d.msRemaining) : '—'}
                      </p>
                      <p className="text-[11px] text-v-muted">to respond</p>
                    </div>
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-semibold text-v-ink">
                      {it.reason} · <span className="tabular">{usd(it.amount)}</span>
                      <span className="font-normal text-v-muted"> · {it.customer}</span>
                    </p>
                    <p className="mt-0.5 truncate text-sm text-v-muted">
                      {rec ? (
                        <>
                          <span className={rec.action === 'escalate_to_human' ? 'font-medium text-v-warn' : 'font-medium text-v-ink'}>{SUGGEST[rec.action]?.(rec.amount) ?? rec.action}</span>
                          {rec.summary ? <> · {rec.summary}</> : null}
                        </>
                      ) : (
                        'Not reviewed yet. Verdict can review it in about 10 seconds.'
                      )}
                    </p>
                  </div>
                  <div className="flex items-center gap-3">
                    <Badge tone={RATING_TONE[it.rating] ?? 'muted'}>{it.rating === 'none' ? 'no evidence' : `${it.rating} evidence`}</Badge>
                    <ButtonLink href={`/disputes/${it.id}`} size="sm" variant={rec ? 'primary' : 'secondary'}>
                      {rec ? 'Review' : 'Open'}
                    </ButtonLink>
                  </div>
                </li>
              );
            })}
          </ul>
        ) : (
          <div className="border-t border-v-border px-5 py-10 text-center">
            <p className="text-sm font-semibold text-v-ink">You’re all caught up</p>
            <p className="mt-1 text-sm text-v-muted">New PayPal disputes appear here within seconds.</p>
          </div>
        )}
      </Card>
      <Card title="Recently closed" padded>
        {recent.length ? (
          <ul className="space-y-3">
            {recent.map((r) => (
              <li key={r.id}>
                <a href={`/disputes/${r.id}`} className="flex items-center justify-between gap-3 rounded-lg px-1 py-1 hover:bg-v-highlight">
                  <span className="min-w-0">
                    <span className="block truncate text-sm font-medium text-v-ink">
                      {r.reason} · <span className="tabular">{usd(r.amount)}</span>
                    </span>
                  </span>
                  <Badge tone={r.won ? 'win' : 'muted'}>{r.won ? 'Won' : r.outcome}</Badge>
                </a>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-sm text-v-muted">No closed disputes yet.</p>
        )}
      </Card>
    </div>
  );
}
