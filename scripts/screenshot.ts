// Captures the War Room for the landing page hero, in both themes (public/screens/war-room-{light,dark}.png).
//   npm run dev   (or any running instance), then:
//   npx tsx scripts/screenshot.ts [baseUrl]

import { mkdirSync } from 'node:fs';
import { chromium } from '@playwright/test';

async function main() {
  const base = process.argv[2] ?? 'http://localhost:3000';
  const browser = await chromium.launch();
  mkdirSync('public/screens', { recursive: true });
  for (const theme of ['light', 'dark'] as const) {
    const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1, colorScheme: theme });
    await page.addInitScript((t) => localStorage.setItem('verdict-theme', t), theme);
    await page.goto(`${base}/war-room`, { waitUntil: 'networkidle' });
    await page.getByRole('heading', { name: 'Needs your decision' }).waitFor();
    await page.waitForTimeout(2500); // let the Studio widgets finish loading their data
    await page.screenshot({ path: `public/screens/war-room-${theme}.png` });
    await page.close();
    console.log(`public/screens/war-room-${theme}.png`);
  }
  await browser.close();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
