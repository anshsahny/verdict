import { connection } from 'next/server';
import { Shell } from '@/components/shell';
import { getDb } from '@/lib/db';
import { appMode } from '@/lib/mode';

// The product (War Room, Case File, Arena, Playbook) inside the app shell. The landing page at /
// sits outside it.
export default async function AppLayout({ children }: LayoutProps<'/'>) {
  await connection(); // the sidebar's waiting count is live
  const db = getDb();
  const merchant = (db.prepare('SELECT name FROM merchants LIMIT 1').get() as { name: string } | undefined)?.name ?? 'Your store';
  const { n: waiting } = db.prepare("SELECT COUNT(*) AS n FROM disputes WHERE status = 'WAITING_FOR_SELLER_RESPONSE'").get() as { n: number };
  return (
    <Shell mode={appMode()} merchant={merchant} waiting={waiting}>
      {children}
    </Shell>
  );
}
