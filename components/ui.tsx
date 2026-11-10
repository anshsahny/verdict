'use client';

// Small shared UI kit: buttons, badges, cards and toasts, so every screen looks and behaves the same.

import Link from 'next/link';
import { createContext, useCallback, useContext, useEffect, useState, type ButtonHTMLAttributes, type ReactNode } from 'react';

type Variant = 'primary' | 'secondary' | 'ghost' | 'danger' | 'dark';
const VARIANT: Record<Variant, string> = {
  primary: 'bg-v-accent text-v-accent-ink hover:brightness-110 shadow-sm',
  secondary: 'border border-v-border bg-v-surface text-v-ink hover:bg-v-highlight',
  ghost: 'text-v-accent hover:bg-v-highlight',
  danger: 'bg-v-danger text-white hover:brightness-110',
  dark: 'bg-v-ink text-v-canvas hover:opacity-90',
};
const SIZE = { sm: 'px-3 py-1.5 text-sm', md: 'px-4 py-2 text-sm', lg: 'px-5 py-2.5 text-[15px]' };

export function Button({ variant = 'primary', size = 'md', className = '', ...rest }: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant; size?: keyof typeof SIZE }) {
  return (
    <button
      type="button"
      {...rest}
      className={`inline-flex items-center justify-center gap-2 rounded-lg font-semibold transition disabled:cursor-not-allowed disabled:opacity-60 ${VARIANT[variant]} ${SIZE[size]} ${className}`}
    />
  );
}

export function ButtonLink({ href, variant = 'primary', size = 'md', children, className = '' }: { href: string; variant?: Variant; size?: keyof typeof SIZE; children: ReactNode; className?: string }) {
  return (
    <Link href={href} className={`inline-flex items-center justify-center gap-2 rounded-lg font-semibold transition ${VARIANT[variant]} ${SIZE[size]} ${className}`}>
      {children}
    </Link>
  );
}

export type Tone = 'win' | 'warn' | 'danger' | 'muted' | 'sim' | 'accent';
const TONE: Record<Tone, string> = {
  win: 'bg-v-win-soft text-v-win',
  warn: 'bg-v-warn-soft text-v-warn',
  danger: 'bg-v-danger-soft text-v-danger',
  muted: 'bg-v-highlight text-v-muted',
  sim: 'bg-v-sim-soft text-v-sim',
  accent: 'bg-v-info-soft text-v-accent',
};
export function Badge({ tone = 'muted', children, className = '' }: { tone?: Tone; children: ReactNode; className?: string }) {
  return <span className={`inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-xs font-semibold ${TONE[tone]} ${className}`}>{children}</span>;
}

export function Card({ title, subtitle, right, children, className = '', padded = true }: { title?: ReactNode; subtitle?: ReactNode; right?: ReactNode; children: ReactNode; className?: string; padded?: boolean }) {
  return (
    <section className={`rounded-2xl border border-v-border bg-v-surface shadow-[0_1px_2px_rgba(16,24,40,0.04)] ${padded ? 'p-5' : ''} ${className}`}>
      {title || right ? (
        <div className={`flex items-start justify-between gap-3 ${padded ? 'mb-4' : 'px-5 pt-5 pb-3'}`}>
          <div>
            {title ? <h2 className="text-[15px] font-semibold text-v-ink">{title}</h2> : null}
            {subtitle ? <p className="mt-0.5 text-sm text-v-muted">{subtitle}</p> : null}
          </div>
          {right}
        </div>
      ) : null}
      {children}
    </section>
  );
}

export const usd = (n: number | null | undefined, digits = 2) =>
  n == null ? '—' : n.toLocaleString('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: digits, maximumFractionDigits: digits });

// --- Toasts -----------------------------------------------------------------------------------------

type Toast = { id: number; title: string; body?: string; tone: 'win' | 'danger' | 'accent' };
const ToastCtx = createContext<(t: Omit<Toast, 'id'>) => void>(() => {});
export const useToast = () => useContext(ToastCtx);

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const push = useCallback((t: Omit<Toast, 'id'>) => setToasts((ts) => [...ts, { ...t, id: Date.now() + Math.random() }]), []);
  return (
    <ToastCtx.Provider value={push}>
      {children}
      <div className="pointer-events-none fixed bottom-14 right-5 z-50 flex w-[360px] max-w-[calc(100vw-2.5rem)] flex-col gap-2" aria-live="polite" role="status">
        {toasts.map((t) => (
          <ToastItem key={t.id} toast={t} onDone={() => setToasts((ts) => ts.filter((x) => x.id !== t.id))} />
        ))}
      </div>
    </ToastCtx.Provider>
  );
}

function ToastItem({ toast, onDone }: { toast: Toast; onDone: () => void }) {
  useEffect(() => {
    const t = setTimeout(onDone, 6000);
    return () => clearTimeout(t);
  }, [onDone]);
  const bar = toast.tone === 'win' ? 'bg-v-win' : toast.tone === 'danger' ? 'bg-v-danger' : 'bg-v-accent';
  return (
    <div className="pointer-events-auto flex overflow-hidden rounded-xl border border-v-border bg-v-surface shadow-lg">
      <span className={`w-1.5 shrink-0 ${bar}`} aria-hidden />
      <div className="p-3.5">
        <p className="text-sm font-semibold text-v-ink">{toast.title}</p>
        {toast.body ? <p className="mt-0.5 text-sm text-v-muted">{toast.body}</p> : null}
      </div>
      <button type="button" onClick={onDone} className="ml-auto px-3 text-v-muted hover:text-v-ink" aria-label="Dismiss notification">
        ×
      </button>
    </div>
  );
}
