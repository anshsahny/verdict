// The Arena in AG Studio: one row per stored run (SIMULATED outcomes), and the default report.

import type { AgDataSourcesDefinition, AgFieldDefinition, AgFormat, AgReportState, AgWidgetLayoutState } from 'ag-studio';
import type { ArenaRunResult } from '@/lib/arena/run';

export type ArenaRow = {
  id: string;
  type: string;
  variant: string;
  persona: string;
  truth: string;
  amount: number;
  action: string;
  outcome: string;
  rightCall: number;
  contested: number;
  won: number;
  retained: number;
  refunded: number;
  fees: number;
  saved: number;
  escalated: number;
  injection: number;
  mode: string;
  decisionSec: number;
  claim: string;
  one: number;
};

const TYPE: Record<string, string> = { not_received: 'Not received', late_delivery: 'Late delivery', not_as_described: 'Not as described', unauthorized: 'Unauthorized', duplicate: 'Duplicate charge' };
const ACTION: Record<string, string> = { accept: 'Refund', offer_refund: 'Partial offer', contest: 'Contest', escalate_to_human: 'To a human' };
const OUTCOME: Record<string, string> = { SELLER_WINS: 'Seller wins', BUYER_WINS: 'Buyer wins', SETTLED: 'Settled', ESCALATED: 'Escalated' };

export function toArenaRow(r: ArenaRunResult): ArenaRow {
  const v = r.verdict;
  const contested = r.decision?.action === 'contest' || (r.decision?.action === 'offer_refund' && r.offerReply?.accept === false) ? 1 : 0;
  const escalated = v.outcome === 'ESCALATED' ? 1 : 0;
  return {
    id: r.runId,
    type: TYPE[r.scenario.type] ?? r.scenario.type,
    variant: r.scenario.variant.replace(/_/g, ' '),
    persona: r.scenario.persona,
    truth: r.scenario.truth.replace(/_/g, ' '),
    amount: r.scenario.spec.amount,
    action: ACTION[r.decision?.action ?? ''] ?? 'Invalid',
    outcome: OUTCOME[v.outcome] ?? v.outcome,
    rightCall: v.rightCall ? 1 : 0,
    contested,
    won: v.outcome === 'SELLER_WINS' ? 1 : 0,
    retained: v.retainedUsd,
    refunded: v.refundUsd,
    fees: v.feeUsd,
    saved: escalated ? 0 : Math.round((r.scenario.spec.amount - v.refundUsd - v.feeUsd) * 100) / 100,
    escalated,
    injection: r.defenderStatus === 'needs_human' && (r.claim ?? '').match(/\bAI\b|ignore|instruction|system/i) ? 1 : 0,
    mode: r.mode,
    decisionSec: Math.round(r.latencyMs / 100) / 10,
    claim: r.claim,
    one: 1,
  };
}

type FieldSpec = [id: string, name: string, format: AgFormat, hide?: boolean];
const fields = (specs: FieldSpec[]): AgFieldDefinition[] => specs.map(([id, name, format, hide]) => ({ id, name, format, ...(hide && { hide }) }));
const sum = (id: string) => ({ id, aggregation: 'sum' as const });
const ratio = (id: string, name: string, description: string, num: string, den: string) => ({
  id,
  name,
  description,
  format: 'percentageFormat',
  isMeasure: true,
  expression: { operator: 'divide', inputs: [sum(num), sum(den)] },
});

export function arenaData(rows: ArenaRow[]): AgDataSourcesDefinition {
  return {
    description:
      'Arena runs: a Claude buyer agent files a SIMULATED dispute against the Verdict defender; a rule-based SIMULATED arbiter (not PayPal) decides. ' +
      'rightCall = the response served the merchant given the hidden truth. saved = disputed amount kept vs an always-refund shop.',
    sources: [
      {
        id: 'runs',
        description: 'One row per Arena run. All outcomes are SIMULATED.',
        data: rows,
        fields: fields([
          ['id', 'Run', 'textFormat', true],
          ['type', 'Dispute type', 'textFormat'],
          ['variant', 'Facts', 'textFormat'],
          ['persona', 'Buyer persona', 'textFormat'],
          ['truth', 'Who was at fault', 'textFormat'],
          ['amount', 'Disputed', 'currencyFormat'],
          ['action', 'Verdict response', 'textFormat'],
          ['outcome', 'SIMULATED outcome', 'textFormat'],
          ['rightCall', 'Right call', 'integerFormat'],
          ['contested', 'Contested', 'integerFormat'],
          ['won', 'Won', 'integerFormat'],
          ['retained', 'Kept', 'currencyFormat'],
          ['refunded', 'Refunded', 'currencyFormat'],
          ['fees', 'Fees (simulated)', 'currencyFormat'],
          ['saved', 'Saved vs always-refund', 'currencyFormat'],
          ['escalated', 'Sent to a human', 'integerFormat'],
          ['injection', 'Injection attempts caught', 'integerFormat'],
          ['mode', 'Run mode', 'textFormat'],
          ['decisionSec', 'Seconds to decide', 'decimalFormat'],
          ['claim', 'Buyer claim', 'textFormat'],
          ['one', 'Runs', 'integerFormat', true],
        ]),
      },
    ],
    expressions: [
      ratio('rightCallRate', 'Right-call rate', 'Share of runs where the response served the merchant.', 'runs.rightCall', 'runs.one'),
      ratio('contestWinRate', 'Contest win rate', 'Contests won / contests.', 'runs.won', 'runs.contested'),
    ],
  } as AgDataSourcesDefinition;
}

const at = (xTrack: number, yTrack: number, xSpan: number, ySpan: number): AgWidgetLayoutState => ({ xTrack, yTrack, xSpan, ySpan });
const FONT = 'Inter, ui-sans-serif, system-ui, sans-serif';
const typo = (fontSize: number, fontWeight: 'normal' | 'bold' = 'normal') => ({ fontFamily: FONT, fontSize, fontWeight, fontStyle: 'normal' as const });
const title = (text: string, subtitle?: string) => ({ title: { enabled: true, text }, ...(subtitle ? { subtitle: { enabled: true, text: subtitle } } : {}) });
const kpi = (text: string, value: { id: string; aggregation?: 'sum' | 'avg' }, caption: string) => ({
  type: 'value' as const,
  dataMapping: { value: [value] },
  format: { title: { enabled: true, text, typography: typo(13, 'bold') }, caption: { enabled: true, text: caption, typography: typo(12) }, style: { typography: typo(28) } },
});
const legend = { style: { theme: { common: { legend: { enabled: true } } } } };

export const ARENA_REPORT = {
  selectedPageId: 'arena',
  panels: { filters: { collapsed: true } },
  pages: [
    {
      id: 'arena',
      widgets: {
        'kpi-runs': kpi('Runs', sum('runs.one'), 'simulated disputes'),
        'kpi-right': kpi('Right call', { id: 'rightCallRate' }, 'given the hidden truth'),
        'kpi-won': kpi('Contests won', { id: 'contestWinRate' }, 'SIMULATED arbiter'),
        'kpi-saved': kpi('Saved', sum('runs.saved'), 'vs an always-refund shop'),
        'by-type': {
          type: 'column-chart-stacked',
          dataMapping: { categoryKey: [{ id: 'runs.type' }], valueKey: [sum('runs.one')], legendKey: [{ id: 'runs.outcome' }] },
          format: { ...title('Outcomes by dispute type', 'SIMULATED'), ...legend },
        },
        'by-persona': {
          type: 'column-chart-stacked',
          dataMapping: { categoryKey: [{ id: 'runs.persona' }], valueKey: [sum('runs.one')], legendKey: [{ id: 'runs.action' }] },
          format: { ...title("Verdict's response by buyer persona"), ...legend },
        },
        money: {
          type: 'bar-chart-grouped',
          dataMapping: { categoryKey: [{ id: 'runs.type' }], valueKey: [sum('runs.retained'), sum('runs.refunded'), sum('runs.fees')] },
          format: { ...title('Money by dispute type', 'kept, refunded and SIMULATED fees'), ...legend },
        },
        runs: {
          type: 'grid',
          dataMapping: {
            cols: [{ id: 'runs.type' }, { id: 'runs.variant' }, { id: 'runs.persona' }, { id: 'runs.truth' }, sum('runs.amount'), { id: 'runs.action' }, { id: 'runs.outcome' }, sum('runs.rightCall'), { id: 'runs.mode' }, { id: 'runs.claim' }],
          },
          format: title('Every run', 'Buyer claims are written live by a Claude buyer agent. Outcomes are SIMULATED.'),
        },
      },
      widgetLayout: {
        'kpi-runs': at(0, 0, 6, 7),
        'kpi-right': at(6, 0, 6, 7),
        'kpi-won': at(12, 0, 6, 7),
        'kpi-saved': at(18, 0, 6, 7),
        'by-type': at(0, 7, 8, 18),
        'by-persona': at(8, 7, 8, 18),
        money: at(16, 7, 8, 18),
        runs: at(0, 25, 24, 24),
      },
    },
  ],
} as unknown as AgReportState;
