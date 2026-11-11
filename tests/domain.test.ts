import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { createSeed } from '../src/domain/seed';
import { Store } from '../src/domain/store';
import * as S from '../src/domain/services';
import { deriveJourney, evaluateEligibility } from '../src/domain/eligibility';
import { canTransition } from '../src/domain/stateMachine';
import { DomainError, clock, DAY, HOUR } from '../src/domain/core';
import type { DB } from '../src/domain/types';

const code = (fn: () => unknown) => { try { fn(); } catch (e) { if (e instanceof DomainError) return e.code; throw e; } return 'OK'; };
const fresh = () => new Store(createSeed());
const sid = (db: DB, name: string) => db.students.find(s => db.users.find(u => u.id === s.userId)!.fullName.startsWith(name))!.id;
const uid = (db: DB, name: string) => db.users.find(u => u.fullName.startsWith(name))!.id;
const openSlot = (db: DB, minHours = 24) => S.bookableSlots(db, sid(db, 'Aarav')).find(s => new Date(s.startAt).getTime() > Date.now() + minHours * HOUR)!;
const AARAV = 'u_st_01';

describe('state machine', () => {
  test('rejects invalid transitions', () => {
    assert.equal(canTransition('badge', 'EARNED', 'NULLIFIED'), false, 'cannot nullify without review');
    assert.equal(canTransition('badge', 'UNDER_REVIEW', 'NULLIFIED'), true);
    assert.equal(canTransition('outcome', 'PASS', 'FAIL'), false);
    assert.equal(canTransition('booking', 'CANCELLED', 'BOOKED'), false);
    assert.equal(canTransition('malpractice', 'FLAGGED', 'CONFIRMED'), false, 'must investigate first');
  });
  test('every status change writes an audit record', () => {
    const st = fresh(); const before = st.snapshot.auditLogs.length;
    st.run(db => S.bookSlot(db, AARAV, { studentId: sid(db, 'Aarav'), badgeDefId: 'bd_prod_nov', slotId: openSlot(db).id }));
    assert.ok(st.snapshot.auditLogs.length >= before + 2);
  });
});

describe('eligibility', () => {
  test('computed from cleared skills, not a flag', () => {
    const st = fresh(); const db = st.snapshot; const rohan = sid(db, 'Rohan');
    assert.equal(evaluateEligibility(db, rohan, 'bd_mod_nov').eligible, false);
    st.run(d => S.recordSkillCleared(d, S.SYSTEM_ACTOR, rohan, 'sk_mod2'));
    assert.equal(evaluateEligibility(st.snapshot, rohan, 'bd_mod_nov').eligible, true);
    assert.equal(st.snapshot.notifications.at(-1)!.title, "You're eligible for your Track Badge interview!");
  });
  test('master level requires the novice badge', () => {
    const db = createSeed();
    assert.equal(evaluateEligibility(db, sid(db, 'Aarav'), 'bd_prod_mas').missingPrereqBadge, 'AI Product Mastery — Novice');
  });
  test('not-eligible student cannot book', () => {
    const st = fresh();
    assert.equal(code(() => st.run(db => S.bookSlot(db, uid(db, 'Rohan'), { studentId: sid(db, 'Rohan'), badgeDefId: 'bd_mod_nov', slotId: openSlot(db).id }))), 'NOT_ELIGIBLE');
  });
  test('requirement change: booked students are grandfathered', () => {
    const st = fresh();
    st.run(db => S.setSkillRequired(db, 'u_admin1', 'bd_prod_nov', 'sk_prod3', true));
    const db = st.snapshot;
    assert.equal(deriveJourney(db, sid(db, 'Kabir'), 'bd_prod_nov').state, 'BOOKED');
    assert.equal(deriveJourney(db, sid(db, 'Aarav'), 'bd_prod_nov').state, 'NOT_ELIGIBLE');
  });
});

describe('authorisation parity with SQL', () => {
  test('students cannot clear their own skills; the contest system and ops can', () => {
    const st = fresh();
    assert.equal(code(() => st.run(d => S.recordSkillCleared(d, uid(d, 'Rohan'), sid(d, 'Rohan'), 'sk_mod2'))), 'FORBIDDEN');
    st.run(d => S.recordSkillCleared(d, S.SYSTEM_ACTOR, sid(d, 'Rohan'), 'sk_mod2'));
    assert.equal(evaluateEligibility(st.snapshot, sid(st.snapshot, 'Rohan'), 'bd_mod_nov').eligible, true);
  });
  test('interviewers can flag only students they interviewed', () => {
    const st = fresh(); const db = st.snapshot;
    const ananyaBadge = db.studentBadges.find(b => b.studentId === sid(db, 'Ananya'))!.id;   // interviewed by Meera
    assert.equal(code(() => st.run(d => S.flagMalpractice(d, 'u_iv_rahul', ananyaBadge, 'Suspicious similarity in interview answers.', 'x'))), 'FORBIDDEN');
    st.run(d => S.flagMalpractice(d, 'u_iv_meera', ananyaBadge, 'Suspicious similarity in interview answers.', 'x'));
  });
  test('slots beyond the booking horizon are rejected', () => {
    const st = fresh(); st.run(d => S.updatePolicies(d, 'u_admin1', { bookingHorizonDays: 1 }));
    const far = st.snapshot.slots.find(s => s.status === 'OPEN' && new Date(s.startAt).getTime() > Date.now() + 3 * DAY)!;
    assert.equal(code(() => st.run(d => S.bookSlot(d, AARAV, { studentId: 'st_01', badgeDefId: 'bd_prod_nov', slotId: far.id }))), 'VALIDATION');
  });
  test('a decided case cannot be decided again', () => {
    const st = fresh(); const c = st.snapshot.malpracticeCases.find(x => x.status === 'CONFIRMED')!;
    assert.equal(code(() => st.run(d => S.decideCase(d, 'u_admin1', c.id, 'DISMISSED', 'Re-opening this decided case now'))), 'INVALID_TRANSITION');
  });
});

describe('booking', () => {
  test('books a slot and sends the exact confirmation message', () => {
    const st = fresh();
    st.run(db => S.bookSlot(db, AARAV, { studentId: sid(db, 'Aarav'), badgeDefId: 'bd_prod_nov', slotId: openSlot(db).id }));
    const db = st.snapshot;
    assert.equal(deriveJourney(db, sid(db, 'Aarav'), 'bd_prod_nov').state, 'BOOKED');
    const n = db.notifications.at(-1)!;
    assert.equal(n.title, 'Your interview is confirmed!');
    assert.match(n.body, /Mode: Online/);
  });
  test('RACE: two students submit the same slot concurrently → exactly one booking', () => {
    const st = fresh(); const slotId = openSlot(st.snapshot).id;
    const a = st.begin(); const b = st.begin();          // both read the same version
    S.bookSlot(a.draft, AARAV, { studentId: 'st_01', badgeDefId: 'bd_prod_nov', slotId });
    S.bookSlot(b.draft, 'u_st_14', { studentId: 'st_14', badgeDefId: 'bd_prod_nov', slotId });
    a.commit();
    assert.equal(code(() => b.commit()), 'CONFLICT');      // stale write rejected
    // the retry re-runs business checks on fresh data and gets a clean error
    assert.equal(code(() => st.run(db => S.bookSlot(db, 'u_st_14', { studentId: 'st_14', badgeDefId: 'bd_prod_nov', slotId }))), 'SLOT_TAKEN');
    assert.equal(st.snapshot.bookings.filter(x => x.slotId === slotId && x.status === 'BOOKED').length, 1);
  });
  test('duplicate request with same idempotency key returns the original booking', () => {
    const st = fresh(); const slotId = openSlot(st.snapshot).id;
    const b1 = st.run(db => S.bookSlot(db, AARAV, { studentId: 'st_01', badgeDefId: 'bd_prod_nov', slotId, idempotencyKey: 'k1' }));
    const b2 = st.run(db => S.bookSlot(db, AARAV, { studentId: 'st_01', badgeDefId: 'bd_prod_nov', slotId, idempotencyKey: 'k1' }));
    assert.equal(b1.id, b2.id);
    assert.equal(st.snapshot.bookings.filter(b => b.studentId === 'st_01').length, 1);
  });
  test('cannot hold two active bookings for the same badge', () => {
    const st = fresh(); const slots = S.bookableSlots(st.snapshot, 'st_01');
    st.run(db => S.bookSlot(db, AARAV, { studentId: 'st_01', badgeDefId: 'bd_prod_nov', slotId: slots[5].id }));
    assert.equal(code(() => st.run(db => S.bookSlot(db, AARAV, { studentId: 'st_01', badgeDefId: 'bd_prod_nov', slotId: slots[10].id }))), 'ALREADY_BOOKED');
  });
  test('past and too-soon slots are rejected', () => {
    const st = fresh(); const db = st.snapshot;
    const past = db.slots.find(s => new Date(s.startAt) < new Date())!;
    assert.equal(code(() => st.run(d => S.bookSlot(d, AARAV, { studentId: 'st_01', badgeDefId: 'bd_prod_nov', slotId: past.id }))), 'SLOT_IN_PAST');
    const soon = db.slots.find(s => s.status === 'OPEN' && new Date(s.startAt) > new Date() && new Date(s.startAt).getTime() < Date.now() + 2 * HOUR);
    if (soon) assert.equal(code(() => st.run(d => S.bookSlot(d, AARAV, { studentId: 'st_01', badgeDefId: 'bd_prod_nov', slotId: soon.id }))), 'CUTOFF_PASSED');
  });
  test('a student cannot book for someone else', () => {
    const st = fresh();
    assert.equal(code(() => st.run(db => S.bookSlot(db, AARAV, { studentId: 'st_14', badgeDefId: 'bd_prod_nov', slotId: openSlot(db).id }))), 'FORBIDDEN');
  });
  test('cancel inside the cutoff is refused for students, allowed for ops', () => {
    const st = fresh(); const db = st.snapshot;
    const riya = db.bookings.find(b => b.studentId === sid(db, 'Riya') && b.status === 'BOOKED')!;
    assert.equal(code(() => st.run(d => S.cancelBooking(d, uid(d, 'Riya'), riya.id, 'clash'))), 'CUTOFF_PASSED');
    st.run(d => S.cancelBooking(d, 'u_admin1', riya.id, 'Ops override'));
    assert.equal(st.snapshot.slots.find(s => s.id === riya.slotId)!.status, 'OPEN');
  });
  test('reschedule keeps the same attempt and releases the old slot', () => {
    const st = fresh(); const db = st.snapshot;
    const kavya = db.bookings.find(b => b.studentId === sid(db, 'Kavya') && b.status === 'BOOKED')!;
    const attemptId = db.attempts.find(a => a.bookingId === kavya.id)!.id;
    const target = S.bookableSlots(db, sid(db, 'Kavya')).find(s => new Date(s.startAt).getTime() > Date.now() + 2 * DAY)!;
    const nb = st.run(d => S.rescheduleBooking(d, uid(d, 'Kavya'), kavya.id, target.id));
    const after = st.snapshot;
    assert.equal(after.attempts.find(a => a.id === attemptId)!.bookingId, nb.id);
    assert.equal(after.slots.find(s => s.id === kavya.slotId)!.status, 'OPEN');
    assert.equal(after.bookings.find(b => b.id === kavya.id)!.status, 'RESCHEDULED');
  });
});

describe('availability', () => {
  test('overlapping availability is rejected', () => {
    const st = fresh(); const db = st.snapshot;
    const w = db.windows.find(x => x.interviewerId === 'iv_arjun' && new Date(x.startAt) > new Date(Date.now() + 2 * DAY))!;
    const date = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata' }).format(new Date(w.startAt));
    assert.equal(code(() => st.run(d => S.addAvailability(d, 'u_iv_arjun', { interviewerId: 'iv_arjun', date, start: '18:30', end: '20:00' }))), 'OVERLAP');
  });
  test('removing a window with bookings is blocked (never silently invalidated)', () => {
    const st = fresh(); const db = st.snapshot;
    const kavya = db.bookings.find(b => b.studentId === sid(db, 'Kavya') && b.status === 'BOOKED')!;
    const winId = db.slots.find(s => s.id === kavya.slotId)!.windowId;
    assert.equal(code(() => st.run(d => S.removeAvailability(d, 'u_iv_arjun', winId))), 'HAS_BOOKINGS');
  });
  test('interviewer unavailable → reassigned to a free colleague at the same time', () => {
    const st = fresh(); const db = st.snapshot;
    const kavya = db.bookings.find(b => b.studentId === sid(db, 'Kavya') && b.status === 'BOOKED')!;
    const att = db.attempts.find(a => a.bookingId === kavya.id)!;
    const r = st.run(d => S.interviewerUnavailable(d, 'u_iv_arjun', att.id, 'sick'));
    assert.equal(r.reassignedTo, 'iv_rahul');
    assert.equal(deriveJourney(st.snapshot, sid(db, 'Kavya'), 'bd_prod_nov').state, 'BOOKED');
  });
  test('interviewer unavailable with no cover → priority rebook, not counted as an attempt', () => {
    const db = createSeed(); const j = deriveJourney(db, sid(db, 'Myra'), 'bd_mod_nov');
    assert.equal(j.state, 'PRIORITY_REBOOK'); assert.equal(j.attemptsUsed, 0); assert.equal(j.canBook, true);
  });
});

describe('interviews and outcomes', () => {
  const riyaAttempt = (db: DB) => db.attempts.find(a => a.studentId === sid(db, 'Riya') && a.interviewStatus === 'SCHEDULED')!;
  const scores = { technical: 4, communication: 4, problemSolving: 4 };
  test('outcome requires a started interview; pass awards the badge and the exact pass message', () => {
    const st = fresh(); const id = riyaAttempt(st.snapshot).id;
    assert.equal(code(() => st.run(d => S.submitOutcome(d, 'u_iv_meera', id, { outcome: 'PASS', scores, feedback: '' }))), 'INVALID_TRANSITION');
    st.run(d => S.startInterview(d, 'u_iv_meera', id));
    st.run(d => S.submitOutcome(d, 'u_iv_meera', id, { outcome: 'PASS', scores, feedback: 'Great' }));
    const db = st.snapshot;
    assert.equal(deriveJourney(db, sid(db, 'Riya'), 'bd_prod_nov').state, 'PASSED');
    assert.equal(db.notifications.at(-1)!.title, "Congratulations! You've passed your interview!");
  });
  test('double submission is rejected', () => {
    const st = fresh(); const id = riyaAttempt(st.snapshot).id;
    st.run(d => S.startInterview(d, 'u_iv_meera', id));
    st.run(d => S.submitOutcome(d, 'u_iv_meera', id, { outcome: 'FAIL', scores, feedback: 'Needs more practice on prompt evaluation methods.' }));
    assert.equal(code(() => st.run(d => S.submitOutcome(d, 'u_iv_meera', id, { outcome: 'PASS', scores, feedback: 'x' }))), 'DUPLICATE');
  });
  test('only the assigned interviewer can record the result', () => {
    const st = fresh(); const id = riyaAttempt(st.snapshot).id;
    assert.equal(code(() => st.run(d => S.startInterview(d, 'u_iv_rahul', id))), 'FORBIDDEN');
    assert.equal(code(() => st.run(d => S.startInterview(d, AARAV, id))), 'FORBIDDEN');
  });
  test('retake: new attempt is created, the previous attempt is preserved', () => {
    const st = fresh(); const db0 = st.snapshot; const ishita = sid(db0, 'Ishita');
    const prev = db0.attempts.find(a => a.studentId === ishita)!;
    const slot = S.bookableSlots(db0, ishita)[3];
    st.run(d => S.bookSlot(d, uid(d, 'Ishita'), { studentId: ishita, badgeDefId: 'bd_sys_nov', slotId: slot.id }));
    const db = st.snapshot; const atts = db.attempts.filter(a => a.studentId === ishita);
    assert.equal(atts.length, 2);
    assert.deepEqual(atts.find(a => a.id === prev.id), prev);
    assert.equal(atts.find(a => a.id !== prev.id)!.attemptNumber, 2);
    assert.equal(deriveJourney(db, ishita, 'bd_sys_nov').retake, 'RETAKE_BOOKED');
  });
  test('retake cooldown blocks early booking', () => {
    const st = fresh(); const v = sid(st.snapshot, 'Vihaan');
    assert.equal(code(() => st.run(d => S.bookSlot(d, uid(d, 'Vihaan'), { studentId: v, badgeDefId: 'bd_sys_nov', slotId: S.bookableSlots(d, v)[0].id }))), 'COOLDOWN');
  });
  test('max attempts enforced', () => {
    const st = fresh(); const r = sid(st.snapshot, 'Reyansh');
    assert.equal(code(() => st.run(d => S.bookSlot(d, uid(d, 'Reyansh'), { studentId: r, badgeDefId: 'bd_sys_nov', slotId: S.bookableSlots(d, r)[0].id }))), 'LIMIT_REACHED');
  });
  test('amending a result: inside window with reason keeps history; reversing a Pass is blocked', () => {
    const st = fresh(); const id = riyaAttempt(st.snapshot).id;
    st.run(d => S.startInterview(d, 'u_iv_meera', id));
    st.run(d => S.submitOutcome(d, 'u_iv_meera', id, { outcome: 'RETAKE_LATER', scores, feedback: 'Close — revisit evaluation metrics before next attempt.' }));
    assert.equal(code(() => st.run(d => S.amendOutcome(d, 'u_iv_meera', id, { outcome: 'PASS', scores, feedback: 'ok', reason: 'x' }))), 'VALIDATION');
    st.run(d => S.amendOutcome(d, 'u_iv_meera', id, { outcome: 'PASS', scores, feedback: 'Re-reviewed recording', reason: 'Mis-clicked retake on submission' }));
    const att = st.snapshot.attempts.find(a => a.id === id)!;
    assert.equal(att.revisions.length, 2); assert.equal(att.revisions[0].outcome, 'RETAKE_LATER');
    assert.equal(code(() => st.run(d => S.amendOutcome(d, 'u_admin1', id, { outcome: 'FAIL', scores, feedback: 'Changing my mind about this result.', reason: 'Second opinion' }))), 'FORBIDDEN');
  });
  test('interviewer cannot amend after the edit window', () => {
    const st = fresh(); const db = st.snapshot;
    const old = db.attempts.find(a => a.studentId === sid(db, 'Diya'))!;
    assert.equal(code(() => st.run(d => S.amendOutcome(d, 'u_iv_sana', old.id, { outcome: 'RETAKE_LATER', scores, feedback: 'Reconsidered after discussion with panel.', reason: 'Panel review' }))), 'FORBIDDEN');
  });
  test('student no-show counts as an attempt and applies a cooldown', () => {
    const db = createSeed(); const j = deriveJourney(db, sid(db, 'Nikhil'), 'bd_mod_nov');
    assert.equal(j.state, 'NO_SHOW_COOLDOWN'); assert.equal(j.attemptsUsed, 1);
  });
  test('forgotten outcome shows as awaiting result and can still be submitted', () => {
    const st = fresh(); const z = sid(st.snapshot, 'Zara');
    assert.equal(deriveJourney(st.snapshot, z, 'bd_mod_nov').state, 'AWAITING_RESULT');
    const att = st.snapshot.attempts.find(a => a.studentId === z)!;
    st.run(d => S.submitOutcome(d, 'u_iv_sana', att.id, { outcome: 'PASS', scores, feedback: 'Good' }));
    assert.equal(deriveJourney(st.snapshot, z, 'bd_mod_nov').state, 'PASSED');
  });
});

describe('malpractice and badges', () => {
  const ananyaBadge = (db: DB) => db.studentBadges.find(b => b.studentId === sid(db, 'Ananya'))!.id;
  test('flag puts badge under review but never nullifies on its own', () => {
    const st = fresh();
    st.run(d => S.flagMalpractice(d, 'u_admin2', ananyaBadge(d), 'Suspicious similarity in interview answers.', 'ref'));
    assert.equal(st.snapshot.studentBadges.find(b => b.id === ananyaBadge(st.snapshot))!.status, 'UNDER_REVIEW');
  });
  test('dismissal reinstates; confirmation nullifies and keeps history', () => {
    const st = fresh();
    const c = st.run(d => S.flagMalpractice(d, 'u_admin2', ananyaBadge(d), 'Suspicious similarity in interview answers.', 'ref'));
    assert.equal(code(() => st.run(d => S.decideCase(d, 'u_admin1', c, 'CONFIRMED', 'Confirmed after looking at it'))), 'INVALID_TRANSITION');
    st.run(d => S.startInvestigation(d, 'u_admin1', c, ''));
    st.run(d => S.decideCase(d, 'u_admin1', c, 'CONFIRMED', 'Recording shows external assistance.'));
    const b = st.snapshot.studentBadges.find(x => x.id === ananyaBadge(st.snapshot))!;
    assert.equal(b.status, 'NULLIFIED'); assert.ok(b.earnedAt); assert.equal(b.history.length, 3);
    assert.equal(st.snapshot.notifications.at(-1)!.title, 'Your badge has been nullified');
  });
  test('nullification without reviewer permission is refused', () => {
    const st = fresh(); const db = st.snapshot;
    const c = db.malpracticeCases.find(x => x.status === 'UNDER_INVESTIGATION')!;
    assert.equal(code(() => st.run(d => S.decideCase(d, 'u_admin2', c.id, 'CONFIRMED', 'I think this is malpractice.'))), 'FORBIDDEN');
    assert.equal(code(() => st.run(d => S.decideCase(d, 'u_iv_sana', c.id, 'CONFIRMED', 'I think this is malpractice.'))), 'FORBIDDEN');
  });
  test('multiple flags: dismissing one keeps the badge under review while another is open', () => {
    const st = fresh(); const db = st.snapshot;
    const c = db.malpracticeCases.find(x => x.status === 'UNDER_INVESTIGATION')!;
    st.run(d => S.decideCase(d, 'u_admin1', c.id, 'DISMISSED', 'Recording shows notes were permitted reference sheet.'));
    assert.equal(st.snapshot.studentBadges.find(b => b.id === c.studentBadgeId)!.status, 'UNDER_REVIEW');
  });
  test('student keeps several badges with different statuses', () => {
    const db = createSeed();
    const statuses = new Set(db.studentBadges.map(b => b.status));
    assert.deepEqual([...statuses].sort(), ['EARNED', 'NULLIFIED', 'UNDER_REVIEW']);
  });
});

describe('reliability', () => {
  test('a failing step rolls back the whole transaction', () => {
    const st = fresh(); const v = st.snapshot.version; const n = st.snapshot.bookings.length;
    assert.throws(() => st.run(db => { S.bookSlot(db, AARAV, { studentId: 'st_01', badgeDefId: 'bd_prod_nov', slotId: openSlot(db).id }); throw new Error('db down'); }));
    assert.equal(st.snapshot.version, v); assert.equal(st.snapshot.bookings.length, n);
  });
  test('notification delivery failure does not roll back the booking', () => {
    const st = fresh(); st.run(db => { db.simulateNotificationFailure = true; });
    st.run(db => S.bookSlot(db, AARAV, { studentId: 'st_01', badgeDefId: 'bd_prod_nov', slotId: openSlot(db).id }));
    assert.equal(st.snapshot.notifications.at(-1)!.deliveryStatus, 'FAILED');
    assert.equal(deriveJourney(st.snapshot, 'st_01', 'bd_prod_nov').state, 'BOOKED');
  });
  test('missing records raise NOT_FOUND', () => {
    const st = fresh();
    assert.equal(code(() => st.run(d => S.cancelBooking(d, 'u_admin1', 'bkg_nope', ''))), 'NOT_FOUND');
  });
  test('only reviewers with settings permission can change policies', () => {
    const st = fresh();
    assert.equal(code(() => st.run(d => S.updatePolicies(d, 'u_admin2', { retakeCooldownDays: 1 }))), 'FORBIDDEN');
    st.run(d => S.updatePolicies(d, 'u_admin1', { retakeCooldownDays: 1 }));
    assert.equal(deriveJourney(st.snapshot, sid(st.snapshot, 'Vihaan'), 'bd_sys_nov').state, 'RETAKE_ELIGIBLE');
  });
});

clock.set(null);
