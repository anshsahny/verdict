import Link from 'next/link';

export default function NotFound() {
  return (
    <div className="mx-auto max-w-md px-6 py-24 text-center">
      <p className="text-sm font-semibold text-v-accent">404</p>
      <h1 className="mt-2 text-xl font-semibold text-v-ink">Nothing here</h1>
      <p className="mt-2 text-sm text-v-muted">That dispute or page doesn&apos;t exist in this ledger.</p>
      <Link href="/war-room" className="mt-6 inline-block rounded-md bg-v-accent px-4 py-2 text-sm font-semibold text-v-accent-ink">
        Back to the War Room
      </Link>
    </div>
  );
}
