// End-to-end tests against the built single-file app (dist/index.html) in Chromium.
// Run: npm run test:e2e   (uses Playwright's Chromium; set CHROME_PATH to use a system Chrome instead)
import { chromium } from 'playwright';
import { pathToFileURL } from 'node:url';
import path from 'node:path';
import fs from 'node:fs';

const ROOT = path.resolve(import.meta.dirname, '..');
const URL = pathToFileURL(path.join(ROOT, 'dist/index.html')).href;
const SHOTS = path.join(ROOT, 'test-results/screens');
fs.mkdirSync(SHOTS, { recursive: true });
const results = []; const pageErrors = [];
let browser;

async function check(name, fn) {
  const t0 = Date.now();
  try { await fn(); results.push({ name, ok: true, ms: Date.now() - t0 }); console.log(`  PASS  ${name}`); }
  catch (e) { results.push({ name, ok: false, err: String(e.message || e).split('\n')[0] }); console.log(`  FAIL  ${name}\n        ${String(e.message || e).split('\n')[0]}`); }
}
const expect = (cond, msg) => { if (!cond) throw new Error(msg); };
async function visible(locator, msg, timeout = 5000) { await locator.first().waitFor({ state: 'visible', timeout }).catch(() => { throw new Error(msg); }); }

async function freshPage(viewport = { width: 1400, height: 1000 }) {
  const ctx = await browser.newContext({ viewport });
  const pg = await ctx.newPage();
  pg.on('pageerror', e => pageErrors.push(String(e)));
  await pg.goto(URL); await pg.evaluate(() => localStorage.clear()); await pg.goto(URL);
  return pg;
}
const signOutIfNeeded = async pg => { const b = pg.getByRole('button', { name: 'Sign out' }); if (await b.count()) await b.click(); };
async function loginAs(pg, name) { await signOutIfNeeded(pg); await pg.getByRole('button', { name: new RegExp('^' + name) }).first().click(); }
async function switchTo(pg, name) {
  const sel = pg.getByLabel('Switch demo account');
  const val = await sel.evaluate((s, n) => [...s.options].find(o => o.text.startsWith(n)).value, name);
  await sel.selectOption(val);
}
const go = (pg, hash) => pg.evaluate(h => { location.hash = h; }, hash);
const toastOk = pg => pg.getByTestId('toast-ok').last();
const toastErr = pg => pg.getByTestId('toast-error').last();

async function main() {
  browser = await chromium.launch({ executablePath: process.env.CHROME_PATH || undefined, args: ['--no-sandbox'] });

  console.log('\nScreen audit — every route, every role');
  const routes = {
    'Aarav Sharma': ['student-home', 'student-book', 'student-interviews', 'student-badges', 'notifications', 'showcase'],
    'Meera Iyer': ['interviewer-schedule', 'interviewer-availability', 'interviewer-history', 'notifications'],
    'Priya Menon': ['admin-overview', 'admin-students', 'admin-bookings', 'admin-interviewers', 'admin-malpractice', 'admin-audit', 'admin-settings'],
  };
  {
    const pg = await freshPage();
    for (const [who, list] of Object.entries(routes)) {
      await loginAs(pg, who);
      for (const r of list) {
        await check(`${who.split(' ')[0]} · ${r} renders`, async () => {
          await go(pg, r); await pg.waitForTimeout(150);
          await visible(pg.locator('main h1'), 'no page heading');
          expect(await pg.getByText('Page not found').count() === 0, 'page not found');
          expect(await pg.getByText("You don't have access").count() === 0, 'unexpected access denied');
          await pg.screenshot({ path: path.join(SHOTS, `${r}-${who.split(' ')[0].toLowerCase()}.png`), fullPage: true });
        });
      }
      await check(`${who.split(' ')[0]} · every sidebar link navigates`, async () => {
        const links = pg.locator('nav[aria-label=Main] button');
        const n = await links.count();
        for (let i = 0; i < n; i++) { await links.nth(i).click(); await visible(pg.locator('main h1'), `link ${i} shows no page`); }
      });
    }
  }

  console.log('\nStudent workflow');
  const pg = await freshPage();
  await check('J1 Rohan: contest result → eligible (exact message 1) → book → confirmation (exact message 2)', async () => {
    await loginAs(pg, 'Rohan Das');
    expect(await pg.getByTestId('journey-card').getAttribute('data-state') === 'NOT_ELIGIBLE', 'not NOT_ELIGIBLE at start');
    await pg.getByTestId('simulate-clear').click();
    await visible(pg.getByText("You're eligible for your Track Badge interview!"), 'eligibility message missing');
    await pg.getByRole('button', { name: 'Book Your Interview' }).first().click();
    await pg.getByTestId('slot').first().click(); await pg.getByTestId('confirm-booking').click();
    const conf = pg.getByTestId('booking-confirmation');
    await visible(conf.getByText('Your interview is confirmed!'), 'confirmation title missing');
    expect((await conf.innerText()).includes('Mode: Online'), 'Mode line missing');
  });
  await check('Student can cancel outside the cutoff; slot returns to the pool', async () => {
    await switchTo(pg, 'Kavya Pillai');
    await pg.getByRole('button', { name: 'Cancel', exact: true }).click();
    await pg.getByRole('button', { name: 'Cancel interview' }).click();
    await visible(toastOk(pg).getByText('Interview cancelled'), 'no cancel confirmation');
    expect(await pg.getByTestId('journey-card').getAttribute('data-state') === 'ELIGIBLE', 'not back to ELIGIBLE');
  });
  await check('Student reschedules; the attempt is kept', async () => {
    await pg.getByRole('button', { name: 'Book Your Interview' }).first().click();
    await pg.getByTestId('slot').nth(1).click(); await pg.getByTestId('confirm-booking').click();
    await pg.getByRole('button', { name: 'Back to home' }).click();
    await pg.getByRole('button', { name: 'Reschedule' }).click();
    await pg.getByTestId('slot').nth(2).click(); await pg.getByTestId('confirm-booking').click();
    await visible(pg.getByTestId('booking-confirmation'), 'reschedule did not confirm');
  });
  await check('Booked student inside 12 h cutoff sees changes locked with a clear explanation', async () => {
    await switchTo(pg, 'Riya Patel');
    expect(await pg.getByRole('button', { name: 'Reschedule' }).isDisabled(), 'reschedule not disabled');
    await visible(pg.getByText(/Changes closed 12h before the interview/), 'no explanation');
  });
  await check('Notification CTA navigates to the right screen', async () => {
    await go(pg, 'notifications');
    await pg.getByRole('button', { name: 'View Interview Details' }).first().click();
    await visible(pg.locator('main h1', { hasText: 'My interviews' }), 'CTA did not open My interviews');
  });

  console.log('\nInterviewer workflow');
  await check('J2 Meera: start → validation → Pass → student sees badge (exact message 3)', async () => {
    await switchTo(pg, 'Meera Iyer');
    await pg.getByTestId('schedule-row').filter({ hasText: 'Kabir Singh' }).getByRole('button', { name: 'Open' }).click();
    await pg.getByTestId('start-interview').click();
    for (const k of ['technical', 'communication', 'problemSolving']) await pg.getByTestId(`score-${k}-4`).click();
    await pg.getByTestId('submit-outcome').click();
    await visible(pg.getByText('Choose a final recommendation.'), 'validation message missing');
    await pg.getByTestId('outcome-PASS').click(); await pg.getByTestId('feedback').fill('Strong, structured answers.');
    await pg.getByTestId('submit-outcome').click(); await pg.getByTestId('confirm-outcome').click();
    await visible(toastOk(pg).getByText('Result recorded'), 'no success toast');
    await switchTo(pg, 'Kabir Singh');
    await visible(pg.getByText("Congratulations! You've passed your interview!"), 'pass message missing');
  });
  await check('J3 Retake later → student sees feedback + cooldown; a retake-eligible student books attempt 2, attempt 1 kept', async () => {
    await switchTo(pg, 'Meera Iyer');
    await pg.getByTestId('schedule-row').filter({ hasText: 'Riya Patel' }).getByRole('button', { name: 'Open' }).click();
    await pg.getByTestId('start-interview').click();
    for (const k of ['technical', 'communication', 'problemSolving']) await pg.getByTestId(`score-${k}-3`).click();
    await pg.getByTestId('outcome-RETAKE_LATER').click(); await pg.getByTestId('feedback').fill('Close — revisit evaluation metrics and try again.');
    await pg.getByTestId('submit-outcome').click(); await pg.getByTestId('confirm-outcome').click();
    await switchTo(pg, 'Riya Patel');
    expect(await pg.getByTestId('journey-card').getAttribute('data-state') === 'RETAKE_COOLDOWN', 'not RETAKE_COOLDOWN');
    await switchTo(pg, 'Ishita Rao');
    await pg.getByRole('button', { name: 'Pick a slot' }).click();
    await pg.getByTestId('slot').first().click(); await pg.getByTestId('confirm-booking').click();
    await pg.getByRole('button', { name: 'View Interview Details' }).click();
    expect(await pg.getByTestId('attempt-card').count() === 2, 'expected 2 attempts');
    expect((await pg.getByTestId('attempt-card').nth(1).innerText()).includes('Retake later'), 'attempt 1 changed');
  });
  await check('Interviewer adds availability; overlap is rejected with a readable error', async () => {
    await switchTo(pg, 'Meera Iyer'); await go(pg, 'interviewer-availability');
    const d = await pg.evaluate(() => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata' }).format(new Date(Date.now() + 86400000 * 4)));
    await pg.getByTestId('avail-date').fill(d); await pg.getByTestId('avail-start').fill('06:00'); await pg.getByTestId('avail-end').fill('07:30');
    await pg.getByRole('button', { name: 'Add', exact: true }).click();
    await visible(toastOk(pg).getByText(/Added/), 'add failed');
    await pg.getByTestId('avail-start').fill('06:30'); await pg.getByTestId('avail-end').fill('08:00');
    await pg.getByRole('button', { name: 'Add', exact: true }).click();
    await visible(toastErr(pg).getByText(/overlaps your existing availability/), 'overlap not explained');
  });
  await check('"I can\'t make it" reassigns the interview to a free colleague', async () => {
    const pg = await freshPage(); await loginAs(pg, 'Arjun Nair');   // fresh data: Kavya is booked with Arjun tomorrow
    const nextDay = pg.getByRole('button', { name: 'Next day' });
    for (let i = 0; i < 3 && !(await pg.getByTestId('schedule-row').count()); i++) await nextDay.click();
    const row = pg.getByTestId('schedule-row').first(); await visible(row, 'no upcoming interview for Arjun');
    await row.getByRole('button', { name: 'Open' }).click();
    await pg.getByRole('button', { name: "I can't make it" }).click();
    await pg.getByRole('button', { name: 'Release interview' }).click();
    await visible(toastOk(pg).getByText(/Reassigned to|priority rebooking/), 'no reassignment message');
  });

  console.log('\nAdmin workflow');
  await check('Ops: overview KPIs and "eligible, not booked" list reflect state; nudge works; duplicate nudge explained', async () => {
    await switchTo(pg, 'Priya Menon');
    await visible(pg.getByText('Eligible but not booked'), 'list missing');
    await go(pg, 'admin-students');
    await pg.getByRole('button', { name: /Eligible, not booked/ }).click();
    const row = pg.getByTestId('student-row').filter({ hasText: 'Tara Menon' });
    await row.getByRole('button', { name: 'Nudge' }).click();
    await visible(toastOk(pg).getByText('Reminder sent to Tara Menon'), 'nudge failed');
    await row.getByRole('button', { name: 'Nudge' }).click();
    await visible(toastErr(pg).getByText(/already nudged/), 'duplicate nudge not explained');
  });
  await check('Ops: bookings — move and cancel with override', async () => {
    await go(pg, 'admin-bookings');
    await pg.getByRole('button', { name: 'Move' }).first().click();
    await pg.locator('[role=dialog] button.rounded-lg').nth(1).click();
    await visible(toastOk(pg).getByText('Booking moved'), 'move failed');
    await pg.getByRole('button', { name: 'Cancel', exact: true }).first().click();
    await pg.locator('[role=dialog] input').fill('Ops test');
    await pg.getByRole('button', { name: 'Cancel booking' }).click();
    await visible(toastOk(pg).getByText('Booking cancelled'), 'cancel failed');
  });
  await check('Ops: policy change saves and is audited', async () => {
    await go(pg, 'admin-settings');
    await pg.getByLabel('Max reschedules per booking').fill('3');
    await pg.getByRole('button', { name: 'Save policies' }).click();
    await visible(toastOk(pg).getByText('Policies saved'), 'save failed');
    await go(pg, 'admin-audit'); await pg.getByLabel('Search audit log').fill('settings.updated');
    expect(await pg.locator('tbody tr').count() >= 1, 'no audit row');
  });
  await check('Ops without reviewer rights: view-only malpractice, cannot decide', async () => {
    await switchTo(pg, 'Karan Shah'); await go(pg, 'admin-malpractice');
    await visible(pg.getByText('View-only'), 'no view-only notice');
    await pg.getByTestId('case-row').filter({ hasText: 'Investigating' }).first().click();
    expect(await pg.getByTestId('record-decision').isDisabled(), 'decision not disabled');
  });

  console.log('\nMalpractice workflow');
  await check('J4 flag → investigate → dismiss → badge reinstated (student sees it)', async () => {
    await switchTo(pg, 'Priya Menon'); await go(pg, 'admin-malpractice');
    await pg.getByRole('button', { name: 'Flag a badge' }).click();
    const sel = pg.getByLabel('Badge', { exact: true });
    const val = await sel.evaluate(s => [...s.options].find(o => o.text.startsWith('Ananya')).value); await sel.selectOption(val);
    await pg.getByTestId('flag-desc').fill('Similarity alert on interview answers.'); await pg.getByTestId('raise-flag').click();
    await pg.getByTestId('start-investigation').click();
    await pg.getByTestId('decide-dismiss').click(); await pg.getByTestId('decision-reason').fill('Matched content is from public docs.');
    await pg.getByTestId('record-decision').click();
    await visible(toastOk(pg).getByText('Case dismissed'), 'dismiss failed');
    await switchTo(pg, 'Ananya Reddy'); await go(pg, 'student-badges');
    await visible(pg.getByText('Review closed — reinstated'), 'reinstatement not shown');
  });
  await check('J5 confirm → nullified → student dashboard + audit', async () => {
    await switchTo(pg, 'Priya Menon'); await go(pg, 'admin-malpractice');
    await pg.getByTestId('case-row').filter({ hasText: 'Saanvi' }).filter({ hasText: 'Investigating' }).first().click();
    await pg.getByTestId('decide-confirm').click(); await pg.getByTestId('decision-reason').fill('Recording confirms off-screen help.');
    await pg.getByTestId('record-decision').click();
    await go(pg, 'admin-audit'); await pg.getByLabel('Search audit log').fill('badge.nullified');
    expect(await pg.locator('tbody tr').count() === 2, 'expected 2 badge.nullified audit rows (seeded Aditya + this decision)');
    await switchTo(pg, 'Saanvi Kulkarni');
    expect(await pg.getByTestId('journey-card').getAttribute('data-state') === 'BADGE_NULLIFIED', 'not nullified');
    await visible(pg.getByText('Your badge has been nullified'), 'nullified message missing');
  });

  console.log('\nConcurrency + authorisation in the UI');
  await check('J6 two tabs book the same slot → exactly one succeeds, the other gets a clear error', async () => {
    const pa = await freshPage(); await loginAs(pa, 'Aarav Sharma');
    await pa.getByRole('button', { name: 'Book Your Interview' }).first().click();
    const pb = await pa.context().newPage(); await pb.goto(URL); await switchTo(pb, 'Tara Menon');
    await pb.getByRole('button', { name: 'Book Your Interview' }).first().click();
    await pa.getByTestId('slot').first().click(); await pb.getByTestId('slot').first().click();
    expect(await pa.getByTestId('slot').first().innerText() === await pb.getByTestId('slot').first().innerText(), 'different slots');
    await pa.getByTestId('confirm-booking').click(); await visible(pa.getByTestId('booking-confirmation'), 'A did not book');
    await pb.getByTestId('confirm-booking').click();
    await visible(toastErr(pb).getByText(/someone just booked/), 'B got no clear error');
    await check('J7 student cannot open ops pages', async () => {
      await go(pa, 'admin-students'); await visible(pa.getByText("You don't have access to this page"), 'not blocked');
    });
  });

  console.log('\nBefore / after + messages');
  await check('All 10 before/after scenarios build from real logic', async () => {
    const p2 = await freshPage(); await loginAs(p2, 'Aarav Sharma'); await go(p2, 'showcase');
    for (const s of ['home-booking', 'home-pass', 'home-retake', 'home-fail', 'home-malpractice', 'badges', 'history', 'schedule', 'admin', 'case']) {
      await p2.getByTestId(`scenario-${s}`).click(); await p2.waitForTimeout(150);
      expect(await p2.getByText('Could not build this state').count() === 0, `${s} failed to build`);
      await p2.screenshot({ path: path.join(SHOTS, `showcase-${s}.png`), fullPage: true });
    }
    await p2.getByRole('button', { name: 'The 3 student messages' }).click();
    const txt = await p2.locator('main').innerText();
    for (const t of ["You're eligible for your Track Badge interview!", 'Your interview is confirmed!', "Congratulations! You've passed your interview!"]) expect(txt.includes(t), `missing: ${t}`);
    await p2.screenshot({ path: path.join(SHOTS, 'showcase-messages.png'), fullPage: true });
  });

  console.log('\nMobile (390 × 844)');
  for (const [who, routesM] of [['Aarav Sharma', ['student-home', 'student-book', 'student-interviews']], ['Meera Iyer', ['interviewer-schedule', 'interviewer-availability']], ['Priya Menon', ['admin-overview', 'admin-students', 'admin-malpractice']]]) {
    await check(`${who.split(' ')[0]} on mobile: no horizontal overflow`, async () => {
      const m = await freshPage({ width: 390, height: 844 }); await loginAs(m, who);
      for (const r of routesM) {
        await go(m, r); await m.waitForTimeout(150);
        const over = await m.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
        expect(over <= 1, `${r} overflows by ${over}px`);
        await m.screenshot({ path: path.join(SHOTS, `mobile-${r}.png`), fullPage: true });
      }
    });
  }

  await check('No uncaught page errors during the whole run', async () => { expect(pageErrors.length === 0, pageErrors.join(' | ')); });
  await browser.close();
  const failed = results.filter(r => !r.ok);
  fs.writeFileSync(path.join(ROOT, 'test-results/e2e.json'), JSON.stringify({ when: new Date().toISOString(), passed: results.length - failed.length, failed: failed.length, results }, null, 2));
  console.log(`\n${results.length - failed.length} passed, ${failed.length} failed`);
  process.exit(failed.length ? 1 : 0);
}
main().catch(e => { console.error(e); process.exit(1); });
