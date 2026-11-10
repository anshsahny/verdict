// The War Room in AG Studio: data sources over the dispute ledger and the default report.
// Field ids ('disputes.amount') refer to the sources defined here.

import type { AgDataSourcesDefinition, AgFieldDefinition, AgFormat, AgReportState, AgWidgetLayoutState } from 'ag-studio';
import type { DisputeListRow, TimelineEntry } from '@/lib/views/disputes';

export type WarRoomData = { disputes: (DisputeListRow & { due48: number; queueRank: number })[]; events: (TimelineEntry & { id: string; disputeId: string })[]; asOf: string };

type FieldSpec = [id: string, name: string, format: AgFormat, hide?: boolean];
const fields = (specs: FieldSpec[]): AgFieldDefinition[] => specs.map(([id, name, format, hide]) => ({ id, name, format, ...(hide && { hide }) }));
const sum = (id: string) => ({ id, aggregation: 'sum' as const });

export function warRoomData(data: WarRoomData): AgDataSourcesDefinition {
  return {
    description:
      "Kiln & Co.'s PayPal disputes (PayPal sandbox), one row per dispute, with Verdict's evidence strength and recommendation, plus a feed of dispute events. " +
      'Amounts are USD. "atRisk" is the disputed amount while a dispute is open. Win rate = disputes resolved in the seller\'s favour / resolved disputes.',
    sources: [
      {
        id: 'disputes',
        description: 'One row per PayPal dispute.',
        data: data.disputes,
        fields: fields([
          ['id', 'Dispute', 'textFormat'],
          ['reason', 'Reason', 'textFormat'],
          ['stage', 'Stage', 'textFormat'],
          ['status', 'Status', 'textFormat'],
          ['state', 'Open / resolved', 'textFormat'],
          ['amount', 'Amount', 'currencyFormat'],
          ['dueAt', 'Response due', 'textFormat'],
          ['timeLeft', 'Time left', 'textFormat', true],
          ['urgency', 'Urgency', 'textFormat'],
          ['orderId', 'Order', 'textFormat'],
          ['customer', 'Customer', 'textFormat'],
          ['filedDate', 'Filed', 'dateFormat'],
          ['strength', 'Evidence strength', 'decimalFormat'],
          ['rating', 'Evidence rating', 'textFormat'],
          ['recommendation', 'Verdict recommends', 'textFormat'],
          ['decisionStatus', 'Decision status', 'textFormat'],
          ['outcome', 'Outcome', 'textFormat'],
          ['atRisk', '$ at risk', 'currencyFormat'],
          ['won', 'Won', 'integerFormat'],
          ['resolved', 'Resolved', 'integerFormat'],
          ['due48', 'Due within 48h', 'integerFormat'],
          ['queueRank', 'Queue order', 'decimalFormat', true],
          ['respondedHours', 'Hours to first response', 'decimalFormat'],
          ['whyRecommended', "Verdict's reasoning", 'textFormat'],
        ]),
      },
      {
        id: 'events',
        description: 'Dispute history: PayPal updates (webhooks and polling), Verdict recommendations and owner approvals.',
        data: data.events,
        fields: fields([
          ['id', 'Event ID', 'textFormat', true],
          ['disputeId', 'Dispute', 'textFormat'],
          ['at', 'Time', 'textFormat'],
          ['title', 'Event', 'textFormat'],
          ['kind', 'Actor', 'textFormat'],
          ['detail', 'Detail', 'textFormat'],
        ]),
      },
    ],
    relationships: [
      { id: 'event-dispute', source: { tableId: 'events', fieldId: 'disputeId' }, target: { tableId: 'disputes', fieldId: 'id' }, type: 'many-to-one' },
    ],
    expressions: [
      {
        id: 'winRate',
        name: 'Win rate',
        description: "Disputes resolved in the seller's favour / resolved disputes.",
        format: 'percentageFormat',
        isMeasure: true,
        expression: { operator: 'divide', inputs: [sum('disputes.won'), sum('disputes.resolved')] },
      },
    ],
  } as AgDataSourcesDefinition;
}

// --- default report -----------------------------------------------------------------------------

const at = (xTrack: number, yTrack: number, xSpan: number, ySpan: number): AgWidgetLayoutState => ({ xTrack, yTrack, xSpan, ySpan });
const FONT = 'Inter, ui-sans-serif, system-ui, sans-serif';
const typo = (fontSize: number, fontWeight: 'normal' | 'bold' = 'normal') => ({ fontFamily: FONT, fontSize, fontWeight, fontStyle: 'normal' as const });
const title = (text: string, subtitle?: string) => ({
  title: { enabled: true, text },
  ...(subtitle ? { subtitle: { enabled: true, text: subtitle } } : {}),
});
const kpi = (text: string, value: { id: string; aggregation?: 'sum' | 'avg' }, caption: string) => ({
  type: 'value' as const,
  dataMapping: { value: [value] },
  format: {
    title: { enabled: true, text, typography: typo(13, 'bold') },
    caption: { enabled: true, text: caption, typography: typo(12) },
    style: { typography: typo(28) },
  },
});

export const WAR_ROOM_REPORT = {
  selectedPageId: 'war-room',
  panels: { filters: { collapsed: true }, ai: { collapsed: true } },
  pages: [
    {
      id: 'war-room',
      widgets: {
        'kpi-at-risk': kpi('$ at risk', sum('disputes.atRisk'), 'open disputes'),
        'kpi-win-rate': kpi('Win rate', { id: 'winRate' }, 'resolved in our favour'),
        'kpi-due': kpi('Due within 48h', sum('disputes.due48'), 'need a response now'),
        'kpi-response': kpi('Avg time to respond', { id: 'disputes.respondedHours', aggregation: 'avg' }, 'hours from claim to action'),
        clocks: {
          type: 'deadline-clocks',
          dataMapping: { dispute: [{ id: 'disputes.id' }], due: [{ id: 'disputes.dueAt' }], amount: [sum('disputes.amount')] },
          format: title('Response deadlines', 'Soonest first. PayPal decides against you if the clock runs out.'),
        },
        strength: {
          type: 'evidence-meter',
          dataMapping: { strength: [{ id: 'disputes.strength', aggregation: 'avg' }] },
          format: title('Evidence strength'),
        },
        queue: {
          type: 'grid',
          dataMapping: {
            cols: [
              { id: 'disputes.id' },
              { id: 'disputes.reason' },
              { id: 'disputes.status' },
              sum('disputes.amount'),
              { id: 'disputes.dueAt' },
              { id: 'disputes.strength' },
              { id: 'disputes.recommendation' },
              { id: 'disputes.outcome' },
            ],
          },
          // One sort field per grid: Waiting on us > Waiting on buyer > Under review > Resolved. Rows
          // arrive pre-ordered by deadline (page.tsx), which holds within each status.
          sort: [{ field: { id: 'disputes.status' }, direction: 'desc' }],
          format: title('Dispute queue', 'Open a dispute for its Case File. Select a row to focus the other widgets.'),
        },
        timeline: {
          type: 'dispute-timeline',
          dataMapping: { at: [{ id: 'events.at' }], title: [{ id: 'events.title' }], kind: [{ id: 'events.kind' }], dispute: [{ id: 'events.disputeId' }] },
          format: title('Activity'),
        },
        'by-reason': {
          type: 'column-chart-stacked',
          dataMapping: { categoryKey: [{ id: 'disputes.reason' }], valueKey: [sum('disputes.amount')], legendKey: [{ id: 'disputes.outcome' }] },
          format: { ...title('Disputed $ by reason and outcome'), style: { theme: { common: { legend: { enabled: true } } } } },
        },
        'by-status': {
          type: 'donut-chart',
          dataMapping: { categoryKey: [{ id: 'disputes.status' }], valueKey: [sum('disputes.amount')] },
          format: { ...title('Disputed $ by status'), style: { theme: { common: { legend: { enabled: true } } } } },
        },
      },
      widgetLayout: {
        'kpi-at-risk': at(0, 0, 6, 7),
        'kpi-win-rate': at(6, 0, 6, 7),
        'kpi-due': at(12, 0, 6, 7),
        'kpi-response': at(18, 0, 6, 7),
        clocks: at(0, 7, 16, 11),
        strength: at(16, 7, 8, 11),
        queue: at(0, 18, 24, 22),
        timeline: at(0, 40, 8, 20),
        'by-reason': at(8, 40, 8, 20),
        'by-status': at(16, 40, 8, 20),
      },
    },
  ],
} as unknown as AgReportState;
