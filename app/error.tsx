'use client';

// Route-level error boundary: a calm message instead of a stack trace. Details stay in server logs.
export default function RouteError({ reset }: { error: Error; reset: () => void }) {
  return (
    <div className="mx-auto max-w-md px-6 py-24 text-center" role="alert">
      <h1 className="text-xl font-semibold text-v-ink">Something went wrong</h1>
      <p className="mt-2 text-sm text-v-muted">The page couldn&apos;t load. Nothing was sent to PayPal.</p>
      <button type="button" onClick={reset} className="mt-6 rounded-md bg-v-accent px-4 py-2 text-sm font-semibold text-v-accent-ink">
        Try again
      </button>
    </div>
  );
}
