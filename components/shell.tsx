'use client';

// App frame: sidebar with the merchant's account and PayPal connection, navigation (with a live
// count of disputes waiting on the merchant), theme toggle, toasts, and a slim footer that always
// says LIVE (PayPal sandbox) or REPLAY (recorded sandbox data) and that Arena outcomes are SIMULATED.

import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useEffect, useState, type ReactNode } from 'react';
import type { AppMode } from '@/lib/mode';
import { Logo } from './logo';
import { ToastProvider, useToast } from './ui';

const NAV = [
  { href: '/war-room', label: 'War Room', icon: 'M4 13h4l2-6 4 12 2-6h4', badge: true, match: ['/war-room', '/disputes'] },
  { href: '/arena', label: 'Arena', icon: 'M5 19 19 5M9 5H5v4M15 19h4v-4M14 10l5-5M5 19l5-5', match: ['/arena'] },
  { href: '/playbook', label: 'Playbook', icon: 'M6 4h10l3 3v13H6zM9 9h6M9 13h6M9 17h4', match: ['/playbook'] },
];

function Icon({ d, className = 'size-[18px]' }: { d: string; className?: string }) {
  return (
    <svg aria-hidden viewBox="0 0 24 24" className={className} fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round">
      <path d={d} />
    </svg>
  );
}

function ThemeToggle() {
  const [theme, setTheme] = useState<'light' | 'dark' | null>(null);
  useEffect(() => setTheme(document.documentElement.dataset.theme === 'dark' ? 'dark' : 'light'), []);
  const flip = () => {
    const next = theme === 'dark' ? 'light' : 'dark';
    document.documentElement.dataset.theme = next;
    document.documentElement.dataset.agThemeMode = next;
    try {
      localStorage.setItem('verdict-theme', next);
    } catch {
      /* private mode: the toggle still works for this page */
    }
    setTheme(next);
  };
  return (
    <button
      type="button"
      onClick={flip}
      className="flex w-full items-center gap-3 rounded-lg px-3 py-2 text-sm text-v-muted hover:bg-v-highlight hover:text-v-ink"
      aria-label={theme === 'dark' ? 'Switch to light theme' : 'Switch to dark theme'}
    >
      <Icon d={theme === 'dark' ? 'M12 3v2M12 19v2M5 5l1.5 1.5M17.5 17.5 19 19M3 12h2M19 12h2M5 19l1.5-1.5M17.5 6.5 19 5M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8z' : 'M21 13A9 9 0 1 1 11 3a7 7 0 0 0 10 10z'} />
      {theme === 'dark' ? 'Light theme' : 'Dark theme'}
    </button>
  );
}

export function ModeBadge({ mode }: { mode: AppMode }) {
  return mode === 'live' ? (
    <span className="inline-flex items-center gap-1.5 rounded-full bg-v-win-soft px-2.5 py-0.5 text-xs font-semibold text-v-win">
      <span className="size-1.5 rounded-full bg-v-win" aria-hidden />
      LIVE · PayPal sandbox
    </span>
  ) : (
    <span className="inline-flex items-center gap-1.5 rounded-full bg-v-warn-soft px-2.5 py-0.5 text-xs font-semibold text-v-warn">
      <span className="size-1.5 rounded-full bg-v-warn" aria-hidden />
      REPLAY · recorded sandbox disputes, dates shifted to today
    </span>
  );
}

// REPLAY only: anyone can put the shared demo back to where it started.
function ResetDemo() {
  const router = useRouter();
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  async function reset() {
    setBusy(true);
    try {
      const res = await fetch('/api/demo/reset', { method: 'POST' });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json.error ?? `Request failed (${res.status})`);
      toast({ tone: 'win', title: 'Demo reset', body: 'Every dispute is back where it started.' });
      router.refresh();
    } catch (e) {
      toast({ tone: 'danger', title: 'Couldn’t reset the demo', body: (e as Error).message });
    } finally {
      setBusy(false);
    }
  }
  return (
    <button type="button" onClick={reset} disabled={busy} className="font-medium text-v-accent hover:underline disabled:opacity-60">
      {busy ? 'Resetting…' : 'Reset demo'}
    </button>
  );
}

function Account({ mode, merchant }: { mode: AppMode; merchant: string }) {
  const initials = merchant
    .split(/\s+/)
    .filter((w) => /^[A-Za-z]/.test(w))
    .map((w) => w[0])
    .join('')
    .slice(0, 2);
  return (
    <div className="rounded-xl border border-v-border bg-v-raised p-3">
      <div className="flex items-center gap-2.5">
        <span className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-v-ink text-xs font-bold text-v-canvas" aria-hidden>
          {initials}
        </span>
        <div className="min-w-0">
          <p className="truncate text-sm font-semibold text-v-ink">{merchant}</p>
          <p className="flex items-center gap-1.5 text-xs text-v-muted">
            <span className={`size-1.5 rounded-full ${mode === 'live' ? 'bg-v-win' : 'bg-v-warn'}`} aria-hidden />
            PayPal {mode === 'live' ? 'connected · sandbox' : 'replay'}
          </p>
        </div>
      </div>
    </div>
  );
}

export function Shell({ mode, merchant, waiting, children }: { mode: AppMode; merchant: string; waiting: number; children: ReactNode }) {
  const path = usePathname();
  const isActive = (n: (typeof NAV)[number]) => n.match.some((m) => path.startsWith(m));
  return (
    <ToastProvider>
      <div className="flex min-h-full">
        <a href="#main" className="sr-only focus:not-sr-only focus:absolute focus:left-3 focus:top-3 focus:z-50 focus:rounded focus:bg-v-surface focus:px-3 focus:py-2">
          Skip to content
        </a>
        <aside className="sticky top-0 hidden h-screen w-60 shrink-0 flex-col gap-5 border-r border-v-border bg-v-surface px-3 py-5 lg:flex">
          <Link href="/war-room" className="flex items-center gap-2 px-2" aria-label="Verdict home">
            <Logo />
          </Link>
          <Account mode={mode} merchant={merchant} />
          <nav aria-label="Main" className="flex flex-col gap-1">
            {NAV.map((n) => {
              const active = isActive(n);
              return (
                <Link
                  key={n.href}
                  href={n.href}
                  aria-current={active ? 'page' : undefined}
                  className={`flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium ${active ? 'bg-v-highlight text-v-ink' : 'text-v-muted hover:bg-v-highlight hover:text-v-ink'}`}
                >
                  <Icon d={n.icon} />
                  {n.label}
                  {n.badge && waiting > 0 ? (
                    <span className="ml-auto rounded-full bg-v-accent px-2 py-0.5 text-[11px] font-bold text-v-accent-ink" aria-label={`${waiting} waiting on you`}>
                      {waiting}
                    </span>
                  ) : null}
                </Link>
              );
            })}
          </nav>
          <div className="mt-auto flex flex-col gap-1">
            <ThemeToggle />
            <a href="https://github.com/anshsahny/verdict" className="flex items-center gap-3 rounded-lg px-3 py-2 text-sm text-v-muted hover:bg-v-highlight hover:text-v-ink">
              <Icon d="M9 19c-4 1.3-4-2-6-2.5M15 21v-3.5c0-1 .1-1.4-.5-2 2.8-.3 5.5-1.4 5.5-6a4.6 4.6 0 0 0-1.3-3.2 4.2 4.2 0 0 0-.1-3.2s-1.1-.3-3.5 1.3a12 12 0 0 0-6.2 0C6.5 2.8 5.4 3.1 5.4 3.1a4.2 4.2 0 0 0-.1 3.2A4.6 4.6 0 0 0 4 9.5c0 4.6 2.7 5.7 5.5 6-.6.6-.6 1.2-.5 2V21" />
              Open source (MIT)
            </a>
          </div>
        </aside>
        <div className="flex min-w-0 flex-1 flex-col">
          <header className="flex items-center justify-between gap-3 border-b border-v-border bg-v-surface px-4 py-2 lg:hidden">
            <Link href="/war-room" aria-label="Verdict home">
              <Logo />
            </Link>
            <nav aria-label="Main" className="flex gap-4 text-sm">
              {NAV.map((n) => (
                <Link key={n.href} href={n.href} aria-current={isActive(n) ? 'page' : undefined} className={isActive(n) ? 'font-semibold text-v-ink' : 'text-v-muted hover:text-v-ink'}>
                  {n.label}
                  {n.badge && waiting > 0 ? <span className="ml-1 text-v-accent">({waiting})</span> : null}
                </Link>
              ))}
            </nav>
          </header>
          <main id="main" className="flex min-h-0 flex-1 flex-col">
            {children}
          </main>
          <footer className="flex flex-wrap items-center justify-between gap-2 border-t border-v-border bg-v-surface px-5 py-2 text-xs text-v-muted">
            <span className="flex items-center gap-3">
              <ModeBadge mode={mode} />
              {mode === 'replay' ? <ResetDemo /> : null}
            </span>
            <span>
              Verdict suggests; you decide. Arena outcomes use a <strong className="font-semibold text-v-sim">SIMULATED</strong> arbiter, not PayPal.
            </span>
          </footer>
        </div>
      </div>
    </ToastProvider>
  );
}
