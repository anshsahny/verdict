'use client';

// The War Room: one AG Studio instance over the dispute ledger, with Verdict's custom widgets and
// cell renderers. View mode by default; the owner can switch to edit to build their own widgets.

import Link from 'next/link';
import { useMemo, useState, useSyncExternalStore } from 'react';
import { AgStudioAiModule, createAiHarness, type AgAiHarnessSetup, type AgStudioMode } from 'ag-studio';
import { AgStudio, AgStudioProvider } from 'ag-studio-react';
import { Button, usd } from '@/components/ui';
import { formatRemaining } from '@/lib/disputes/deadline';
import { Inbox, type InboxItem, type RecentItem } from './inbox';
import { verdictStudioLocale, verdictStudioTheme } from '@/lib/ui/studio-theme';
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

// The assistant panel mounts a moment after edit mode turns on; wait for its message box, then focus it.
function focusAssistantInput(triesLeft = 20) {
  const input = document.querySelector<HTMLTextAreaElement>('#studio textarea[placeholder^="Ask the AI"]');
  if (input) input.focus({ preventScroll: true });
  else if (triesLeft > 0) setTimeout(() => focusAssistantInput(triesLeft - 1), 100);
}

export function WarRoom({ data, inbox, recent, licenseKey, aiEnabled }: { data: WarRoomData; inbox: InboxItem[]; recent: RecentItem[]; licenseKey?: string; aiEnabled: boolean }) {
  // Studio needs the browser (layout measurement); render a skeleton on the server.
  const inBrowser = useSyncExternalStore(noSubscription, () => true, () => false);
  const [mode, setMode] = useState<AgStudioMode>('view');
  const studioData = useMemo(() => warRoomData(data), [data]);
  const atStake = inbox.reduce((s, d) => s + d.amount, 0);
  const next = inbox.find((i) => i.dueAt);
  const nextIn = next?.dueAt ? formatRemaining(Date.parse(next.dueAt) - Date.parse(data.asOf)) : null;
  const toggleEdit = (focusChat = false) => {
    setMode((m) => (m === 'view' ? 'edit' : 'view'));
    document.getElementById('insights')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    if (focusChat && mode === 'view') focusAssistantInput();
  };

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="border-b border-v-border bg-v-surface px-6 py-5">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight text-v-ink">War Room</h1>
            <p className="mt-1 text-[15px] text-v-muted" suppressHydrationWarning>
              {inbox.length ? (
                <>
                  <strong className="font-semibold text-v-ink">
                    {inbox.length} dispute{inbox.length === 1 ? '' : 's'} need{inbox.length === 1 ? 's' : ''} a decision
                  </strong>{' '}
                  · {usd(atStake)} at stake{nextIn ? <> · next deadline in {nextIn}</> : null}
                </>
              ) : (
                'Nothing needs you right now. New disputes appear here within seconds.'
              )}
            </p>
          </div>
          <div className="flex items-center gap-3">
            <Link href="/#how" className="text-sm font-medium text-v-muted hover:text-v-ink">
              How Verdict works
            </Link>
            {aiEnabled ? (
              <Button variant="secondary" onClick={() => toggleEdit(true)} aria-pressed={mode === 'edit'}>
                {mode === 'view' ? 'Ask the AI assistant' : 'Close assistant'}
              </Button>
            ) : null}
          </div>
        </div>
      </div>
      <div className="space-y-5 p-6">
        <Inbox items={inbox} recent={recent} asOf={data.asOf} />
      </div>
      <div id="insights" className="flex flex-wrap items-end justify-between gap-3 px-6 pb-1 pt-2">
        <div>
          <h2 className="text-lg font-semibold text-v-ink">Insights</h2>
          <p className="text-sm text-v-muted">Every dispute, live. Built with AG Studio: rearrange it, or ask the AI assistant to add a chart.</p>
        </div>
        <Button variant="secondary" size="sm" onClick={() => toggleEdit()} aria-pressed={mode === 'edit'}>
          {mode === 'view' ? 'Customize' : 'Done'}
        </Button>
      </div>
      {/* While editing, fit the studio to the screen so the assistant's message box is visible; the canvas scrolls inside. */}
      <div id="studio" className={`shrink-0 ${mode === 'edit' ? 'h-[calc(100dvh-5rem)] min-h-[560px]' : 'h-[1140px]'}`}>
        {inBrowser ? (
          <AgStudioProvider licenseKey={licenseKey} modules={aiEnabled ? [AgStudioAiModule] : undefined}>
            <AgStudio
              style={{ height: '100%', width: '100%' }}
              theme={verdictStudioTheme}
              localeText={verdictStudioLocale}
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
