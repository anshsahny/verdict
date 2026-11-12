import type { Metadata } from 'next';
import Link from 'next/link';
import type { ReactNode } from 'react';
import { PageHeader } from '@/components/page-header';
import { Card, SimulatedBadge } from '@/components/ui';
import { LOST_DISPUTE_FEE_USD, SIGNATURE_REQUIRED_OVER_USD } from '@/lib/arena/arbiter';

// The SIMULATED arbiter's rules, in the app, so the Arena's "Arbiter rules" link stays on the site.
// Mirrors docs/arbiter.md; the fee and signature threshold come straight from lib/arena/arbiter.ts.

export const metadata: Metadata = { title: 'Arbiter rules' };

const OUTCOMES: [action: string, outcome: ReactNode][] = [
  ['Refund in full', <><strong>Buyer wins.</strong> The seller refunds the full amount. No fee.</>],
  ['Partial refund, buyer accepts', <><strong>Settled.</strong> The seller refunds the offer amount.</>],
  ['Partial refund, buyer declines', 'The buyer escalates, and the cited evidence is judged as a contest.'],
  ['Contest with evidence', <><strong>Seller wins</strong> if every contest rule passes. Otherwise <strong>buyer wins</strong>: a full refund plus a ${LOST_DISPUTE_FEE_USD} SIMULATED dispute fee.</>],
  ['Send to a human', <><strong>Escalated.</strong> No automatic outcome, and no money counted.</>],
];

const REASONS = ['Not received or late', 'Not as described', 'Unauthorized', 'Duplicate'];
const RULES: [rule: string, cells: string[]][] = [
  ['Evidence is complete', ['Tracking and a delivery scan cited', 'The product listing cited', 'Delivery and account history cited', 'Separate orders or a prior refund cited']],
  ['Tracking proves delivery', ['Delivered to the order address', '—', "Delivered to the account holder's address", '—']],
  [`Signature over $${SIGNATURE_REQUIRED_OVER_USD}`, [`Signature cited if the amount is over $${SIGNATURE_REQUIRED_OVER_USD}`, '—', '—', '—']],
  ['Claim is consistent', ['—', 'The complaint is a variation the listing discloses. Damage or a wrong item always loses.', '—', '—']],
  ['Response is on time', Array(4).fill('Responded before the seller deadline')],
  ['No record contradicts the seller', Array(4).fill('No wrong address, missing delivery scan, untracked parcel or unrefunded duplicate')],
];

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <Card title={title}>
      <div className="space-y-3 text-sm text-v-ink">{children}</div>
    </Card>
  );
}

export default function ArbiterRulesPage() {
  return (
    <>
      <PageHeader
        eyebrow={<SimulatedBadge />}
        title="Arbiter rules"
        subtitle="How the Arena decides who wins each simulated dispute."
        actions={
          <Link href="/arena" className="text-sm font-medium text-v-muted hover:text-v-ink">
            ← Back to the Arena
          </Link>
        }
      />
      <div className="border-b border-v-border bg-v-warn-soft px-6 py-2 text-sm text-v-warn" role="note">
        The arbiter is a <strong>rule-based stand-in for PayPal&apos;s dispute reviewers</strong>. It is not PayPal&apos;s process, and Arena results are <strong>not real-world outcomes</strong>.
      </div>
      {/* w-full + min-w-0: inside the shell's flex column, the wide rules table must scroll, not widen the page. */}
      <div className="mx-auto w-full min-w-0 max-w-5xl space-y-5 p-6">
        <Section title="Why a rule-based arbiter">
          <p>
            It lets the Arena score many dispute responses cheaply and the same way every time. In the PayPal sandbox a ruling can be forced, but not predicted, so the Arena uses these rules instead. Every
            Arena verdict stores the trace of rules that produced it.
          </p>
        </Section>

        <Section title="What the arbiter sees">
          <ul className="list-disc space-y-1.5 pl-5">
            <li>The dispute type, amount and the buyer&apos;s complaint.</li>
            <li>Verdict&apos;s decision: the action, the amount and the evidence it cited.</li>
            <li>The evidence packet: every relevant store record, including records that hurt the seller.</li>
            <li>For a partial refund offer: the buyer agent&apos;s reply (accept or decline).</li>
          </ul>
          <p className="text-v-muted">
            Each scenario also has a hidden ground truth (who is really at fault). It is used only to judge whether Verdict made the right call, never to decide the case.
          </p>
        </Section>

        <Section title="Outcomes">
          <div className="overflow-x-auto">
            <table className="w-full min-w-[480px] text-left">
              <thead className="text-xs uppercase tracking-wide text-v-faint">
                <tr>
                  <th className="py-2 pr-4 font-semibold">Verdict&apos;s response</th>
                  <th className="py-2 font-semibold">Outcome</th>
                </tr>
              </thead>
              <tbody>
                {OUTCOMES.map(([action, outcome]) => (
                  <tr key={action} className="border-t border-v-border align-top">
                    <td className="py-2.5 pr-4 font-medium">{action}</td>
                    <td className="py-2.5 text-v-muted">{outcome}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Section>

        <Section title="Contest rules (all must pass)">
          <p className="text-v-muted">Only citations that match a real, helpful record of that kind count.</p>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[720px] text-left">
              <thead className="text-xs uppercase tracking-wide text-v-faint">
                <tr>
                  <th className="py-2 pr-4 font-semibold">Rule</th>
                  {REASONS.map((r) => (
                    <th key={r} className="py-2 pr-4 font-semibold">
                      {r}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {RULES.map(([rule, cells]) => (
                  <tr key={rule} className="border-t border-v-border align-top">
                    <td className="py-2.5 pr-4 font-medium">{rule}</td>
                    {cells.map((c, i) => (
                      <td key={i} className={`py-2.5 pr-4 ${c === '—' ? 'text-v-faint' : 'text-v-muted'}`}>
                        {c}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Section>

        <div className="grid gap-5 md:grid-cols-2">
          <Section title="What counts as the right call">
            <p>A response is the right call when it serves the merchant, given the hidden truth:</p>
            <ul className="list-disc space-y-1.5 pl-5">
              <li>refunding when the merchant is at fault;</li>
              <li>winning or settling when the buyer is at fault;</li>
              <li>sending ambiguous cases to a human.</li>
            </ul>
            <p className="text-v-muted">Losing a contest is never the right call.</p>
          </Section>
          <Section title="How money is counted">
            <ul className="list-disc space-y-1.5 pl-5">
              <li>
                <strong>Retained:</strong> disputed money the seller keeps.
              </li>
              <li>
                <strong>Refunded:</strong> money that left.
              </li>
              <li>
                <strong>Fees:</strong> ${LOST_DISPUTE_FEE_USD} per lost contest (SIMULATED).
              </li>
            </ul>
            <p className="text-v-muted">The benchmark compares these with always refunding. All figures are SIMULATED.</p>
          </Section>
        </div>

        <Section title="Limitations: read before quoting numbers">
          <ul className="list-disc space-y-1.5 pl-5">
            <li>
              The arbiter, the scenarios and Verdict&apos;s evidence packet share one model of the world. High scores show Verdict applies the shop&apos;s Playbook consistently inside that model. They
              don&apos;t show how PayPal&apos;s reviewers would rule.
            </li>
            <li>A Claude buyer agent writes each complaint live, as one of four personas: honest, mistaken, opportunistic or aggressive. The facts behind each case are fixed by the scenario.</li>
            <li>The fee, the ${SIGNATURE_REQUIRED_OVER_USD} signature rule and the definition of the right call are SIMULATED parameters chosen for this project.</li>
            <li>
              Bound runs act on real PayPal sandbox disputes. Their final PayPal state comes from the sandbox <code className="text-[13px]">adjudicate</code> call, set to the SIMULATED verdict, so they
              confirm the plumbing, not the ruling.
            </li>
          </ul>
        </Section>
      </div>
    </>
  );
}
