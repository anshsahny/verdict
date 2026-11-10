'use client';

// The Arena page: launch simulated buyers against Verdict and watch each round stream in, the
// benchmark in AG Studio, the weak spots, and the policy slider. Every outcome is SIMULATED.

import { useRouter } from 'next/navigation';
import { useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { AgStudio, AgStudioProvider } from 'ag-studio-react';
import { PageHeader } from '@/components/page-header';
import type { PolicyProjection } from '@/lib/arena/benchmark';
import type { ArenaEvent } from '@/lib/arena/run';
import { ARENA_REPORT, arenaData, type ArenaRow } from '@/lib/ui/arena-report';
import { verdictStudioTheme } from '@/lib/ui/studio-theme';

type Bench = { runs: number; rightCallRate: number; contestWinRate: number | null; saved: number; escalated: number; avgDecisionSec: number; avgCostUsd: number; weakSpots: string[]; live: number };
type LiveRound = { id: string; label: string; claim?: string; decision?: string; flagged?: boolean; reply?: string; outcome?: string; right?: boolean };

const noSubscription = () => () => {};
const pct = (x: number | null) => (x === null ? 'n/a' : `${Math.round(x * 100)}%`);
const usd = (x: number) => `$${x.toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`;
const ACTION: Record<string, string> = { accept: 'refund in full', offer_refund: 'partial refund offer', contest: 'contest with evidence', escalate_to_human: 'send to a human', invalid: 'no valid decision' };

function SimulatedBadge() {
  return (
    <span className="inline-flex items-center gap-1.5 rounded-full bg-v-sim-soft px-2.5 py-0.5 text-xs font-bold tracking-wide text-v-sim" title="Outcomes come from a rule-based stand-in for PayPal's reviewers">
      SIMULATED
    </span>
  );
}

function PolicySlider({ policy }: { policy: PolicyProjection[] }) {
  const [i, setI] = useState(0);
  const p = policy[i];
  const agentOnly = policy[0];
  const maxSaved = Math.max(...policy.map((x) => x.savedVsAlwaysRefundUsd), 1);
  return (
    <section className="rounded-2xl border border-v-border bg-v-surface p-5 shadow-[0_1px_2px_rgba(16,24,40,0.04)]" aria-labelledby="policy-title">
      <div className="flex items-center justify-between gap-2">
        <h2 id="policy-title" className="text-sm font-semibold text-v-ink">
          Policy: auto-refund small disputes
        </h2>
        <SimulatedBadge />
      </div>
      <p className="mt-1 text-sm text-v-muted">Refund every dispute under a threshold without review, and let Verdict handle the rest. Recomputed from the stored runs: no model calls.</p>
      <label htmlFor="threshold" className="mt-4 block text-sm text-v-ink">
        Auto-refund under <strong className="tabular">{usd(p.autoRefundUnderUsd)}</strong>
      </label>
      <input id="threshold" type="range" min={0} max={policy.length - 1} value={i} onChange={(e) => setI(Number(e.target.value))} className="mt-2 w-full accent-[var(--v-accent)]" aria-valuetext={`${usd(p.autoRefundUnderUsd)}`} />
      <svg viewBox={`0 0 ${policy.length - 1} 30`} className="mt-1 h-10 w-full" preserveAspectRatio="none" aria-hidden>
        <polyline points={policy.map((x, k) => `${k},${30 - (x.savedVsAlwaysRefundUsd / maxSaved) * 28}`).join(' ')} fill="none" stroke="var(--v-accent)" strokeWidth="0.6" vectorEffect="non-scaling-stroke" />
        <line x1={i} x2={i} y1={0} y2={30} stroke="var(--v-faint)" strokeWidth="0.4" vectorEffect="non-scaling-stroke" />
      </svg>
      <dl className="mt-3 grid grid-cols-3 gap-3 text-sm">
        <div>
          <dt className="text-v-muted">Auto-refunded</dt>
          <dd className="text-lg font-semibold tabular text-v-ink">{p.autoRefunded}</dd>
        </div>
        <div>
          <dt className="text-v-muted">Saved</dt>
          <dd className="text-lg font-semibold tabular text-v-ink">{usd(p.savedVsAlwaysRefundUsd)}</dd>
        </div>
        <div>
          <dt className="text-v-muted">vs Verdict only</dt>
          <dd className={`text-lg font-semibold tabular ${p.deltaVsAgentUsd < 0 ? 'text-v-danger' : 'text-v-win'}`}>
            {p.deltaVsAgentUsd >= 0 ? '+' : '−'}
            {usd(Math.abs(p.deltaVsAgentUsd))}
          </dd>
        </div>
      </dl>
      <p className="mt-2 text-xs text-v-muted">
        Right calls {pct(p.rightCallRate)} (Verdict only: {pct(agentOnly.rightCallRate)}).
      </p>
    </section>
  );
}

function LiveRun({ caps }: { caps: { perRequest: number; perHour: number } }) {
  const router = useRouter();
  const [n, setN] = useState(3);
  const [rounds, setRounds] = useState<LiveRound[]>([]);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const abort = useRef<AbortController | null>(null);

  async function start() {
    setRounds([]);
    setError(null);
    setRunning(true);
    abort.current = new AbortController();
    try {
      const res = await fetch('/api/arena/run', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ runs: n }), signal: abort.current.signal });
      if (!res.ok || !res.body) {
        const j = await res.json().catch(() => ({}));
        throw new Error(j.error ?? `Request failed (${res.status})`);
      }
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buf = '';
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        buf += decoder.decode(value, { stream: true });
        const parts = buf.split('\n\n');
        buf = parts.pop() ?? '';
        for (const part of parts) {
          if (!part.startsWith('data: ')) continue;
          const e = JSON.parse(part.slice(6)) as ArenaEvent | { type: 'done' } | { type: 'error'; message: string };
          setRounds((rs) => apply(rs, e));
          if (e.type === 'error') setError(e.message);
        }
      }
      router.refresh();
    } catch (e) {
      if ((e as Error).name !== 'AbortError') setError((e as Error).message);
    } finally {
      setRunning(false);
    }
  }

  return (
    <section className="rounded-2xl border border-v-border bg-v-surface p-5 shadow-[0_1px_2px_rgba(16,24,40,0.04)]" aria-labelledby="live-title">
      <div className="flex items-center justify-between gap-2">
        <h2 id="live-title" className="text-sm font-semibold text-v-ink">
          Run the Arena
        </h2>
        <SimulatedBadge />
      </div>
      <p className="mt-1 text-sm text-v-muted">
        A Claude buyer agent (honest, mistaken, opportunistic or aggressive) writes a claim. Verdict investigates and responds; the SIMULATED arbiter rules. Up to {caps.perRequest} runs per click, {caps.perHour} per hour.
      </p>
      <div className="mt-4 flex items-center gap-3">
        <label className="text-sm text-v-ink" htmlFor="runs">
          Runs
        </label>
        <select id="runs" value={n} onChange={(e) => setN(Number(e.target.value))} disabled={running} className="rounded-md border border-v-border bg-v-surface px-2 py-1.5 text-sm">
          {Array.from({ length: caps.perRequest }, (_, k) => k + 1).map((k) => (
            <option key={k}>{k}</option>
          ))}
        </select>
        {running ? (
          <button type="button" onClick={() => abort.current?.abort()} className="rounded-md border border-v-border px-4 py-1.5 text-sm font-medium text-v-ink hover:bg-v-highlight">
            Stop
          </button>
        ) : (
          <button type="button" onClick={start} className="rounded-md bg-v-accent px-4 py-1.5 text-sm font-semibold text-v-accent-ink">
            Start
          </button>
        )}
        {running ? <span className="text-sm text-v-muted" role="status">Running… about 20 seconds per round</span> : null}
      </div>
      {error ? (
        <p role="alert" className="mt-3 text-sm text-v-danger">
          {error}
        </p>
      ) : null}
      {rounds.length ? (
        <ol className="mt-4 space-y-3" aria-live="polite">
          {rounds.map((r) => (
            <li key={r.id} className="rounded-lg border border-v-border bg-v-raised p-3 text-sm">
              <p className="font-medium text-v-ink">{r.label}</p>
              {r.claim ? <p className="mt-1 text-v-muted">Buyer: “{r.claim}”</p> : <p className="mt-1 text-v-faint">Buyer is writing a claim…</p>}
              {r.decision ? (
                <p className="mt-1 text-v-ink">
                  Verdict: {r.decision}
                  {r.flagged ? <span className="ml-1 text-v-warn">(flagged for a human)</span> : null}
                </p>
              ) : r.claim ? (
                <p className="mt-1 text-v-faint">Verdict is investigating…</p>
              ) : null}
              {r.reply ? <p className="mt-1 text-v-muted">Buyer replies: “{r.reply}”</p> : null}
              {r.outcome ? (
                <p className={`mt-1 font-semibold ${r.right ? 'text-v-win' : 'text-v-danger'}`}>
                  SIMULATED arbiter: {r.outcome} · {r.right ? 'right call' : 'wrong call'}
                </p>
              ) : null}
            </li>
          ))}
        </ol>
      ) : null}
    </section>
  );
}

function apply(rounds: LiveRound[], e: ArenaEvent | { type: 'done' } | { type: 'error'; message: string }): LiveRound[] {
  if (e.type === 'start') {
    const s = e.scenario;
    return [...rounds, { id: s.id, label: `${s.type.replace(/_/g, ' ')} · ${s.variant.replace(/_/g, ' ')} · ${s.persona} buyer · $${s.spec.amount.toFixed(2)}` }];
  }
  const set = (id: string, patch: Partial<LiveRound>) => rounds.map((r) => (r.id === id ? { ...r, ...patch } : r));
  if (e.type === 'claim') return set(e.scenarioId, { claim: e.claim });
  if (e.type === 'decision') return set(e.scenarioId, { decision: `${ACTION[e.action] ?? e.action}${e.amount != null ? ` ($${e.amount.toFixed(2)})` : ''}`, flagged: e.status === 'needs_human' });
  if (e.type === 'offer_reply') return set(e.scenarioId, { reply: `${e.accept ? 'accepts' : 'declines'}: ${e.reply}` });
  if (e.type === 'verdict') return set(e.scenarioId, { outcome: e.result.verdict.outcome.replace(/_/g, ' ').toLowerCase(), right: e.result.verdict.rightCall });
  return rounds;
}

export function Arena({ rows, bench, policy, caps, licenseKey }: { rows: ArenaRow[]; bench: Bench; policy: PolicyProjection[]; caps: { perRequest: number; perHour: number }; licenseKey?: string }) {
  const inBrowser = useSyncExternalStore(noSubscription, () => true, () => false);
  const data = useMemo(() => arenaData(rows), [rows]);
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <PageHeader
        eyebrow={<SimulatedBadge />}
        title="Arena"
        subtitle={
          <>
            Stress-test the dispute strategy before real buyers do. {bench.runs} runs: right call {pct(bench.rightCallRate)}, contests won {pct(bench.contestWinRate)}, {usd(bench.saved)} saved vs always refunding.{' '}
            {bench.live ? `${bench.live} runs acted on real PayPal sandbox disputes.` : ''}
          </>
        }
      />
      <div className="border-b border-v-border bg-v-warn-soft px-6 py-2 text-sm text-v-warn" role="note">
        Outcomes come from a <strong>SIMULATED</strong> rule-based arbiter, a stand-in for PayPal&apos;s reviewers. They are not real-world results. Rules: docs/arbiter.md.
      </div>
      <div className="grid gap-5 p-6 xl:grid-cols-3">
        <LiveRun caps={caps} />
        <PolicySlider policy={policy} />
        <section className="rounded-2xl border border-v-border bg-v-surface p-5 shadow-[0_1px_2px_rgba(16,24,40,0.04)]" aria-labelledby="weak-title">
          <div className="flex items-center justify-between gap-2">
            <h2 id="weak-title" className="text-sm font-semibold text-v-ink">
              Weak spots
            </h2>
            <SimulatedBadge />
          </div>
          {bench.weakSpots.length ? (
            <ul className="mt-3 space-y-2 text-sm text-v-ink">
              {bench.weakSpots.map((w) => (
                <li key={w} className="rounded-lg bg-v-danger-soft p-3">
                  {w}
                </li>
              ))}
            </ul>
          ) : (
            <p className="mt-3 text-sm text-v-muted">No weak spots in the stored runs.</p>
          )}
          <p className="mt-3 text-xs text-v-muted">
            Avg {bench.avgDecisionSec.toFixed(1)}s and ${bench.avgCostUsd.toFixed(3)} per dispute. {bench.escalated} sent to a human.
          </p>
        </section>
      </div>
      <div className="min-h-[1000px] flex-1">
        {inBrowser ? (
          <AgStudioProvider licenseKey={licenseKey}>
            <AgStudio style={{ height: '100%', width: '100%' }} theme={verdictStudioTheme} data={data} initialState={ARENA_REPORT} mode="view" />
          </AgStudioProvider>
        ) : null}
      </div>
    </div>
  );
}
