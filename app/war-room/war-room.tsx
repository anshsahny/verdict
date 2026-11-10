'use client';

// The War Room: one AG Studio instance over the dispute ledger, with Verdict's custom widgets and
// cell renderers. View mode by default; the owner can switch to edit to build their own widgets.

import { useMemo, useState, useSyncExternalStore } from 'react';
import { AgStudioAiModule, createAiHarness, type AgAiHarnessSetup, type AgStudioMode } from 'ag-studio';
import { AgStudio, AgStudioProvider } from 'ag-studio-react';
import { PageHeader } from '@/components/page-header';
import { verdictStudioTheme } from '@/lib/ui/studio-theme';
import { WAR_ROOM_REPORT, warRoomData, type WarRoomData } from '@/lib/ui/war-room-report';
import { verdictWidgets } from '@/lib/ui/widgets';
import { claudeAdapter } from '@/lib/ui/claude-adapter';

const PROMPT_STARTERS = [
  { label: 'What needs me first?', prompt: 'Which open disputes need a response first, and how much is at risk on each?' },
  { label: 'Explain a recommendation', prompt: "Pick the open dispute with the most money at risk and explain Verdict's recommendation in plain words, using its reasoning field." },
  { label: 'Chart $ at risk by reason', prompt: 'Add a bar chart of $ at risk by dispute reason to this page.' },
];

// Studio's built-in agents (they can query the data and add or edit widgets), running on Claude.
const ai: AgAiHarnessSetup = ({ api }) => createAiHarness(api, { adapter: claudeAdapter(), promptStarters: PROMPT_STARTERS });

const noSubscription = () => () => {};

export function WarRoom({ data, licenseKey, aiEnabled }: { data: WarRoomData; licenseKey?: string; aiEnabled: boolean }) {
  // Studio needs the browser (layout measurement); render a skeleton on the server.
  const inBrowser = useSyncExternalStore(noSubscription, () => true, () => false);
  const [mode, setMode] = useState<AgStudioMode>('view');
  const studioData = useMemo(() => warRoomData(data), [data]);
  const open = data.disputes.filter((d) => d.state === 'Open');
  const atRisk = open.reduce((s, d) => s + d.amount, 0);

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <PageHeader
        title="War Room"
        subtitle={`${open.length} open dispute${open.length === 1 ? '' : 's'} · $${atRisk.toFixed(2)} at risk · live from the PayPal sandbox ledger`}
        actions={
          <button
            type="button"
            onClick={() => setMode((m) => (m === 'view' ? 'edit' : 'view'))}
            className="rounded-md border border-v-border bg-v-surface px-3 py-1.5 text-sm font-medium text-v-ink hover:bg-v-highlight"
            aria-pressed={mode === 'edit'}
          >
            {mode === 'view' ? (aiEnabled ? 'Customize & ask AI' : 'Customize') : 'Done'}
          </button>
        }
      />
      <div className="min-h-[900px] flex-1">
        {inBrowser ? (
          <AgStudioProvider licenseKey={licenseKey} modules={aiEnabled ? [AgStudioAiModule] : undefined}>
            <AgStudio
              style={{ height: '100%', width: '100%' }}
              theme={verdictStudioTheme}
              data={studioData}
              initialState={WAR_ROOM_REPORT}
              widgets={verdictWidgets}
              ai={aiEnabled ? ai : undefined}
              mode={mode}
            />
          </AgStudioProvider>
        ) : (
          <div className="h-full animate-pulse bg-v-canvas" aria-label="Loading the War Room" />
        )}
      </div>
    </div>
  );
}
