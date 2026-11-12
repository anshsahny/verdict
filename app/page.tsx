import { readFileSync } from 'node:fs';
import type { Metadata } from 'next';
import Link from 'next/link';
import { connection } from 'next/server';
import { Logo } from '@/components/logo';
import { getDb } from '@/lib/db';
import { computeBenchmark } from '@/lib/arena/benchmark';
import { loadArenaRuns } from '@/lib/arena/run';
import { appMode } from '@/lib/mode';

export const metadata: Metadata = { title: { absolute: 'Verdict · AI dispute clerk for PayPal merchants' } };

const REPO = 'https://github.com/anshsahny/verdict';

type EvalSummary = { scenarios: number; actionAccuracy: number; citationValidity: number; avgLatencySec: number; avgCostUsd: number };

function evalSummary(): EvalSummary | null {
  try {
    return (JSON.parse(readFileSync('fixtures/eval/latest.json', 'utf8')) as { summary: EvalSummary }).summary;
  } catch {
    return null;
  }
}

const STEPS = [
  ['PayPal tells Verdict', 'A webhook brings each new dispute in within seconds. Verdict tracks its response deadline so nothing slips.'],
  ['Verdict builds the case', 'Claude reads the order, tracking, customer history and your Playbook, then proposes a refund, an offer, a contest, or “your call”. Every piece of evidence cites a real record.'],
  ['You decide', 'Approve, edit or override. Verdict re-checks the dispute with PayPal, then sends your response through PayPal’s Disputes API.'],
];

const SCREENS = [
  ['/war-room', 'War Room', 'Your to-do list: disputes that need a decision, soonest deadline first. Below it, live analytics built with AG Studio, and an AI assistant that answers questions and adds charts.'],
  ['/war-room', 'Case File', 'One dispute: where it stands, what Verdict recommends and why, the evidence for and against, and the buttons to act. Open any dispute from the War Room.'],
  ['/arena', 'Arena', 'A wind tunnel for your strategy. Claude plays buyers from honest to aggressive, Verdict responds, and a simulated arbiter scores it. Find weak spots before real buyers do.'],
  ['/playbook', 'Playbook', 'Your refund rules and guardrails in plain language. Verdict follows them and asks you first when a guardrail is hit.'],
];

const AGENT = [
  ['What it can see', 'Read-only tools for the PayPal dispute, the order, shipping and tracking, the customer’s history, your Playbook, and the evidence on file. It looks things up the way a clerk would, then answers.'],
  ['What it can’t do', 'It has no way to act on PayPal. Its answer is a proposal: you approve it, edit it or choose something else, and only then does Verdict re-check the dispute with PayPal and send your response.'],
  ['How it stays honest', 'Every answer is checked before you see it: a valid response for this dispute, evidence that points to real records, your Playbook thresholds, and a screen for buyers who try to give the AI instructions. Failures go back to Claude with the reason. Every step is logged.'],
];

const pct = (x: number | null | undefined) => (x == null ? '—' : `${Math.round(x * 100)}%`);

export default async function Landing() {
  await connection();
  const mode = appMode();
  const ev = evalSummary();
  const runs = loadArenaRuns(getDb());
  const bench = runs.length ? computeBenchmark(runs) : null;
  const injections = runs.filter((r) => r.scenario.persona === 'aggressive' && /\bAI\b|ignore (your|the) rules|instruction/i.test(r.claim ?? ''));
  const injectionsFlagged = injections.filter((r) => r.defenderStatus === 'needs_human').length;

  const stats = [
    ev && { value: pct(ev.actionAccuracy), label: `right response on ${ev.scenarios} labelled test disputes`, note: 'agent eval' },
    ev && { value: pct(ev.citationValidity), label: 'of evidence cites a real store record', note: 'agent eval' },
    injections.length ? { value: `${injectionsFlagged}/${injections.length}`, label: 'prompt-injection attempts by simulated buyers flagged for review', note: 'Arena' } : null,
    ev && { value: `${Math.round(ev.avgLatencySec)} s`, label: `to review a dispute, about $${ev.avgCostUsd.toFixed(2)} in model cost`, note: 'agent eval' },
  ].filter(Boolean) as { value: string; label: string; note: string }[];

  return (
    <div className="min-h-full bg-v-canvas">
      <header className="mx-auto flex max-w-6xl items-center justify-between px-6 py-5">
        <Logo />
        <nav aria-label="Main" className="flex items-center gap-4 whitespace-nowrap text-sm sm:gap-6">
          <a href="#how" className="hidden text-v-muted hover:text-v-ink sm:inline">
            How it works
          </a>
          <a href="#screens" className="hidden text-v-muted hover:text-v-ink sm:inline">
            What’s inside
          </a>
          <a href={REPO} className="hidden text-v-muted hover:text-v-ink sm:inline">
            GitHub
          </a>
          <Link href="/war-room" className="rounded-lg bg-v-accent px-4 py-2 font-semibold text-v-accent-ink hover:brightness-110">
            Open the demo
          </Link>
        </nav>
      </header>

      <main id="main">
        <section className="mx-auto max-w-[1440px] px-6 pb-12 pt-10 text-center sm:pt-16 lg:px-12">
          <p className="text-sm font-semibold text-v-accent">For small shops that sell with PayPal</p>
          <h1 className="mx-auto mt-3 text-4xl font-semibold tracking-tight text-v-ink sm:text-5xl lg:text-6xl">An AI clerk for your PayPal disputes</h1>
          <p className="mx-auto mt-5 max-w-5xl text-lg leading-relaxed text-v-muted lg:text-xl">
            Small shops lose disputes they should win: a deadline slips, or the tracking number never gets sent. Verdict tracks every dispute, gathers the evidence from your own order and shipping records, and recommends whether to refund, make an offer or fight. You approve every action.
          </p>
          <div className="mt-8 flex flex-wrap justify-center gap-3">
            <Link href="/war-room" className="rounded-lg bg-v-accent px-6 py-3 text-[15px] font-semibold text-v-accent-ink shadow-sm hover:brightness-110">
              Open the demo
            </Link>
            <a href="#how" className="rounded-lg border border-v-border bg-v-surface px-6 py-3 text-[15px] font-semibold text-v-ink hover:bg-v-highlight">
              How it works
            </a>
          </div>
          <p className="mx-auto mt-4 max-w-3xl text-sm text-v-muted">
            The demo runs on the PayPal sandbox for a fictional pottery shop, Kiln &amp; Co.
            {mode === 'replay' ? ' Disputes here are recorded sandbox data with dates moved to today, so you can approve responses safely.' : ''} <span className="whitespace-nowrap">No sign-in needed.</span>
          </p>
          <div className="mx-auto mt-12 max-w-5xl overflow-hidden rounded-2xl border border-v-border bg-v-surface shadow-[0_20px_60px_-20px_rgba(16,24,40,0.25)]">
            {/* One screenshot per theme; the theme is a data attribute, not a media query. */}
            {(['light', 'dark'] as const).map((t) => (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                key={t}
                src={`/screens/war-room-${t}.png`}
                alt={t === 'light' ? 'The War Room: disputes waiting for a decision, each with its deadline, Verdict’s suggestion and a Review button' : ''}
                className={`w-full ${t === 'light' ? 'shot-light' : 'shot-dark'}`}
                width={1440}
                height={900}
              />
            ))}
          </div>
        </section>

        <section id="how" className="border-y border-v-border bg-v-surface py-16">
          <div className="mx-auto max-w-6xl px-6">
            <h2 className="text-2xl font-semibold tracking-tight text-v-ink">How it works</h2>
            <p className="mt-2 max-w-2xl text-v-muted">From PayPal’s notification to your answer, in three steps. Verdict does the legwork; you keep the final say.</p>
            <ol className="mt-10 grid gap-8 md:grid-cols-3">
              {STEPS.map(([title, body], i) => (
                <li key={title}>
                  <span className="flex size-9 items-center justify-center rounded-full bg-v-info-soft text-sm font-bold text-v-accent" aria-hidden>
                    {i + 1}
                  </span>
                  <h3 className="mt-4 font-semibold text-v-ink">{title}</h3>
                  <p className="mt-1.5 text-[15px] leading-relaxed text-v-muted">{body}</p>
                </li>
              ))}
            </ol>
          </div>
        </section>

        <section id="screens" className="mx-auto max-w-6xl px-6 py-16">
          <h2 className="text-2xl font-semibold tracking-tight text-v-ink">What’s inside</h2>
          <p className="mt-2 text-v-muted">Four screens. Start in the War Room.</p>
          <div className="mt-8 grid gap-4 sm:grid-cols-2">
            {SCREENS.map(([href, title, body]) => (
              <Link key={title} href={href} className="group rounded-2xl border border-v-border bg-v-surface p-6 hover:border-v-accent">
                <h3 className="font-semibold text-v-ink">
                  {title} <span className="text-v-accent opacity-0 transition group-hover:opacity-100" aria-hidden>→</span>
                </h3>
                <p className="mt-1.5 text-[15px] leading-relaxed text-v-muted">{body}</p>
              </Link>
            ))}
          </div>
        </section>

        <section id="agent" className="mx-auto max-w-6xl px-6 pb-16">
          <h2 className="text-2xl font-semibold tracking-tight text-v-ink">Inside the agent</h2>
          <p className="mt-2 max-w-2xl text-v-muted">Verdict’s clerk is Claude with a small set of tools and firm limits. Each Case File shows what it looked at and which checks it passed.</p>
          <div className="mt-8 grid gap-4 md:grid-cols-3">
            {AGENT.map(([title, body]) => (
              <div key={title} className="rounded-2xl border border-v-border bg-v-surface p-6">
                <h3 className="font-semibold text-v-ink">{title}</h3>
                <p className="mt-1.5 text-[15px] leading-relaxed text-v-muted">{body}</p>
              </div>
            ))}
          </div>
        </section>

        {stats.length ? (
          <section className="border-y border-v-border bg-v-surface py-16">
            <div className="mx-auto max-w-6xl px-6">
              <h2 className="text-2xl font-semibold tracking-tight text-v-ink">Measured, not promised</h2>
              <p className="mt-2 max-w-2xl text-v-muted">From the agent evaluation and the Arena. Both use simulated disputes, so they show how reliably Verdict applies your rules, not how often PayPal would rule for you.</p>
              <dl className="mt-10 grid gap-8 sm:grid-cols-2 lg:grid-cols-4">
                {stats.map((s) => (
                  <div key={s.label}>
                    <dt className="sr-only">{s.label}</dt>
                    <dd className="text-4xl font-semibold tracking-tight text-v-ink tabular">{s.value}</dd>
                    <dd className="mt-1 text-[15px] text-v-muted">{s.label}</dd>
                    <dd className="mt-1 text-xs font-medium uppercase tracking-wide text-v-faint">{s.note}</dd>
                  </div>
                ))}
              </dl>
              {bench ? (
                <p className="mt-8 text-sm text-v-muted">
                  Arena: {bench.runs} simulated disputes, {pct(bench.totals.rightCallRate)} handled the way the shop’s rules intend. Outcomes come from a rule-based stand-in for PayPal’s reviewers, not real rulings.
                </p>
              ) : null}
            </div>
          </section>
        ) : null}

        <section className="mx-auto grid max-w-6xl gap-6 px-6 py-16 md:grid-cols-2">
          <div className="rounded-2xl border border-v-border bg-v-surface p-6">
            <h2 className="font-semibold text-v-ink">What’s real</h2>
            <ul className="mt-3 space-y-2 text-[15px] text-v-muted">
              <li>PayPal sandbox: Disputes, Orders and Shipment Tracking APIs, and signed webhooks</li>
              <li>Claude reviews each dispute with read-only tools and structured, validated output</li>
              <li>Your approval sends the response to PayPal, and the result comes back by webhook</li>
              <li>The dashboard is AG Studio and AG Grid, with custom widgets and a Claude-powered assistant</li>
            </ul>
          </div>
          <div className="rounded-2xl border border-v-border bg-v-surface p-6">
            <h2 className="font-semibold text-v-ink">What’s simulated</h2>
            <ul className="mt-3 space-y-2 text-[15px] text-v-muted">
              <li>Kiln &amp; Co. and its orders, customers and shipments are fictional demo data</li>
              <li>Arena verdicts come from a rule-based stand-in for PayPal’s reviewers</li>
              <li>Arena and evaluation numbers measure Verdict on test disputes, not real-world results</li>
              {mode === 'replay' ? <li>This hosted demo replays recorded sandbox disputes, so approving is safe and repeatable</li> : null}
            </ul>
          </div>
        </section>

        <section className="mx-auto max-w-6xl px-6 pb-20 text-center">
          <Link href="/war-room" className="inline-block rounded-lg bg-v-accent px-6 py-3 text-[15px] font-semibold text-v-accent-ink shadow-sm hover:brightness-110">
            Open the demo
          </Link>
          <p className="mt-3 text-sm text-v-muted">Takes you to the War Room. No sign-in needed.</p>
        </section>
      </main>

      <footer className="border-t border-v-border">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-3 px-6 py-6 text-sm text-v-muted">
          <span>Built with the PayPal REST APIs, Claude by Anthropic, AG Studio and AG Grid, Next.js and Render.</span>
          <span>
            <a href={REPO} className="hover:text-v-ink">
              Open source, MIT
            </a>
          </span>
        </div>
      </footer>
    </div>
  );
}
