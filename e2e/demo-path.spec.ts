import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';

// The demo path: landing page → War Room → open a dispute → see the recommendation → approve → status changes →
// Arena → see the benchmark. Runs in REPLAY mode (recorded sandbox data), so it's repeatable.

function watchConsole(page: Page) {
  const errors: string[] = [];
  page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
  page.on('pageerror', (e) => errors.push(e.message));
  return errors;
}

async function a11y(page: Page) {
  // Our own UI must be free of serious/critical issues; AG Studio's internals are scanned too but
  // reported separately, since we don't control their markup.
  const results = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa']).analyze();
  const bad = results.violations.filter((v) => v.impact === 'serious' || v.impact === 'critical');
  const ours = bad.filter((v) => v.nodes.some((n) => !n.target.join(' ').includes('ag-')));
  return { ours, studio: bad.filter((v) => !ours.includes(v)) };
}

test('demo path: landing → War Room → Case File → approve → Arena', async ({ page }) => {
  const errors = watchConsole(page);

  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Win the PayPal disputes you should win.' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'What’s simulated' })).toBeVisible();
  const landingA11y = await a11y(page);
  await page.getByRole('link', { name: 'Open the demo' }).first().click();

  await expect(page).toHaveURL(/\/war-room$/);
  await expect(page.getByRole('heading', { name: 'War Room' })).toBeVisible();
  await expect(page.getByText('REPLAY · recorded sandbox disputes')).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Needs your decision' })).toBeVisible();
  await expect(page.getByRole('link', { name: 'PP-R-SLD-10197881' }).first()).toBeVisible(); // Insights grid (AG Studio)
  const warRoomA11y = await a11y(page);

  // The inbox row for the $47.40 dispute, which has a recorded recommendation awaiting approval.
  await page.getByRole('listitem').filter({ hasText: 'Not received · $47.40' }).getByRole('link', { name: 'Review' }).click();
  await expect(page).toHaveURL(/\/disputes\/PP-R-SLD-10197881/);
  await expect(page.getByRole('heading', { name: /Not received · \$47\.40/ })).toBeVisible();
  await expect(page.getByText('Refund in full', { exact: false }).first()).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Your evidence' })).toBeVisible();
  await expect(page.getByRole('list', { name: 'Dispute progress' })).toBeVisible();
  const caseA11y = await a11y(page);

  await page.getByRole('button', { name: /^Approve: refund in full/ }).click();
  await expect(page.getByText('Approved', { exact: true })).toBeVisible();
  await expect(page.getByText('Refund sent to PayPal', { exact: false })).toBeVisible(); // toast
  await expect(page.getByText('Lost / refunded').first()).toBeVisible(); // status changed to resolved
  await expect(page.getByText(/owner \(web\) approved/)).toBeVisible(); // on the timeline

  await page.getByRole('link', { name: 'Playbook' }).first().click();
  await expect(page.getByRole('heading', { name: 'Playbook' })).toBeVisible();
  const playbookA11y = await a11y(page);

  await page.getByRole('link', { name: 'Arena' }).first().click();
  await expect(page.getByRole('heading', { name: 'Arena', exact: true })).toBeVisible();
  await expect(page.getByRole('note').filter({ hasText: 'not real-world results' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Weak spots' })).toBeVisible();
  await expect(page.getByText('Right call').first()).toBeVisible();
  const arenaA11y = await a11y(page);

  for (const [name, r] of Object.entries({ landing: landingA11y, warRoom: warRoomA11y, caseFile: caseA11y, playbook: playbookA11y, arena: arenaA11y })) {
    console.log(`[a11y] ${name}: ours ${r.ours.map((v) => v.id).join(', ') || 'none'}; AG Studio ${r.studio.map((v) => v.id).join(', ') || 'none'}`);
    for (const v of r.ours) for (const n of v.nodes.slice(0, 12)) console.log(`   ${v.id}: ${n.target.join(' ')} :: ${(n.failureSummary ?? '').split('\n').slice(1, 2).join(' ').slice(0, 160)}`);
  }
  for (const [name, r] of Object.entries({ landing: landingA11y, warRoom: warRoomA11y, caseFile: caseA11y, playbook: playbookA11y, arena: arenaA11y })) {
    expect(r.ours.map((v) => v.id), `${name}: serious/critical accessibility issues`).toEqual([]);
  }
  expect(errors, 'console errors on the demo path').toEqual([]);
});
