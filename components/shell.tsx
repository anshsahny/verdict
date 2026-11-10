'use client';

// App frame: sidebar navigation, theme toggle, and the footer that always says whether this is
// the LIVE PayPal sandbox or REPLAY (recorded sandbox responses).

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect, useState, type ReactNode } from 'react';
import type { AppMode } from '@/lib/mode';
import { Logo } from './logo';

const NAV = [
  { href: '/war-room', label: 'War Room', icon: 'M3 12h4l3-8 4 16 3-8h4' },
  { href: '/arena', label: 'Arena', icon: 'M5 19 19 5M9 5H5v4M15 19h4v-4M14 10l5-5M5 19l5-5' },
];

function Icon({ d }: { d: string }) {
  return (
    <svg aria-hidden viewBox="0 0 24 24" className="size-[18px]" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round">
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
      className="flex w-full items-center gap-3 rounded-md px-3 py-2 text-sm text-v-muted hover:bg-v-highlight hover:text-v-ink"
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
      REPLAY · recorded sandbox responses
    </span>
  );
}

export function Shell({ mode, children }: { mode: AppMode; children: ReactNode }) {
  const path = usePathname();
  return (
    <div className="flex min-h-full">
      <a href="#main" className="sr-only focus:not-sr-only focus:absolute focus:left-3 focus:top-3 focus:z-50 focus:rounded focus:bg-v-surface focus:px-3 focus:py-2">
        Skip to content
      </a>
      <aside className="sticky top-0 hidden h-screen w-56 shrink-0 flex-col border-r border-v-border bg-v-surface px-3 py-5 md:flex">
        <Link href="/war-room" className="mb-6 flex items-center gap-2 px-3" aria-label="Verdict home">
          <Logo />
        </Link>
        <nav aria-label="Main" className="flex flex-col gap-1">
          {NAV.map((n) => {
            const active = path.startsWith(n.href) || (n.href === '/war-room' && path.startsWith('/disputes'));
            return (
              <Link
                key={n.href}
                href={n.href}
                aria-current={active ? 'page' : undefined}
                className={`flex items-center gap-3 rounded-md px-3 py-2 text-sm font-medium ${active ? 'bg-v-highlight text-v-ink' : 'text-v-muted hover:bg-v-highlight hover:text-v-ink'}`}
              >
                <Icon d={n.icon} />
                {n.label}
              </Link>
            );
          })}
        </nav>
        <div className="mt-auto flex flex-col gap-3">
          <ThemeToggle />
          <p className="px-3 text-xs leading-relaxed text-v-faint">Kiln &amp; Co. · demo merchant</p>
        </div>
      </aside>
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex items-center justify-between border-b border-v-border bg-v-surface px-4 py-2 md:hidden">
          <Link href="/war-room" aria-label="Verdict home">
            <Logo />
          </Link>
          <nav aria-label="Main" className="flex gap-3 text-sm">
            {NAV.map((n) => (
              <Link key={n.href} href={n.href} className="text-v-muted hover:text-v-ink">
                {n.label}
              </Link>
            ))}
          </nav>
        </header>
        <main id="main" className="flex min-h-0 flex-1 flex-col">
          {children}
        </main>
        <footer className="flex flex-wrap items-center justify-between gap-2 border-t border-v-border bg-v-surface px-5 py-2 text-xs text-v-muted">
          <ModeBadge mode={mode} />
          <span>
            Arena outcomes come from a <strong className="font-semibold text-v-sim">SIMULATED</strong> rule-based arbiter, not PayPal. Open source, MIT.
          </span>
        </footer>
      </div>
    </div>
  );
}
