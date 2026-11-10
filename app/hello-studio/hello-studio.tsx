'use client';

// The smallest AG Studio report: one data source, one grid widget and one chart widget.

import type { AgDataSourcesDefinition, AgReportState } from 'ag-studio';
import { AgStudio, AgStudioProvider } from 'ag-studio-react';

const disputes = [
  { id: 'D-1', reason: 'Item not received', amount: 48, status: 'Open' },
  { id: 'D-2', reason: 'Not as described', amount: 120, status: 'Under review' },
  { id: 'D-3', reason: 'Item not received', amount: 36, status: 'Resolved' },
  { id: 'D-4', reason: 'Unauthorised', amount: 89, status: 'Open' },
  { id: 'D-5', reason: 'Duplicate charge', amount: 24, status: 'Open' },
];

const data: AgDataSourcesDefinition = {
  sources: [
    {
      id: 'disputes',
      data: disputes,
      fields: [
        { id: 'id', name: 'Dispute', format: 'textFormat' },
        { id: 'reason', name: 'Reason', format: 'textFormat' },
        { id: 'amount', name: 'Amount', format: 'currencyFormat' },
        { id: 'status', name: 'Status', format: 'textFormat' },
      ],
    },
  ],
};

const report: AgReportState = {
  selectedPageId: 'smoke',
  pages: [
    {
      id: 'smoke',
      widgets: {
        queue: {
          type: 'grid',
          dataMapping: {
            cols: [{ id: 'disputes.id' }, { id: 'disputes.reason' }, { id: 'disputes.status' }, { id: 'disputes.amount', aggregation: 'sum' }],
          },
          format: { title: { enabled: true, text: 'Dispute queue' } },
        },
        byReason: {
          type: 'column-chart-stacked',
          dataMapping: {
            categoryKey: [{ id: 'disputes.reason' }],
            valueKey: [{ id: 'disputes.amount', aggregation: 'sum' }],
          },
          format: { title: { enabled: true, text: '$ at risk by reason' } },
        },
      },
      widgetLayout: {
        queue: { xTrack: 0, yTrack: 0, xSpan: 14, ySpan: 24 },
        byReason: { xTrack: 14, yTrack: 0, xSpan: 10, ySpan: 24 },
      },
    },
  ],
};

export function HelloStudio({ licenseKey }: { licenseKey?: string }) {
  return (
    <AgStudioProvider licenseKey={licenseKey}>
      <AgStudio style={{ height: '100%', width: '100%' }} data={data} initialState={report} mode="view" />
    </AgStudioProvider>
  );
}
