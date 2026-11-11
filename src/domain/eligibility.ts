import { DAY, clock } from './core';
import type { BadgeDefinition, DB, ID, InterviewAttempt, Booking, StudentBadge } from './types';

/** Eligibility is COMPUTED from skill progress — there is no manually-set eligibility flag. */
export interface EligibilityResult {
  eligible: boolean;
  required: { skillId: ID; name: string; cleared: boolean }[];
  missingPrereqBadge?: string;
}

export function evaluateEligibility(db: DB, studentId: ID, badgeDefId: ID): EligibilityResult {
  const def = db.badgeDefs.find(b => b.id === badgeDefId);
  if (!def) return { eligible: false, required: [] };
  const required = db.badgeSkillReqs.filter(r => r.badgeDefId === badgeDefId).map(r => {
    const skill = db.skills.find(s => s.id === r.skillId);
    const p = db.skillProgress.find(x => x.studentId === studentId && x.skillId === r.skillId);
    return { skillId: r.skillId, name: skill?.name ?? r.skillId, cleared: p?.status === 'CLEARED' };
  });
  // Higher levels require the previous level's badge to be held (EARNED or UNDER_REVIEW).
  let missingPrereqBadge: string | undefined;
  const prev = db.badgeDefs.find(b => b.trackId === def.trackId && b.order === def.order - 1);
  if (prev) {
    const held = db.studentBadges.some(sb => sb.studentId === studentId && sb.badgeDefId === prev.id && sb.status !== 'NULLIFIED');
    if (!held) missingPrereqBadge = prev.name;
  }
  return { eligible: required.length > 0 && required.every(r => r.cleared) && !missingPrereqBadge, required, missingPrereqBadge };
}

// ── Derived journey state (what the student sees) ───────────
export type JourneyState =
  | 'NOT_ELIGIBLE' | 'ELIGIBLE' | 'PRIORITY_REBOOK' | 'BOOKED' | 'IN_INTERVIEW' | 'AWAITING_RESULT'
  | 'RETAKE_COOLDOWN' | 'RETAKE_ELIGIBLE' | 'FAIL_COOLDOWN' | 'FAIL_REBOOKABLE' | 'NO_SHOW_COOLDOWN'
  | 'ATTEMPTS_EXHAUSTED' | 'PASSED' | 'BADGE_UNDER_REVIEW' | 'BADGE_NULLIFIED';

export type RetakeState = 'NOT_APPLICABLE' | 'RETAKE_RECOMMENDED' | 'RETAKE_ELIGIBLE' | 'RETAKE_BOOKED' | 'RETAKE_COMPLETED';

export interface Journey {
  badgeDef: BadgeDefinition;
  state: JourneyState;
  retake: RetakeState;
  eligibility: EligibilityResult;
  activeBooking?: Booking;
  activeAttempt?: InterviewAttempt;
  attempts: InterviewAttempt[];      // newest first
  lastAttempt?: InterviewAttempt;    // latest finalized attempt
  badge?: StudentBadge;
  canBook: boolean;
  nextBookableAt?: string;           // ISO, when cooldown ends
  attemptsUsed: number;
  attemptsLeft: number;
}

export function countsAsAttempt(a: InterviewAttempt, countNoShow: boolean) {
  if (a.interviewStatus === 'CANCELLED') return false;
  if (a.attendance === 'INTERVIEWER_NO_SHOW') return false;
  if (a.attendance === 'STUDENT_NO_SHOW') return countNoShow;
  return a.interviewStatus === 'COMPLETED' && a.outcome !== 'PENDING';
}

export function deriveJourney(db: DB, studentId: ID, badgeDefId: ID): Journey {
  const p = db.policies;
  const badgeDef = db.badgeDefs.find(b => b.id === badgeDefId)!;
  const eligibility = evaluateEligibility(db, studentId, badgeDefId);
  const attempts = db.attempts.filter(a => a.studentId === studentId && a.badgeDefId === badgeDefId)
    .sort((a, b) => b.attemptNumber - a.attemptNumber || b.createdAt.localeCompare(a.createdAt));
  const badge = db.studentBadges.find(b => b.studentId === studentId && b.badgeDefId === badgeDefId);
  const activeBooking = db.bookings.find(b => b.studentId === studentId && b.badgeDefId === badgeDefId && b.status === 'BOOKED');
  const activeAttempt = activeBooking ? attempts.find(a => a.bookingId === activeBooking.id) : undefined;
  const finalized = attempts.filter(a => a.interviewStatus === 'COMPLETED');
  const lastAttempt = finalized[0];
  const attemptsUsed = attempts.filter(a => countsAsAttempt(a, p.studentNoShowCountsAsAttempt)).length;
  const attemptsLeft = Math.max(0, p.maxAttemptsPerBadge - attemptsUsed);
  const now = clock.now().getTime();

  const base = { badgeDef, eligibility, activeBooking, activeAttempt, attempts, lastAttempt, badge, attemptsUsed, attemptsLeft };
  const wasRetake = lastAttempt?.outcome === 'RETAKE_LATER';
  const retakeBase: RetakeState = wasRetake ? 'RETAKE_RECOMMENDED' : attempts.some(a => a.outcome === 'RETAKE_LATER') ? 'RETAKE_COMPLETED' : 'NOT_APPLICABLE';

  if (badge) {
    const state: JourneyState = badge.status === 'EARNED' ? 'PASSED' : badge.status === 'UNDER_REVIEW' ? 'BADGE_UNDER_REVIEW' : 'BADGE_NULLIFIED';
    return { ...base, state, retake: retakeBase, canBook: false };
  }
  if (activeBooking && activeAttempt) {
    const slot = db.slots.find(s => s.id === activeBooking.slotId);
    const ended = slot ? new Date(slot.endAt).getTime() < now : false;
    const state: JourneyState = ended ? 'AWAITING_RESULT' : activeAttempt.interviewStatus === 'IN_PROGRESS' ? 'IN_INTERVIEW' : 'BOOKED';
    return { ...base, state, retake: wasRetake ? 'RETAKE_BOOKED' : retakeBase, canBook: false };
  }
  // A system cancellation (interviewer unavailable) gives priority rebooking and does not count as an attempt.
  const lastCancelled = db.bookings.filter(b => b.studentId === studentId && b.badgeDefId === badgeDefId && b.status === 'CANCELLED')
    .sort((a, b) => (b.cancelledAt ?? '').localeCompare(a.cancelledAt ?? ''))[0];

  if (lastAttempt) {
    if (attemptsLeft === 0) return { ...base, state: 'ATTEMPTS_EXHAUSTED', retake: retakeBase, canBook: false };
    const cooldownDays = lastAttempt.attendance === 'STUDENT_NO_SHOW' ? p.studentNoShowCooldownDays
      : lastAttempt.outcome === 'RETAKE_LATER' ? p.retakeCooldownDays
      : lastAttempt.outcome === 'FAIL' ? p.failCooldownDays : 0;
    const finishedAt = new Date(lastAttempt.submittedAt ?? lastAttempt.createdAt).getTime();
    const until = finishedAt + cooldownDays * DAY;
    const cooling = until > now;
    const nextBookableAt = new Date(until).toISOString();
    if (lastAttempt.attendance === 'INTERVIEWER_NO_SHOW') {
      return { ...base, state: 'PRIORITY_REBOOK', retake: retakeBase, canBook: eligibility.eligible };
    }
    if (lastAttempt.attendance === 'STUDENT_NO_SHOW') return { ...base, state: cooling ? 'NO_SHOW_COOLDOWN' : 'ELIGIBLE', retake: retakeBase, canBook: !cooling && eligibility.eligible, nextBookableAt };
    if (lastAttempt.outcome === 'RETAKE_LATER') return { ...base, state: cooling ? 'RETAKE_COOLDOWN' : 'RETAKE_ELIGIBLE', retake: cooling ? 'RETAKE_RECOMMENDED' : 'RETAKE_ELIGIBLE', canBook: !cooling && eligibility.eligible, nextBookableAt };
    if (lastAttempt.outcome === 'FAIL') return { ...base, state: cooling ? 'FAIL_COOLDOWN' : 'FAIL_REBOOKABLE', retake: retakeBase, canBook: !cooling && eligibility.eligible, nextBookableAt };
  }
  if (lastCancelled?.priorityRebook && eligibility.eligible) return { ...base, state: 'PRIORITY_REBOOK', retake: retakeBase, canBook: true };
  if (!eligibility.eligible) return { ...base, state: 'NOT_ELIGIBLE', retake: retakeBase, canBook: false };
  return { ...base, state: 'ELIGIBLE', retake: retakeBase, canBook: true };
}

/** The badge a student is currently working towards: first level in their track not yet held. */
export function currentBadgeDefId(db: DB, studentId: ID): ID {
  const trackId = studentTrackId(db, studentId);
  const defs = db.badgeDefs.filter(b => b.trackId === trackId).sort((a, b) => a.order - b.order);
  for (const d of defs) {
    const sb = db.studentBadges.find(b => b.studentId === studentId && b.badgeDefId === d.id);
    if (!sb || sb.status !== 'EARNED') return d.id;
  }
  return defs[defs.length - 1].id;
}

export function studentTrackId(db: DB, studentId: ID): ID {
  // A student's track = track of the skills they've engaged with (prototype: one track per student).
  const p = db.skillProgress.find(x => x.studentId === studentId);
  const skill = p && db.skills.find(s => s.id === p.skillId);
  return skill?.trackId ?? db.tracks[0].id;
}

export const JOURNEY_LABEL: Record<JourneyState, string> = {
  NOT_ELIGIBLE: 'Not eligible yet', ELIGIBLE: 'Eligible · not booked', PRIORITY_REBOOK: 'Rebook (priority)',
  BOOKED: 'Interview booked', IN_INTERVIEW: 'Interview in progress', AWAITING_RESULT: 'Awaiting result',
  RETAKE_COOLDOWN: 'Retake recommended', RETAKE_ELIGIBLE: 'Retake available', FAIL_COOLDOWN: 'Not cleared',
  FAIL_REBOOKABLE: 'Can re-attempt', NO_SHOW_COOLDOWN: 'Missed interview', ATTEMPTS_EXHAUSTED: 'Attempts used up',
  PASSED: 'Badge earned', BADGE_UNDER_REVIEW: 'Badge under review', BADGE_NULLIFIED: 'Badge nullified',
};
