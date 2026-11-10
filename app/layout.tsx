import type { Metadata } from 'next';
import { Inter, JetBrains_Mono } from 'next/font/google';
import { connection } from 'next/server';
import { Shell } from '@/components/shell';
import { getDb } from '@/lib/db';
import { appMode } from '@/lib/mode';
import './globals.css';

const inter = Inter({ variable: '--font-inter', subsets: ['latin'] });
const mono = JetBrains_Mono({ variable: '--font-mono-face', subsets: ['latin'] });

export const metadata: Metadata = {
  title: { template: '%s · Verdict', default: 'Verdict' },
  description: 'AI dispute clerk for small PayPal merchants, with an Arena that stress-tests its strategy.',
};

// Set the theme before first paint: saved choice, else the system preference. Studio follows via
// data-ag-theme-mode on <body>.
const themeScript = `(function(){try{var t=localStorage.getItem('verdict-theme');if(t!=='light'&&t!=='dark'){t=matchMedia('(prefers-color-scheme: dark)').matches?'dark':'light'}document.documentElement.dataset.theme=t;document.documentElement.dataset.agThemeMode=t}catch(e){}})()`;

export default async function RootLayout({ children }: LayoutProps<'/'>) {
  await connection(); // the sidebar's waiting count is live
  const db = getDb();
  const merchant = (db.prepare("SELECT name FROM merchants LIMIT 1").get() as { name: string } | undefined)?.name ?? 'Your store';
  const { n: waiting } = db.prepare("SELECT COUNT(*) AS n FROM disputes WHERE status = 'WAITING_FOR_SELLER_RESPONSE'").get() as { n: number };
  return (
    <html lang="en" className={`${inter.variable} ${mono.variable}`} suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeScript }} />
      </head>
      <body>
        <Shell mode={appMode()} merchant={merchant} waiting={waiting}>
          {children}
        </Shell>
      </body>
    </html>
  );
}
