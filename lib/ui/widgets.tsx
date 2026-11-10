'use client';

// Verdict's custom AG Studio widgets and grid cell renderers, registered through createWidgets.
// Each widget declares a data mapping and reads rows with widgetApi.getData, so page filters and
// cross-filtering (selecting a dispute in the queue) drive it like any built-in widget.

import Link from 'next/link';
import { useEffect, useState } from 'react';
import type { AgWidgetField, AgWidgetFormParams, AgWidgetParams } from 'ag-studio';
import { createWidgets } from 'ag-studio-react';
import type { CustomCellRendererProps } from 'ag-grid-react';
import { computeDeadline, formatRemaining } from '@/lib/disputes/deadline';
import { DeadlineRing, StrengthGauge, Timeline, URGENCY, useNow, type TimelineItem } from '@/components/viz';

type Row = Record<string, unknown>;

// Studio hands widgets resolved fields ({ fieldId: 'disputes.amount', key: 'disputes.amount.sum', ... })
// and keys result rows by `key`.
const fieldKeyOf = (f: AgWidgetField) => String((f as { key?: unknown }).key ?? (f as { id?: unknown }).id ?? '');
const fieldIdOf = (f: AgWidgetField) => String((f as { fieldId?: unknown }).fieldId ?? (f as { id?: unknown }).id ?? '');

function pick(row: Row, f: AgWidgetField | undefined): unknown {
  return f ? row[fieldKeyOf(f)] : undefined;
}

/** Rows for the mapped fields, re-queried when the mapping or filters change. */
function useWidgetRows(params: AgWidgetParams, keys: string[], queryId: string) {
  const { widgetApi, dataMapping } = params;
  const fields = keys.flatMap((k) => (dataMapping as Record<string, AgWidgetField[] | undefined>)[k] ?? []);
  const fieldKey = JSON.stringify(fields);
  const [rows, setRows] = useState<Row[] | null>(null);
  useEffect(() => {
    let live = true;
    if (!fields.length) {
      widgetApi.setDisplayState('incompleteDataMapping');
      return;
    }
    const apply = (next: Row[]) => {
      if (!live) return;
      setRows(next);
      widgetApi.setDisplayState('displayed'); // the components render their own empty states
    };
    widgetApi
      .getData({ kind: 'flat', fields }, { queryId, onDataUpdated: (r: { results: { rows: Row[] } }) => apply(r.results.rows) } as never)
      .then((res) => {
        if (!(res as { replaced?: boolean }).replaced) apply(res.results.rows);
      })
      .catch(() => live && setRows([]));
    return () => {
      live = false;
    };
    // fieldKey captures the mapping; widgetApi is stable per widget
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fieldKey, queryId]);
  return { rows, field: (k: string) => (dataMapping as Record<string, AgWidgetField[] | undefined>)[k]?.[0] };
}

// --- Deadline clocks ------------------------------------------------------------------------

function DeadlineClocksWidget(params: AgWidgetParams) {
  const { rows, field } = useWidgetRows(params, ['dispute', 'due', 'amount'], 'clocks');
  const now = useNow();
  const items = (rows ?? [])
    .map((r) => ({ id: String(pick(r, field('dispute')) ?? ''), dueAt: (pick(r, field('due')) as string | null) ?? null, amount: Number(pick(r, field('amount')) ?? 0) }))
    .filter((r) => r.id && r.dueAt)
    .sort((a, b) => Date.parse(a.dueAt!) - Date.parse(b.dueAt!))
    .slice(0, 6);
  if (rows && !items.length) return <p className="p-2 text-sm text-v-muted">No open deadlines. Nothing is waiting on you.</p>;
  return (
    <ul tabIndex={0} aria-label="Response deadlines, soonest first" className="grid h-full grid-cols-[repeat(auto-fill,minmax(150px,1fr))] content-start gap-2 overflow-auto p-1">
      {items.map((it) => {
        const d = computeDeadline(it.dueAt, now);
        return (
          <li key={it.id}>
            <Link href={`/disputes/${it.id}`} className="flex items-center gap-3 rounded-lg border border-v-border p-2 hover:bg-v-highlight" style={{ background: URGENCY[d.bucket].soft }}>
              <DeadlineRing dueAt={it.dueAt} now={now} size={44} />
              <span className="min-w-0">
                <span className="block font-mono text-[11px] text-v-muted">{it.id.slice(0, 8)}…</span>
                <span className="block text-sm font-semibold tabular" style={{ color: URGENCY[d.bucket].color }}>
                  {formatRemaining(d.msRemaining)}
                </span>
                {it.amount ? <span className="block text-xs text-v-muted tabular">${it.amount.toFixed(2)}</span> : null}
              </span>
            </Link>
          </li>
        );
      })}
    </ul>
  );
}

// --- Evidence strength --------------------------------------------------------------------------

function EvidenceMeterWidget(params: AgWidgetParams) {
  const { rows, field } = useWidgetRows(params, ['strength'], 'strength');
  const v = rows?.length ? Number(pick(rows[0], field('strength'))) : null;
  return (
    <div className="flex h-full flex-col items-center justify-center gap-1">
      <StrengthGauge value={Number.isFinite(v) ? v : null} size={170} />
      <p className="text-center text-xs text-v-muted">Average across the disputes in view. Select a dispute in the queue to see its own score.</p>
    </div>
  );
}

// --- Dispute timeline -------------------------------------------------------------------------------

function DisputeTimelineWidget(params: AgWidgetParams) {
  const { rows, field } = useWidgetRows(params, ['at', 'title', 'kind', 'dispute'], 'timeline');
  const items: TimelineItem[] = (rows ?? [])
    .map((r) => ({
      at: String(pick(r, field('at')) ?? ''),
      title: String(pick(r, field('title')) ?? ''),
      kind: (String(pick(r, field('kind')) ?? 'system') as TimelineItem['kind']),
      detail: field('dispute') ? String(pick(r, field('dispute')) ?? '') : undefined,
    }))
    .filter((r) => r.at)
    .sort((a, b) => b.at.localeCompare(a.at))
    .slice(0, 40);
  return (
    <div tabIndex={0} aria-label="Dispute activity, newest first" className="h-full overflow-auto px-1 py-1">
      {rows ? <Timeline items={items} dense /> : null}
    </div>
  );
}

// --- Grid cell renderers --------------------------------------------------------------------------

function DisputeLinkCell(p: CustomCellRendererProps) {
  if (!p.value) return null;
  return (
    <Link href={`/disputes/${p.value}`} className="font-mono text-[12.5px] text-v-accent underline-offset-2 hover:underline">
      {String(p.value)}
    </Link>
  );
}

function DeadlineCell(p: CustomCellRendererProps) {
  const now = useNow();
  if (!p.value) return <span className="text-v-faint">—</span>;
  const d = computeDeadline(String(p.value), now);
  return (
    <span className="flex items-center gap-2">
      <DeadlineRing dueAt={String(p.value)} now={now} size={22} />
      <span className="tabular font-medium" style={{ color: URGENCY[d.bucket].color }}>
        {formatRemaining(d.msRemaining)}
      </span>
    </span>
  );
}

function StrengthCell(p: CustomCellRendererProps) {
  const v = Number(p.value);
  if (!Number.isFinite(v)) return null;
  const color = v >= 0.7 ? 'var(--v-win)' : v >= 0.4 ? 'var(--v-warn)' : 'var(--v-danger)';
  return (
    <span className="flex items-center gap-2" aria-label={`Evidence strength ${Math.round(v * 100)}%`}>
      <span className="h-1.5 w-16 overflow-hidden rounded-full bg-v-highlight">
        <span className="block h-full rounded-full" style={{ width: `${Math.max(4, v * 100)}%`, background: color }} />
      </span>
      <span className="tabular text-xs text-v-muted">{Math.round(v * 100)}</span>
    </span>
  );
}

const fieldEnds = (f: AgWidgetField, name: string) => fieldIdOf(f) === name || fieldIdOf(f).endsWith(`.${name}`);

// --- Registration -----------------------------------------------------------------------------------

const icon = (d: string) => `<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><path d="${d}"/></svg>`;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const form = (items: { key: string; label: string }[]) => (p: AgWidgetFormParams<any>) => p.createDefaults({ dataMappingItems: items });

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const verdictWidgets = (defaults: any) =>
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (createWidgets as any)({
    overrides: [
      {
        id: 'grid',
        options: {
          createCellRenderer: (f: AgWidgetField) =>
            fieldEnds(f, 'id') ? DisputeLinkCell : fieldEnds(f, 'dueAt') ? DeadlineCell : fieldEnds(f, 'strength') && !(f as { aggregation?: string }).aggregation ? StrengthCell : undefined,
        },
      },
    ],
    additionalTypes: [
      {
        id: 'deadline-clocks',
        label: 'Deadline clocks',
        icon: icon('M12 7v5l3 2M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18z'),
        dataMapping: {
          dispute: { type: 'field', supportedRoles: ['category'], required: true },
          due: { type: 'field', supportedRoles: ['category', 'temporal'], required: true },
          amount: { type: 'field', supportedRoles: ['numeric'] },
        },
        form: form([
          { key: 'dispute', label: 'Dispute' },
          { key: 'due', label: 'Response due' },
          { key: 'amount', label: 'Amount' },
        ]),
        comp: DeadlineClocksWidget,
        defaultSize: { width: 600, height: 220 },
        minSize: { width: 200, height: 120 },
        ai: { description: 'Countdown rings for the soonest seller-response deadlines, coloured by urgency.', usage: 'Use to show which disputes need a response first.' },
      },
      {
        id: 'evidence-meter',
        label: 'Evidence strength',
        icon: icon('M4 18a8 8 0 0 1 16 0M12 18l4-6'),
        dataMapping: { strength: { type: 'field', supportedRoles: ['numeric'], required: true } },
        form: form([{ key: 'strength', label: 'Strength (0-1)' }]),
        comp: EvidenceMeterWidget,
        defaultSize: { width: 300, height: 220 },
        minSize: { width: 180, height: 140 },
        ai: { description: 'Gauge of evidence strength (0 to 1) for the disputes in view.', usage: 'Map an average of the strength field.' },
      },
      {
        id: 'dispute-timeline',
        label: 'Dispute timeline',
        icon: icon('M6 4v16M6 8h10M6 14h7'),
        dataMapping: {
          at: { type: 'field', supportedRoles: ['category', 'temporal'], required: true },
          title: { type: 'field', supportedRoles: ['category'], required: true },
          kind: { type: 'field', supportedRoles: ['category'] },
          dispute: { type: 'field', supportedRoles: ['category'] },
        },
        form: form([
          { key: 'at', label: 'Time' },
          { key: 'title', label: 'Event' },
          { key: 'kind', label: 'Actor' },
          { key: 'dispute', label: 'Dispute' },
        ]),
        comp: DisputeTimelineWidget,
        defaultSize: { width: 400, height: 400 },
        minSize: { width: 220, height: 160 },
        ai: { description: 'Chronological feed of dispute events: PayPal updates, agent recommendations and owner approvals.', usage: 'Cross-filter by dispute to show one case history.' },
      },
    ],
    menu: [{ label: 'Verdict', widgetIds: ['deadline-clocks', 'evidence-meter', 'dispute-timeline'] }, ...(defaults?.menu ?? [])],
  });
