import {
  DAY, HOUR, audit, badgeLabel, clock, fail, getAttempt, getBadgeDef, getBooking, getInterviewer, getSlot,
  getStudent, getUser, interviewerByUser, interviewerName, nextId, notify, nowISO, studentByUser,
} from './core';
import { deriveJourney, evaluateEligibility } from './eligibility';
import { fmtDate, fmtDateTime, fmtTime, tzLabel, zonedToUtc, addDaysKey } from './format';
import { MESSAGES } from './messages';
import { transition } from './stateMachine';
import type {
  Booking, DB, ID, InterviewAttempt, Outcome, Policies, Scores, Slot, StudentBadge, User,
} from './types';

// ── Authorization helpers (server-side checks; RLS mirrors these in the SQL schema) ──
function actor(db: DB, actorId: ID): User {
  const u = getUser(db, actorId);
  if (!u.isActive) fail('FORBIDDEN', 'Your account is inactive.');
  return u;
}
function requireRole(u: User, ...roles: User['role'][]) {
  if (!roles.includes(u.role)) fail('FORBIDDEN', 'You do not have permission to do this.');
}
function assertStudentSelfOrAdmin(db: DB, u: User, studentId: ID) {
  if (u.role === 'ADMIN') return;
  if (u.role === 'STUDENT' && studentByUser(db, u.id)?.id === studentId) return;
  fail('FORBIDDEN', 'You can only act on your own records.');
}
function assertInterviewerSelfOrAdmin(db: DB, u: User, interviewerId: ID) {
  if (u.role === 'ADMIN') return;
  if (u.role === 'INTERVIEWER' && interviewerByUser(db, u.id)?.id === interviewerId) return;
  fail('FORBIDDEN', 'You can only manage your own schedule and assigned interviews.');
}
const overlaps = (a1: string, a2: string, b1: string, b2: string) => a1 < b2 && b1 < a2;

// ════════════════════════════════════════════════════════════
// AVAILABILITY
// ════════════════════════════════════════════════════════════
export interface AddAvailabilityInput { interviewerId: ID; date: string; start: string; end: string; repeatWeeks?: number; }

export function addAvailability(db: DB, actorId: ID, inp: AddAvailabilityInput) {
  const u = actor(db, actorId); requireRole(u, 'INTERVIEWER', 'ADMIN');
  assertInterviewerSelfOrAdmin(db, u, inp.interviewerId);
  const iv = getInterviewer(db, inp.interviewerId);
  if (!iv.isActive) fail('INACTIVE', 'Inactive interviewers cannot add availability.');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(inp.date) || !/^\d{2}:\d{2}$/.test(inp.start) || !/^\d{2}:\d{2}$/.test(inp.end)) fail('VALIDATION', 'Enter a valid date and times.');
  if (inp.end <= inp.start) fail('VALIDATION', 'End time must be after start time.');
  const weeks = Math.min(Math.max(inp.repeatWeeks ?? 1, 1), 8);
  const p = db.policies;
  const seriesId = weeks > 1 ? nextId(db, 'ser') : undefined;
  const created: ID[] = [];
  for (let w = 0; w < weeks; w++) {
    const date = addDaysKey(inp.date, 7 * w);
    const startAt = zonedToUtc(date, inp.start, iv.timezone).toISOString();
    const endAt = zonedToUtc(date, inp.end, iv.timezone).toISOString();
    if (new Date(endAt) <= clock.now()) fail('SLOT_IN_PAST', 'Availability cannot be added in the past.');
    if ((new Date(endAt).getTime() - new Date(startAt).getTime()) / 60000 < p.interviewDurationMin) fail('VALIDATION', `Window must be at least ${p.interviewDurationMin} minutes.`);
    const clash = db.windows.find(x => x.interviewerId === iv.id && !x.removedAt && overlaps(startAt, endAt, x.startAt, x.endAt));
    if (clash) fail('OVERLAP', `This overlaps your existing availability on ${fmtDateTime(clash.startAt)}–${fmtTime(clash.endAt)}.`);
    const win = { id: nextId(db, 'win'), interviewerId: iv.id, startAt, endAt, seriesId, createdAt: nowISO() };
    db.windows.push(win);
    // Slot generation: fixed duration + buffer between interviews.
    let t = new Date(startAt).getTime();
    const step = (p.interviewDurationMin + p.slotBufferMin) * 60000;
    while (t + p.interviewDurationMin * 60000 <= new Date(endAt).getTime()) {
      db.slots.push({ id: nextId(db, 'slot'), interviewerId: iv.id, windowId: win.id, startAt: new Date(t).toISOString(), endAt: new Date(t + p.interviewDurationMin * 60000).toISOString(), status: 'OPEN' });
      t += step;
    }
    created.push(win.id);
  }
  audit(db, actorId, 'availability.added', 'availability', created[0], undefined, { ...inp, weeks }, { windows: created });
  return created;
}

export function removeAvailability(db: DB, actorId: ID, windowId: ID) {
  const u = actor(db, actorId);
  const win = db.windows.find(w => w.id === windowId) ?? fail('NOT_FOUND', 'Availability not found');
  assertInterviewerSelfOrAdmin(db, u, win.interviewerId);
  const slots = db.slots.filter(s => s.windowId === windowId);
  const booked = slots.filter(s => s.status === 'BOOKED');
  // Never silently invalidate a booking.
  if (booked.length) fail('HAS_BOOKINGS', `${booked.length} student${booked.length > 1 ? 's are' : ' is'} booked in this window. Mark yourself unavailable for those interviews first so they can be reassigned.`, { slotIds: booked.map(s => s.id) });
  for (const s of slots) if (s.status !== 'REMOVED') transition(db, actorId, 'slot', s, 'status', 'REMOVED');
  win.removedAt = nowISO();
  audit(db, actorId, 'availability.removed', 'availability', windowId);
}

export function setSlotBlocked(db: DB, actorId: ID, slotId: ID, blocked: boolean) {
  const u = actor(db, actorId);
  const slot = getSlot(db, slotId);
  assertInterviewerSelfOrAdmin(db, u, slot.interviewerId);
  if (blocked && slot.status === 'BOOKED') fail('HAS_BOOKINGS', 'This slot is booked. Use “I can’t make it” on the interview instead.');
  if (!blocked && new Date(slot.startAt) < clock.now()) fail('SLOT_IN_PAST', 'Past slots cannot be reopened.');
  transition(db, actorId, 'slot', slot, 'status', blocked ? 'BLOCKED' : 'OPEN');
}

// ════════════════════════════════════════════════════════════
// BOOKING
// ════════════════════════════════════════════════════════════
export function bookableSlots(db: DB, studentId: ID): Slot[] {
  const now = clock.now().getTime(); const p = db.policies;
  const myBooked = db.bookings.filter(b => b.studentId === studentId && b.status === 'BOOKED').map(b => getSlot(db, b.slotId));
  return db.slots.filter(s => {
    if (s.status !== 'OPEN') return false;
    const t = new Date(s.startAt).getTime();
    if (t < now + p.minBookingLeadHours * HOUR || t > now + p.bookingHorizonDays * DAY) return false;
    const iv = db.interviewers.find(i => i.id === s.interviewerId);
    if (!iv?.isActive) return false;
    return !myBooked.some(m => overlaps(m.startAt, m.endAt, s.startAt, s.endAt));
  }).sort((a, b) => a.startAt.localeCompare(b.startAt));
}

function validateSlotForBooking(db: DB, slot: Slot, studentId: ID, ignoreBookingId?: ID) {
  const p = db.policies; const now = clock.now();
  if (new Date(slot.startAt) <= now) fail('SLOT_IN_PAST', 'That slot is in the past. Please pick another time.');
  if (slot.status !== 'OPEN') fail('SLOT_TAKEN', 'Sorry — someone just booked that slot. Please pick another time.');
  if (new Date(slot.startAt).getTime() < now.getTime() + p.minBookingLeadHours * HOUR) fail('CUTOFF_PASSED', `Slots must be booked at least ${p.minBookingLeadHours} hours in advance.`);
  if (new Date(slot.startAt).getTime() > now.getTime() + p.bookingHorizonDays * DAY) fail('VALIDATION', `Slots can be booked at most ${p.bookingHorizonDays} days ahead.`);
  if (!getInterviewer(db, slot.interviewerId).isActive) fail('INACTIVE', 'That interviewer is no longer available. Please pick another slot.');
  const clash = db.bookings.find(b => b.studentId === studentId && b.status === 'BOOKED' && b.id !== ignoreBookingId && (() => { const s = getSlot(db, b.slotId); return overlaps(s.startAt, s.endAt, slot.startAt, slot.endAt); })());
  if (clash) fail('ALREADY_BOOKED', 'You already have an interview at that time.');
}

export interface BookInput { studentId: ID; badgeDefId: ID; slotId: ID; idempotencyKey?: string; }

export function bookSlot(db: DB, actorId: ID, inp: BookInput): Booking {
  const u = actor(db, actorId); assertStudentSelfOrAdmin(db, u, inp.studentId);
  const student = getStudent(db, inp.studentId); getBadgeDef(db, inp.badgeDefId);
  // Idempotency: a retried request (double-click, network retry) returns the original booking.
  if (inp.idempotencyKey) {
    const prior = db.bookings.find(b => b.idempotencyKey === inp.idempotencyKey && b.studentId === inp.studentId);
    if (prior) return prior;
  }
  const j = deriveJourney(db, inp.studentId, inp.badgeDefId);
  if (j.activeBooking) fail('ALREADY_BOOKED', 'You already have an interview booked for this badge. Reschedule it instead.');
  if (j.state === 'PASSED' || j.state === 'BADGE_UNDER_REVIEW' || j.state === 'BADGE_NULLIFIED') fail('VALIDATION', 'This badge interview is already complete.');
  if (j.state === 'ATTEMPTS_EXHAUSTED') fail('LIMIT_REACHED', 'You have used all interview attempts for this badge.');
  if (!j.eligibility.eligible) fail('NOT_ELIGIBLE', 'Clear all required skills before booking this interview.');
  if (!j.canBook) fail('COOLDOWN', `You can book your next attempt from ${j.nextBookableAt ? fmtDate(j.nextBookableAt) : 'later'}.`);
  const slot = getSlot(db, inp.slotId);
  validateSlotForBooking(db, slot, inp.studentId);

  transition(db, actorId, 'slot', slot, 'status', 'BOOKED');
  const booking: Booking = {
    id: nextId(db, 'bkg'), studentId: inp.studentId, badgeDefId: inp.badgeDefId, slotId: slot.id, status: 'BOOKED',
    bookedAt: nowISO(), meetingLink: `https://meet.grit.example/${student.studentCode.toLowerCase()}-${slot.id}`,
    idempotencyKey: inp.idempotencyKey, rescheduleCount: 0, eligibilitySnapshotAt: nowISO(),
  };
  db.bookings.push(booking);
  const attemptNumber = j.attempts.filter(a => a.interviewStatus !== 'CANCELLED').length + 1;
  const attempt: InterviewAttempt = {
    id: nextId(db, 'att'), bookingId: booking.id, studentId: inp.studentId, badgeDefId: inp.badgeDefId,
    interviewerId: slot.interviewerId, attemptNumber, interviewStatus: 'SCHEDULED', attendance: 'PENDING', outcome: 'PENDING',
    revisions: [], createdAt: nowISO(),
  };
  db.attempts.push(attempt);
  audit(db, actorId, 'booking.created', 'booking', booking.id, undefined, 'BOOKED', { slotId: slot.id, attemptId: attempt.id, attemptNumber });
  notify(db, student.userId, 'BOOKING_CONFIRMED', MESSAGES.bookingConfirmed({
    date: fmtDate(slot.startAt, student.timezone), time: `${fmtTime(slot.startAt, student.timezone)} ${tzLabel(student.timezone)}`, interviewer: interviewerName(db, slot.interviewerId),
  }));
  return booking;
}

function assertBeforeCutoff(db: DB, u: User, slot: Slot, verb: string) {
  if (u.role === 'ADMIN') return; // ops can override policy; it is audited
  const hours = (new Date(slot.startAt).getTime() - clock.now().getTime()) / HOUR;
  if (hours < db.policies.cancelRescheduleCutoffHours) fail('CUTOFF_PASSED', `Interviews can't be ${verb} less than ${db.policies.cancelRescheduleCutoffHours} hours before the start time. Contact the GRIT team if this is an emergency.`);
}

export function cancelBooking(db: DB, actorId: ID, bookingId: ID, reason: string) {
  const u = actor(db, actorId);
  const b = getBooking(db, bookingId); assertStudentSelfOrAdmin(db, u, b.studentId);
  if (b.status !== 'BOOKED') fail('INVALID_TRANSITION', 'Only active bookings can be cancelled.');
  const slot = getSlot(db, b.slotId); assertBeforeCutoff(db, u, slot, 'cancelled');
  const att = db.attempts.find(a => a.bookingId === b.id);
  if (att && att.interviewStatus !== 'SCHEDULED') fail('INVALID_TRANSITION', 'This interview has already started.');
  transition(db, actorId, 'booking', b, 'status', 'CANCELLED', { reason });
  b.cancelledAt = nowISO(); b.cancelledBy = actorId; b.cancellationReason = reason || 'No reason given';
  if (att) transition(db, actorId, 'interview', att, 'interviewStatus', 'CANCELLED');
  transition(db, actorId, 'slot', slot, 'status', new Date(slot.startAt) > clock.now() ? 'OPEN' : 'BLOCKED');
  const s = getStudent(db, b.studentId);
  notify(db, s.userId, 'CANCELLED', MESSAGES.cancelled({ when: fmtDateTime(slot.startAt, s.timezone) }));
}

export function rescheduleBooking(db: DB, actorId: ID, bookingId: ID, newSlotId: ID): Booking {
  const u = actor(db, actorId);
  const old = getBooking(db, bookingId); assertStudentSelfOrAdmin(db, u, old.studentId);
  if (old.status !== 'BOOKED') fail('INVALID_TRANSITION', 'Only active bookings can be rescheduled.');
  const oldSlot = getSlot(db, old.slotId); assertBeforeCutoff(db, u, oldSlot, 'rescheduled');
  if (u.role !== 'ADMIN' && old.rescheduleCount >= db.policies.maxReschedulesPerBooking) fail('LIMIT_REACHED', `You can reschedule at most ${db.policies.maxReschedulesPerBooking} times. Cancel and rebook instead.`);
  const newSlot = getSlot(db, newSlotId);
  if (newSlot.id === oldSlot.id) fail('VALIDATION', 'Pick a different slot.');
  validateSlotForBooking(db, newSlot, old.studentId, old.id);
  const att = db.attempts.find(a => a.bookingId === old.id && a.interviewStatus === 'SCHEDULED') ?? fail('INVALID_TRANSITION', 'This interview has already started.');

  transition(db, actorId, 'booking', old, 'status', 'RESCHEDULED');
  transition(db, actorId, 'slot', oldSlot, 'status', 'OPEN');
  transition(db, actorId, 'slot', newSlot, 'status', 'BOOKED');
  const nb: Booking = { ...old, id: nextId(db, 'bkg'), slotId: newSlot.id, status: 'BOOKED', bookedAt: nowISO(), rescheduledFromId: old.id, rescheduleCount: old.rescheduleCount + 1, idempotencyKey: undefined, meetingLink: old.meetingLink.replace(/-[^-]+$/, `-${newSlot.id}`) };
  old.rescheduledToId = nb.id;
  db.bookings.push(nb);
  // Same attempt, moved — a reschedule is not a new attempt.
  att.bookingId = nb.id; att.interviewerId = newSlot.interviewerId;
  audit(db, actorId, 'booking.rescheduled', 'booking', nb.id, { slotId: oldSlot.id }, { slotId: newSlot.id }, { fromBooking: old.id });
  const s = getStudent(db, old.studentId);
  notify(db, s.userId, 'RESCHEDULED', MESSAGES.rescheduled({ from: fmtDateTime(oldSlot.startAt, s.timezone), to: fmtDateTime(newSlot.startAt, s.timezone), interviewer: interviewerName(db, newSlot.interviewerId) }));
  return nb;
}

/** Interviewer can't make a booked interview: reassign to a colleague free at the same time, else cancel with priority rebooking. */
export function interviewerUnavailable(db: DB, actorId: ID, attemptId: ID, reason: string): { reassignedTo?: ID } {
  const u = actor(db, actorId);
  const att = getAttempt(db, attemptId); assertInterviewerSelfOrAdmin(db, u, att.interviewerId);
  if (att.interviewStatus !== 'SCHEDULED') fail('INVALID_TRANSITION', 'Only upcoming interviews can be released.');
  const b = getBooking(db, att.bookingId); const slot = getSlot(db, b.slotId);
  const s = getStudent(db, att.studentId);
  const alt = db.slots.find(x => x.status === 'OPEN' && x.startAt === slot.startAt && x.interviewerId !== att.interviewerId && db.interviewers.find(i => i.id === x.interviewerId)?.isActive);
  transition(db, actorId, 'slot', slot, 'status', 'BLOCKED', { reason });
  if (alt) {
    transition(db, actorId, 'slot', alt, 'status', 'BOOKED');
    const from = att.interviewerId;
    b.slotId = alt.id; att.interviewerId = alt.interviewerId;
    audit(db, actorId, 'booking.reassigned', 'booking', b.id, { interviewerId: from, slotId: slot.id }, { interviewerId: alt.interviewerId, slotId: alt.id }, { reason });
    notify(db, s.userId, 'INTERVIEWER_UNAVAILABLE', MESSAGES.interviewerUnavailable({ when: fmtDateTime(slot.startAt), newWhen: fmtDateTime(alt.startAt, s.timezone), newInterviewer: interviewerName(db, alt.interviewerId) }));
    return { reassignedTo: alt.interviewerId };
  }
  transition(db, actorId, 'booking', b, 'status', 'CANCELLED', { reason, system: true });
  b.cancelledAt = nowISO(); b.cancelledBy = actorId; b.cancellationReason = `Interviewer unavailable: ${reason}`; b.priorityRebook = true;
  transition(db, actorId, 'interview', att, 'interviewStatus', 'CANCELLED');
  notify(db, s.userId, 'INTERVIEWER_UNAVAILABLE', MESSAGES.interviewerUnavailable({ when: fmtDateTime(slot.startAt, s.timezone) }));
  return {};
}

// ════════════════════════════════════════════════════════════
// INTERVIEW CONDUCT & OUTCOMES
// ════════════════════════════════════════════════════════════
export const START_WINDOW_BEFORE_MIN = 60;  // interview room opens 60 min early
const START_WINDOW_AFTER_H = 3;

export function startInterview(db: DB, actorId: ID, attemptId: ID) {
  const u = actor(db, actorId); const att = getAttempt(db, attemptId);
  requireRole(u, 'INTERVIEWER'); assertInterviewerSelfOrAdmin(db, u, att.interviewerId);
  const slot = getSlot(db, getBooking(db, att.bookingId).slotId);
  const now = clock.now().getTime();
  if (now < new Date(slot.startAt).getTime() - START_WINDOW_BEFORE_MIN * 60000) fail('VALIDATION', `You can start this interview from ${fmtTime(new Date(new Date(slot.startAt).getTime() - START_WINDOW_BEFORE_MIN * 60000).toISOString())} (${START_WINDOW_BEFORE_MIN} min before it begins).`);
  if (now > new Date(slot.endAt).getTime() + START_WINDOW_AFTER_H * HOUR) fail('VALIDATION', 'This interview slot has passed. Mark attendance instead or ask ops to resolve it.');
  transition(db, actorId, 'interview', att, 'interviewStatus', 'IN_PROGRESS');
  transition(db, actorId, 'attendance', att, 'attendance', 'PRESENT');
  att.startedAt = nowISO();
}

export function markStudentNoShow(db: DB, actorId: ID, attemptId: ID) {
  const u = actor(db, actorId); const att = getAttempt(db, attemptId);
  assertInterviewerSelfOrAdmin(db, u, att.interviewerId);
  const slot = getSlot(db, getBooking(db, att.bookingId).slotId);
  if (clock.now() < new Date(slot.startAt)) fail('VALIDATION', 'You can mark a no-show only after the start time.');
  transition(db, actorId, 'attendance', att, 'attendance', 'STUDENT_NO_SHOW');
  transition(db, actorId, 'interview', att, 'interviewStatus', 'COMPLETED');
  att.submittedAt = nowISO(); att.submittedBy = actorId;
  transition(db, actorId, 'booking', getBooking(db, att.bookingId), 'status', 'COMPLETED');
  const s = getStudent(db, att.studentId);
  const j = deriveJourney(db, att.studentId, att.badgeDefId);
  notify(db, s.userId, 'NO_SHOW', MESSAGES.noShow({ badge: badgeLabel(db, att.badgeDefId), availableOn: j.nextBookableAt ? fmtDate(j.nextBookableAt) : 'now' }));
}

/** Ops records that the interviewer did not show up (reported by the student). Does not count as an attempt. */
export function markInterviewerNoShow(db: DB, actorId: ID, attemptId: ID) {
  const u = actor(db, actorId); requireRole(u, 'ADMIN');
  const att = getAttempt(db, attemptId);
  if (att.interviewStatus !== 'SCHEDULED') fail('INVALID_TRANSITION', 'Only interviews that never started can be marked this way.');
  transition(db, actorId, 'attendance', att, 'attendance', 'INTERVIEWER_NO_SHOW');
  transition(db, actorId, 'interview', att, 'interviewStatus', 'COMPLETED');
  att.submittedAt = nowISO(); att.submittedBy = actorId;
  transition(db, actorId, 'booking', getBooking(db, att.bookingId), 'status', 'COMPLETED');
  const s = getStudent(db, att.studentId);
  notify(db, s.userId, 'INTERVIEWER_UNAVAILABLE', MESSAGES.interviewerUnavailable({ when: fmtDateTime(getSlot(db, getBooking(db, att.bookingId).slotId).startAt, s.timezone) }));
}

export interface OutcomeInput { outcome: Exclude<Outcome, 'PENDING'>; scores: Scores; feedback: string; }

function validateOutcome(inp: OutcomeInput) {
  if (!['PASS', 'FAIL', 'RETAKE_LATER'].includes(inp.outcome)) fail('VALIDATION', 'Choose Pass, Fail or Retake later.');
  for (const [k, v] of Object.entries(inp.scores)) if (!Number.isInteger(v) || v < 1 || v > 5) fail('VALIDATION', `Score “${k}” must be between 1 and 5.`);
  if (inp.outcome !== 'PASS' && inp.feedback.trim().length < 20) fail('VALIDATION', 'Write at least 20 characters of feedback so the student knows what to work on.');
}

function awardBadge(db: DB, actorId: ID, att: InterviewAttempt): StudentBadge {
  if (db.studentBadges.some(b => b.studentId === att.studentId && b.badgeDefId === att.badgeDefId)) fail('DUPLICATE', 'This student already holds this badge.');
  const sb: StudentBadge = { id: nextId(db, 'sbg'), studentId: att.studentId, badgeDefId: att.badgeDefId, attemptId: att.id, status: 'EARNED', earnedAt: nowISO(), history: [{ at: nowISO(), by: actorId, to: 'EARNED', note: `Interview attempt ${att.attemptNumber} passed` }] };
  db.studentBadges.push(sb);
  audit(db, actorId, 'badge.earned', 'badge', sb.id, undefined, 'EARNED', { attemptId: att.id });
  return sb;
}

function notifyOutcome(db: DB, att: InterviewAttempt) {
  const s = getStudent(db, att.studentId);
  const badge = badgeLabel(db, att.badgeDefId);
  const j = deriveJourney(db, att.studentId, att.badgeDefId);
  const on = j.nextBookableAt ? fmtDate(j.nextBookableAt, s.timezone) : 'today';
  if (att.outcome === 'PASS') notify(db, s.userId, 'RESULT_PASS', MESSAGES.pass());
  if (att.outcome === 'RETAKE_LATER') notify(db, s.userId, 'RESULT_RETAKE', MESSAGES.retake({ badge, availableOn: on, feedback: att.feedback }));
  if (att.outcome === 'FAIL') notify(db, s.userId, 'RESULT_FAIL', MESSAGES.fail({ badge, availableOn: on, attemptsLeft: j.attemptsLeft }));
}

export function submitOutcome(db: DB, actorId: ID, attemptId: ID, inp: OutcomeInput) {
  const u = actor(db, actorId); const att = getAttempt(db, attemptId);
  requireRole(u, 'INTERVIEWER'); assertInterviewerSelfOrAdmin(db, u, att.interviewerId);
  if (att.interviewStatus === 'COMPLETED') fail('DUPLICATE', 'An outcome has already been submitted for this interview.');
  if (att.interviewStatus !== 'IN_PROGRESS') fail('INVALID_TRANSITION', 'Start the interview before recording an outcome.');
  validateOutcome(inp);
  transition(db, actorId, 'outcome', att, 'outcome', inp.outcome);
  transition(db, actorId, 'interview', att, 'interviewStatus', 'COMPLETED');
  att.scores = inp.scores; att.feedback = inp.feedback.trim(); att.submittedAt = nowISO(); att.submittedBy = actorId;
  att.revisions.push({ outcome: inp.outcome, feedback: att.feedback, changedAt: att.submittedAt, changedBy: actorId });
  transition(db, actorId, 'booking', getBooking(db, att.bookingId), 'status', 'COMPLETED');
  if (inp.outcome === 'PASS') awardBadge(db, actorId, att);
  notifyOutcome(db, att);
}

/** Correcting a submitted result: interviewer within the edit window, or an admin; reason mandatory; history kept.
 *  Moving a result AWAY from Pass is not allowed here — revoking an awarded badge must go through malpractice review. */
export function amendOutcome(db: DB, actorId: ID, attemptId: ID, inp: OutcomeInput & { reason: string }) {
  const u = actor(db, actorId); const att = getAttempt(db, attemptId);
  assertInterviewerSelfOrAdmin(db, u, att.interviewerId);
  if (att.interviewStatus !== 'COMPLETED' || att.outcome === 'PENDING') fail('INVALID_TRANSITION', 'There is no submitted outcome to change.');
  if (u.role === 'INTERVIEWER') {
    const age = (clock.now().getTime() - new Date(att.submittedAt!).getTime()) / HOUR;
    if (age > db.policies.outcomeEditWindowHours) fail('FORBIDDEN', `Results can only be changed within ${db.policies.outcomeEditWindowHours} hours. Ask the ops team to amend it.`);
  }
  if (inp.reason.trim().length < 10) fail('VALIDATION', 'Give a reason (at least 10 characters) for changing a submitted result.');
  if (att.outcome === inp.outcome) fail('VALIDATION', 'The outcome is unchanged.');
  if (att.outcome === 'PASS') fail('FORBIDDEN', 'A Pass that awarded a badge can only be reversed through a malpractice review.');
  if (deriveJourney(db, att.studentId, att.badgeDefId).activeBooking) fail('CONFLICT', 'The student has already booked another attempt. Cancel that booking before amending.');
  validateOutcome(inp);
  const old = att.outcome;
  att.outcome = inp.outcome; att.scores = inp.scores; att.feedback = inp.feedback.trim();
  att.revisions.push({ outcome: inp.outcome, feedback: att.feedback, changedAt: nowISO(), changedBy: actorId, reason: inp.reason.trim() });
  audit(db, actorId, 'outcome.amended', 'interview', att.id, old, inp.outcome, { reason: inp.reason.trim() });
  if (inp.outcome === 'PASS') awardBadge(db, actorId, att);
  notifyOutcome(db, att);
}

// ════════════════════════════════════════════════════════════
// MALPRACTICE & BADGES
// ════════════════════════════════════════════════════════════
export function flagMalpractice(db: DB, actorId: ID, studentBadgeId: ID, description: string, evidenceRef: string) {
  const u = actor(db, actorId); requireRole(u, 'ADMIN', 'INTERVIEWER');
  const sb = db.studentBadges.find(b => b.id === studentBadgeId) ?? fail('NOT_FOUND', 'Badge not found');
  if (u.role === 'INTERVIEWER' && !db.attempts.some(a => a.studentId === sb.studentId && a.interviewerId === interviewerByUser(db, u.id)?.id))
    fail('FORBIDDEN', 'Interviewers can flag only students they have interviewed. Ask the ops team to raise it.');
  if (sb.status === 'NULLIFIED') fail('INVALID_TRANSITION', 'This badge is already nullified.');
  if (description.trim().length < 15) fail('VALIDATION', 'Describe the concern in at least 15 characters.');
  const c = { id: nextId(db, 'case'), studentId: sb.studentId, studentBadgeId: sb.id, reportedBy: actorId, description: description.trim(), evidenceRef: evidenceRef.trim() || '—', status: 'FLAGGED' as const, createdAt: nowISO(), timeline: [{ at: nowISO(), by: actorId, action: 'Flag raised', note: description.trim() }] };
  db.malpracticeCases.push(c);
  audit(db, actorId, 'malpractice.flagged', 'malpractice_case', c.id, undefined, 'FLAGGED', { studentBadgeId: sb.id });
  if (sb.status === 'EARNED') {   // a second flag on a badge already under review just adds a case
    transition(db, actorId, 'badge', sb, 'status', 'UNDER_REVIEW', { caseId: c.id });
    sb.history.push({ at: nowISO(), by: actorId, from: 'EARNED', to: 'UNDER_REVIEW', note: `Case ${c.id} opened` });
    const s = getStudent(db, sb.studentId);
    notify(db, s.userId, 'BADGE_UNDER_REVIEW', MESSAGES.underReview({ badge: badgeLabel(db, sb.badgeDefId) }));
  }
  return c.id;
}

function assertReviewer(u: User) {
  if (u.role !== 'ADMIN' || !u.permissions?.reviewMalpractice) fail('FORBIDDEN', 'Only authorised integrity reviewers can do this.');
}

export function startInvestigation(db: DB, actorId: ID, caseId: ID, note: string) {
  const u = actor(db, actorId); assertReviewer(u);
  const c = db.malpracticeCases.find(x => x.id === caseId) ?? fail('NOT_FOUND', 'Case not found');
  if (c.status !== 'FLAGGED') fail('INVALID_TRANSITION', 'Only newly flagged cases can be opened for investigation.');
  transition(db, actorId, 'malpractice', c, 'status', 'UNDER_INVESTIGATION');
  c.timeline.push({ at: nowISO(), by: actorId, action: 'Investigation started', note: note.trim() || undefined });
}

export function decideCase(db: DB, actorId: ID, caseId: ID, decision: 'CONFIRMED' | 'DISMISSED', reason: string) {
  const u = actor(db, actorId); assertReviewer(u);
  const c = db.malpracticeCases.find(x => x.id === caseId) ?? fail('NOT_FOUND', 'Case not found');
  if (reason.trim().length < 15) fail('VALIDATION', 'Record the reason for this decision (at least 15 characters).');
  if (c.status !== 'FLAGGED' && c.status !== 'UNDER_INVESTIGATION') fail('INVALID_TRANSITION', 'This case is already decided.');
  if (decision === 'CONFIRMED' && c.status !== 'UNDER_INVESTIGATION') fail('INVALID_TRANSITION', 'Malpractice can only be confirmed after an investigation is opened.');
  transition(db, actorId, 'malpractice', c, 'status', decision, { reason });
  c.decisionReason = reason.trim(); c.reviewedBy = actorId; c.reviewedAt = nowISO();
  c.timeline.push({ at: nowISO(), by: actorId, action: decision === 'CONFIRMED' ? 'Malpractice confirmed' : 'Case dismissed', note: reason.trim() });
  const sb = db.studentBadges.find(b => b.id === c.studentBadgeId)!;
  const s = getStudent(db, sb.studentId); const badge = badgeLabel(db, sb.badgeDefId);
  if (decision === 'CONFIRMED' && sb.status === 'UNDER_REVIEW') {
    transition(db, actorId, 'badge', sb, 'status', 'NULLIFIED', { caseId });
    sb.nullifiedAt = nowISO();
    sb.history.push({ at: nowISO(), by: actorId, from: 'UNDER_REVIEW', to: 'NULLIFIED', note: `Case ${c.id} confirmed` });
    notify(db, s.userId, 'BADGE_NULLIFIED', MESSAGES.nullified({ badge }));
  }
  if (decision === 'DISMISSED' && sb.status === 'UNDER_REVIEW') {
    const stillOpen = db.malpracticeCases.some(x => x.studentBadgeId === sb.id && x.id !== c.id && (x.status === 'FLAGGED' || x.status === 'UNDER_INVESTIGATION'));
    if (!stillOpen) {
      transition(db, actorId, 'badge', sb, 'status', 'EARNED', { caseId });
      sb.history.push({ at: nowISO(), by: actorId, from: 'UNDER_REVIEW', to: 'EARNED', note: `Case ${c.id} dismissed` });
      notify(db, s.userId, 'BADGE_REINSTATED', MESSAGES.reinstated({ badge }));
    }
  }
}

// ════════════════════════════════════════════════════════════
// OPS / ADMIN
// ════════════════════════════════════════════════════════════
export function nudgeStudent(db: DB, actorId: ID, studentId: ID) {
  const u = actor(db, actorId); requireRole(u, 'ADMIN');
  const s = getStudent(db, studentId);
  const recent = db.notifications.find(n => n.userId === s.userId && n.type === 'NUDGE' && clock.now().getTime() - new Date(n.createdAt).getTime() < DAY);
  if (recent) fail('DUPLICATE', 'This student was already nudged in the last 24 hours.');
  const bd = db.badgeDefs.find(b => deriveJourney(db, studentId, b.id).state === 'ELIGIBLE');
  if (!bd) fail('VALIDATION', 'This student has nothing to book right now.');
  notify(db, s.userId, 'NUDGE', MESSAGES.nudge({ badge: badgeLabel(db, bd!.id) }));
  audit(db, actorId, 'student.nudged', 'student', studentId);
}

export function remindInterviewer(db: DB, actorId: ID, attemptId: ID) {
  const u = actor(db, actorId); requireRole(u, 'ADMIN');
  const att = getAttempt(db, attemptId); const iv = getInterviewer(db, att.interviewerId);
  notify(db, iv.userId, 'REMINDER', { title: 'Outcome pending', body: `Please record the outcome for your interview with ${getUser(db, getStudent(db, att.studentId).userId).fullName}.`, cta: { label: 'Open interview', to: `interviewer/interview/${att.id}` } });
  audit(db, actorId, 'interviewer.reminded', 'interview', attemptId);
}

export function updatePolicies(db: DB, actorId: ID, patch: Partial<Policies>) {
  const u = actor(db, actorId); requireRole(u, 'ADMIN');
  if (!u.permissions?.editSettings) fail('FORBIDDEN', 'You do not have permission to change policies.');
  const next = { ...db.policies, ...patch };
  for (const [k, v] of Object.entries(next)) if (typeof v === 'number' && (!Number.isFinite(v) || v < 0 || v > 1000)) fail('VALIDATION', `Invalid value for ${k}.`);
  if (next.interviewDurationMin < 10) fail('VALIDATION', 'Interviews must be at least 10 minutes.');
  if (next.maxAttemptsPerBadge < 1) fail('VALIDATION', 'Allow at least one attempt.');
  audit(db, actorId, 'settings.updated', 'settings', 'policies', db.policies, next);
  db.policies = next;
}

/** Changing a badge's required skills re-evaluates eligibility for students who have NOT booked.
 *  Students with an active booking are grandfathered (eligibility locked at booking time). */
export function setSkillRequired(db: DB, actorId: ID, badgeDefId: ID, skillId: ID, required: boolean) {
  const u = actor(db, actorId); requireRole(u, 'ADMIN');
  if (!u.permissions?.editSettings) fail('FORBIDDEN', 'You do not have permission to change badge requirements.');
  const exists = db.badgeSkillReqs.some(r => r.badgeDefId === badgeDefId && r.skillId === skillId);
  if (required && !exists) db.badgeSkillReqs.push({ badgeDefId, skillId });
  if (!required && exists) {
    if (db.badgeSkillReqs.filter(r => r.badgeDefId === badgeDefId).length === 1) fail('VALIDATION', 'A badge needs at least one required skill.');
    db.badgeSkillReqs = db.badgeSkillReqs.filter(r => !(r.badgeDefId === badgeDefId && r.skillId === skillId));
  }
  audit(db, actorId, 'badge.requirements_changed', 'badge_definition', badgeDefId, undefined, { skillId, required });
}

export function setInterviewerActive(db: DB, actorId: ID, interviewerId: ID, active: boolean) {
  const u = actor(db, actorId); requireRole(u, 'ADMIN');
  const iv = getInterviewer(db, interviewerId);
  if (!active) {
    const upcoming = db.attempts.filter(a => a.interviewerId === iv.id && a.interviewStatus === 'SCHEDULED');
    if (upcoming.length) fail('HAS_BOOKINGS', `This interviewer has ${upcoming.length} upcoming interview(s). Reassign them first.`);
    db.slots.filter(s => s.interviewerId === iv.id && s.status === 'OPEN').forEach(s => transition(db, actorId, 'slot', s, 'status', 'BLOCKED', { reason: 'interviewer deactivated' }));
  }
  audit(db, actorId, active ? 'interviewer.activated' : 'interviewer.deactivated', 'interviewer', iv.id, iv.isActive, active);
  iv.isActive = active;
}

/** Contest results arrive from the skill-contest system (SYSTEM_ACTOR, = Supabase service role) or ops.
 *  Students can never clear their own skills. The demo's "simulate contest result" button acts as the contest system. */
export const SYSTEM_ACTOR = 'system';
export function recordSkillCleared(db: DB, actorId: ID, studentId: ID, skillId: ID) {
  if (actorId !== SYSTEM_ACTOR) { const u = actor(db, actorId); if (u.role !== 'ADMIN') fail('FORBIDDEN', 'Skill results come from the contest system or the ops team.'); }
  getStudent(db, studentId);
  const before = db.badgeDefs.filter(b => evaluateEligibility(db, studentId, b.id).eligible).map(b => b.id);
  const p = db.skillProgress.find(x => x.studentId === studentId && x.skillId === skillId);
  if (p?.status === 'CLEARED') fail('VALIDATION', 'Skill already cleared.');
  if (p) { p.status = 'CLEARED'; p.clearedAt = nowISO(); } else db.skillProgress.push({ studentId, skillId, status: 'CLEARED', clearedAt: nowISO() });
  audit(db, actorId, 'skill.cleared', 'skill_progress', `${studentId}:${skillId}`, undefined, 'CLEARED', { source: actorId === SYSTEM_ACTOR ? 'contest system' : 'ops' });
  const s = getStudent(db, studentId);
  for (const b of db.badgeDefs) {
    if (!before.includes(b.id) && evaluateEligibility(db, studentId, b.id).eligible && deriveJourney(db, studentId, b.id).state === 'ELIGIBLE') {
      notify(db, s.userId, 'ELIGIBLE', MESSAGES.eligible());
      audit(db, 'system', 'eligibility.granted', 'student', studentId, 'NOT_ELIGIBLE', 'ELIGIBLE', { badgeDefId: b.id });
    }
  }
}

export function markNotificationsRead(db: DB, actorId: ID, ids?: ID[]) {
  db.notifications.forEach(n => { if (n.userId === actorId && (!ids || ids.includes(n.id))) n.isRead = true; });
}
