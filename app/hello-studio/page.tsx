import type { Metadata } from 'next';
import { HelloStudio } from './hello-studio';

export const metadata: Metadata = {
  title: 'AG Studio smoke test',
};

// Phase 0: proves AG Studio renders a grid and a chart with our licence key, with no licence banner.
export default function HelloStudioPage() {
  return (
    <main className="flex h-screen flex-col">
      <h1 className="px-6 py-3 text-lg font-semibold">AG Studio smoke test</h1>
      <div className="min-h-0 flex-1">
        <HelloStudio licenseKey={process.env.AG_STUDIO_LICENSE_KEY} />
      </div>
    </main>
  );
}
