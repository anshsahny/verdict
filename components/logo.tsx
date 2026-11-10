// Wordmark: a balance mark (two pans, one tipped toward the merchant) and the name.
export function Logo() {
  return (
    <span className="flex items-center gap-2">
      <svg aria-hidden viewBox="0 0 32 32" className="size-7">
        <rect width="32" height="32" rx="8" fill="var(--v-ink)" />
        <path d="M16 7v18M10 25h12" stroke="var(--v-canvas)" strokeWidth="2" strokeLinecap="round" />
        <path d="M7 12.5 25 10.5" stroke="var(--v-canvas)" strokeWidth="2" strokeLinecap="round" />
        <path d="M5 18a3.2 3.2 0 0 0 6.4 0L8.2 12.8 5 18z" fill="var(--v-win)" />
        <path d="M20.6 16a3.2 3.2 0 0 0 6.4 0l-3.2-5.2L20.6 16z" fill="var(--v-canvas)" />
      </svg>
      <span className="text-[17px] font-semibold tracking-tight text-v-ink">Verdict</span>
    </span>
  );
}
