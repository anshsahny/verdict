'use client';

// Small visual building blocks shared by the AG Studio custom widgets and the Case File: a
// deadline ring, an evidence-strength gauge, and a dispute timeline. Pure SVG + tokens.

import { useEffect, useState } from 'react';
import { computeDeadline, formatRemaining, type DeadlineBucket } from '@/lib/disputes/deadline';

const RESPONSE_WINDOW_MS = 20 * 86_400_000; // PayPal gives sellers 20 days on an inquiry

export const URGENCY: Record<DeadlineBucket, { color: string; soft: string; label: string }> = {
  overdue: { color: 'var(--v-danger)', soft: 'var(--v-danger-soft)', label: 'Overdue' },
  critical: { color: 'var(--v-danger)', soft: 'var(--v-danger-soft)', label: 'Under 24h' },
  urgent: { color: 'var(--v-warn)', soft: 'var(--v-warn-soft)', label: 'Under 48h' },
  soon: { color: 'var(--v-warn)', soft: 'var(--v-warn-soft)', label: 'This week' },
  ok: { color: 'var(--v-win)', soft: 'var(--v-win-soft)', label: 'On track' },
  none: { color: 'var(--v-faint)', soft: 'var(--v-highlight)', label: 'No clock' },
};

/** Re-render every `ms` so countdowns tick. */
export function useNow(ms = 30_000) {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), ms);
    return () => clearInterval(t);
  }, [ms]);
  return now;
}

export function DeadlineRing({ dueAt, size = 56, now }: { dueAt: string | null; size?: number; now: Date }) {
  const d = computeDeadline(dueAt, now);
  const u = URGENCY[d.bucket];
  const frac = d.msRemaining === null ? 0 : Math.max(0, Math.min(1, d.msRemaining / RESPONSE_WINDOW_MS));
  const r = 15.5;
  const c = 2 * Math.PI * r;
  return (
    <svg viewBox="0 0 36 36" width={size} height={size} role="img" aria-label={`${u.label}: ${formatRemaining(d.msRemaining)}`}>
      <circle cx="18" cy="18" r={r} fill="none" stroke="var(--v-gridline)" strokeWidth="3" />
      <circle
        cx="18"
        cy="18"
        r={r}
        fill="none"
        stroke={u.color}
        strokeWidth="3"
        strokeLinecap="round"
        strokeDasharray={`${c * frac} ${c}`}
        transform="rotate(-90 18 18)"
      />
      {d.bucket === 'critical' || d.bucket === 'overdue' ? <circle cx="18" cy="18" r="4" fill={u.color} className="motion-safe:animate-pulse" /> : null}
    </svg>
  );
}

export function StrengthGauge({ value, rating, size = 160 }: { value: number | null; rating?: string; size?: number }) {
  const v = value === null ? 0 : Math.max(0, Math.min(1, value));
  const color = value === null ? 'var(--v-faint)' : v >= 0.7 ? 'var(--v-win)' : v >= 0.4 ? 'var(--v-warn)' : 'var(--v-danger)';
  const label = rating ?? (value === null ? 'n/a' : v >= 0.7 ? 'strong' : v >= 0.4 ? 'moderate' : v > 0 ? 'weak' : 'none');
  // Semicircle from 180° to 0°, radius 40, centred at (50, 50).
  const angle = Math.PI * (1 - v);
  const x = 50 + 40 * Math.cos(angle);
  const y = 50 - 40 * Math.sin(angle);
  return (
    <svg viewBox="0 0 100 62" width={size} height={(size * 62) / 100} role="img" aria-label={`Evidence strength ${Math.round(v * 100)}%, ${label}`}>
      <path d="M10 50 A40 40 0 0 1 90 50" fill="none" stroke="var(--v-gridline)" strokeWidth="9" strokeLinecap="round" />
      {v > 0 ? <path d={`M10 50 A40 40 0 0 1 ${x.toFixed(2)} ${y.toFixed(2)}`} fill="none" stroke={color} strokeWidth="9" strokeLinecap="round" /> : null}
      <text x="50" y="45" textAnchor="middle" fontSize="17" fontWeight="650" fill="var(--v-ink)" className="tabular">
        {value === null ? '—' : `${Math.round(v * 100)}`}
      </text>
      <text x="50" y="58" textAnchor="middle" fontSize="7.5" fill="var(--v-muted)" letterSpacing="0.6">
        {label.toUpperCase()}
      </text>
    </svg>
  );
}

export type TimelineItem = { at: string; kind: 'paypal' | 'agent' | 'human' | 'system'; title: string; detail?: string };

const KIND: Record<TimelineItem['kind'], { color: string; label: string }> = {
  paypal: { color: 'var(--v-accent)', label: 'PayPal' },
  agent: { color: 'var(--v-sim)', label: 'Verdict agent' },
  human: { color: 'var(--v-win)', label: 'Owner' },
  system: { color: 'var(--v-faint)', label: 'Store' },
};

const fmt = (iso: string) => new Date(iso).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });

export function Timeline({ items, dense = false }: { items: TimelineItem[]; dense?: boolean }) {
  if (!items.length) return <p className="text-sm text-v-muted">No events yet.</p>;
  return (
    <ol className="relative">
      {items.map((it, i) => (
        <li key={`${it.at}-${i}`} className={`relative flex gap-3 ${dense ? 'pb-2.5' : 'pb-4'} last:pb-0`}>
          {i < items.length - 1 ? <span aria-hidden className="absolute left-[5px] top-3.5 h-full w-px bg-v-border" /> : null}
          <span aria-hidden className="mt-1.5 size-[11px] shrink-0 rounded-full border-2 border-v-surface" style={{ background: KIND[it.kind].color }} />
          <div className="min-w-0">
            <p className={`${dense ? 'text-[13px]' : 'text-sm'} font-medium text-v-ink`}>{it.title}</p>
            <p className="text-xs text-v-muted">
              <span className="sr-only">{KIND[it.kind].label}, </span>
              {fmt(it.at)}
              {it.detail ? <> · {it.detail}</> : null}
            </p>
          </div>
        </li>
      ))}
    </ol>
  );
}
