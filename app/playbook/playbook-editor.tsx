'use client';

// The Playbook: how the merchant wants disputes handled. Verdict's agent follows these rules, and
// the guardrails use the thresholds to decide which recommendations need extra care.

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { Badge, Button, Card, usd, useToast } from '@/components/ui';
import type { Playbook } from '@/lib/settings';

const POLICY_FIELDS: { key: keyof Pick<Playbook, 'shipping' | 'returns' | 'damaged' | 'lost' | 'handmade'>; label: string; hint: string }[] = [
  { key: 'shipping', label: 'Shipping', hint: 'How fast you ship, and when you use tracking or signatures.' },
  { key: 'returns', label: 'Returns', hint: 'Return window and who pays for return shipping.' },
  { key: 'damaged', label: 'Damaged or not as described', hint: 'What you do when an item arrives broken or wrong.' },
  { key: 'lost', label: 'Lost parcels', hint: 'When you reship or refund a parcel that stopped moving.' },
  { key: 'handmade', label: 'Product notes', hint: 'Anything buyers should know, like natural variation in handmade goods.' },
];

const NEVER = [
  'Sends anything to PayPal without your approval.',
  'Invents evidence: every item cites a record in your store.',
  'Follows instructions hidden in a buyer’s message. They are flagged for you instead.',
  'Acts on a dispute whose state changed since it was reviewed: PayPal is re-checked first.',
];

export function PlaybookEditor({ initial }: { initial: Playbook }) {
  const router = useRouter();
  const toast = useToast();
  const [pb, setPb] = useState<Playbook>(initial);
  const [saving, setSaving] = useState(false);
  const dirty = JSON.stringify(pb) !== JSON.stringify(initial);

  async function save(body: unknown, message: string) {
    setSaving(true);
    try {
      const res = await fetch('/api/playbook', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json.error ?? `Save failed (${res.status})`);
      setPb(json.playbook);
      toast({ tone: 'win', title: message, body: 'Verdict uses it from the next review.' });
      router.refresh();
    } catch (e) {
      toast({ tone: 'danger', title: 'Not saved', body: (e as Error).message });
    } finally {
      setSaving(false);
    }
  }

  const setRule = (i: number, v: string) => setPb((p) => ({ ...p, disputeRules: p.disputeRules.map((r, k) => (k === i ? v : r)) }));

  return (
    <div className="flex-1">
      <div className="border-b border-v-border bg-v-surface px-6 py-5">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight text-v-ink">Playbook</h1>
            <p className="mt-1 max-w-2xl text-[15px] text-v-muted">Tell Verdict how your shop handles disputes. It follows these rules when it builds a case, and asks you first whenever a guardrail is hit.</p>
          </div>
          <div className="flex gap-2">
            <Button variant="secondary" onClick={() => save({ reset: true }, 'Playbook reset to defaults')} disabled={saving}>
              Reset to defaults
            </Button>
            <Button onClick={() => save(pb, 'Playbook saved')} disabled={saving || !dirty}>
              {saving ? 'Saving…' : dirty ? 'Save changes' : 'Saved'}
            </Button>
          </div>
        </div>
      </div>

      <div className="grid gap-5 p-6 xl:grid-cols-3">
        <div className="space-y-5 xl:col-span-2">
          <Card title="How Verdict should respond" subtitle="Plain-language rules, in priority order. Verdict reads them on every dispute.">
            <ol className="space-y-3">
              {pb.disputeRules.map((r, i) => (
                <li key={i} className="flex gap-3">
                  <span className="mt-2 flex size-6 shrink-0 items-center justify-center rounded-full bg-v-highlight text-xs font-bold text-v-muted" aria-hidden>
                    {i + 1}
                  </span>
                  <label className="sr-only" htmlFor={`rule-${i}`}>
                    Rule {i + 1}
                  </label>
                  <textarea id={`rule-${i}`} rows={2} value={r} onChange={(e) => setRule(i, e.target.value)} className="w-full rounded-lg border border-v-border bg-v-surface px-3 py-2 text-sm text-v-ink" />
                  <button type="button" onClick={() => setPb((p) => ({ ...p, disputeRules: p.disputeRules.filter((_, k) => k !== i) }))} className="mt-2 h-fit rounded px-2 text-v-muted hover:bg-v-highlight hover:text-v-danger" aria-label={`Remove rule ${i + 1}`} disabled={pb.disputeRules.length <= 1}>
                    ×
                  </button>
                </li>
              ))}
            </ol>
            <Button variant="ghost" size="sm" className="mt-3" onClick={() => setPb((p) => ({ ...p, disputeRules: [...p.disputeRules, ''] }))} disabled={pb.disputeRules.length >= 12}>
              + Add a rule
            </Button>
          </Card>

          <Card title="Store policies" subtitle="Verdict quotes these as evidence and to decide what’s fair.">
            <div className="grid gap-4 md:grid-cols-2">
              {POLICY_FIELDS.map((f) => (
                <label key={f.key} className="grid gap-1 text-sm">
                  <span className="font-medium text-v-ink">{f.label}</span>
                  <span className="text-xs text-v-muted">{f.hint}</span>
                  <textarea rows={3} value={pb[f.key]} onChange={(e) => setPb((p) => ({ ...p, [f.key]: e.target.value }))} className="rounded-lg border border-v-border bg-v-surface px-3 py-2 text-v-ink" />
                </label>
              ))}
            </div>
          </Card>
        </div>

        <div className="space-y-5">
          <Card title="Guardrails" subtitle="When a recommendation needs your extra attention.">
            <label className="grid gap-1 text-sm" htmlFor="threshold">
              <span className="font-medium text-v-ink">Flag disputes larger than</span>
              <span className="flex items-center gap-2">
                <span className="text-v-muted">$</span>
                <input id="threshold" type="number" min={0} step={10} value={pb.approvalThresholdUsd} onChange={(e) => setPb((p) => ({ ...p, approvalThresholdUsd: Number(e.target.value) }))} className="w-28 rounded-lg border border-v-border bg-v-surface px-3 py-1.5 tabular" />
              </span>
              <span className="text-xs text-v-muted">Currently {usd(pb.approvalThresholdUsd, 0)}. Larger disputes are marked “Needs your judgment”.</span>
            </label>
            <label className="mt-5 grid gap-1 text-sm" htmlFor="confidence">
              <span className="font-medium text-v-ink">Flag when Verdict is less than {Math.round(pb.minConfidence * 100)}% sure</span>
              <input id="confidence" type="range" min={0.3} max={0.95} step={0.05} value={pb.minConfidence} onChange={(e) => setPb((p) => ({ ...p, minConfidence: Number(e.target.value) }))} className="accent-[var(--v-accent)]" />
            </label>
            <div className="mt-5 flex flex-wrap gap-2">
              <Badge tone="accent">Every action needs your click</Badge>
              <Badge tone="warn">Prompt-injection screen on</Badge>
            </div>
          </Card>

          <Card title="Verdict never…">
            <ul className="space-y-2.5 text-sm text-v-ink">
              {NEVER.map((n) => (
                <li key={n} className="flex gap-2">
                  <span aria-hidden className="mt-0.5 font-bold text-v-win">
                    ✓
                  </span>
                  {n}
                </li>
              ))}
            </ul>
          </Card>
        </div>
      </div>
    </div>
  );
}
