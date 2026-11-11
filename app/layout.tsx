import type { Metadata } from 'next';
import { Inter, JetBrains_Mono } from 'next/font/google';
import './globals.css';

const inter = Inter({ variable: '--font-inter', subsets: ['latin'] });
const mono = JetBrains_Mono({ variable: '--font-mono-face', subsets: ['latin'] });

export const metadata: Metadata = {
  title: { template: '%s · Verdict', default: 'Verdict · AI dispute clerk for PayPal merchants' },
  description: 'Verdict watches your PayPal disputes, builds the case from your own records, and proposes a response. You approve every action.',
};

// Set the theme before first paint: saved choice, else the system preference. Studio follows via
// data-ag-theme-mode.
const themeScript = `(function(){try{var t=localStorage.getItem('verdict-theme');if(t!=='light'&&t!=='dark'){t=matchMedia('(prefers-color-scheme: dark)').matches?'dark':'light'}document.documentElement.dataset.theme=t;document.documentElement.dataset.agThemeMode=t}catch(e){}})()`;

export default function RootLayout({ children }: LayoutProps<'/'>) {
  return (
    <html lang="en" className={`${inter.variable} ${mono.variable}`} suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeScript }} />
      </head>
      <body>{children}</body>
    </html>
  );
}
