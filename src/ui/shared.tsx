import React from 'react';
import { JOURNEY_LABEL, type JourneyState } from '../domain/eligibility';
import type { AttendanceStatus, BadgeStatus, BookingStatus, CaseStatus, DB, ID, InterviewAttempt, InterviewStatus, Outcome } from '../domain/types';
import { Pill, type Tone } from './kit';

export const JOURNEY_TONE: Record<JourneyState, Tone> = {
  NOT_ELIGIBLE: 'gray', ELIGIBLE: 'blue', PRIORITY_REBOOK: 'amber', BOOKED: 'teal', IN_INTERVIEW: 'teal', AWAITING_RESULT: 'amber',
  RETAKE_COOLDOWN: 'amber', RETAKE_ELIGIBLE: 'blue', FAIL_COOLDOWN: 'red', FAIL_REBOOKABLE: 'blue', NO_SHOW_COOLDOWN: 'red',
  ATTEMPTS_EXHAUSTED: 'red', PASSED: 'green', BADGE_UNDER_REVIEW: 'amber', BADGE_NULLIFIED: 'red',
};
export const JourneyPill = ({ s }: { s: JourneyState }) => <Pill tone={JOURNEY_TONE[s]} dot>{JOURNEY_LABEL[s]}</Pill>;

const OUT: Record<Outcome, [string, Tone]> = { PENDING: ['Pending', 'gray'], PASS: ['Pass', 'green'], FAIL: ['Fail', 'red'], RETAKE_LATER: ['Retake later', 'amber'] };
export const OutcomePill = ({ o }: { o: Outcome }) => <Pill tone={OUT[o][1]}>{OUT[o][0]}</Pill>;
const ATT: Record<AttendanceStatus, [string, Tone]> = { PENDING: ['Pending', 'gray'], PRESENT: ['Present', 'teal'], STUDENT_NO_SHOW: ['Student no-show', 'red'], INTERVIEWER_NO_SHOW: ['Interviewer no-show', 'amber'] };
export const AttendancePill = ({ a }: { a: AttendanceStatus }) => <Pill tone={ATT[a][1]}>{ATT[a][0]}</Pill>;
const IS: Record<InterviewStatus, [string, Tone]> = { SCHEDULED: ['Scheduled', 'blue'], IN_PROGRESS: ['In progress', 'teal'], COMPLETED: ['Completed', 'gray'], CANCELLED: ['Cancelled', 'gray'] };
export const InterviewPill = ({ s }: { s: InterviewStatus }) => <Pill tone={IS[s][1]}>{IS[s][0]}</Pill>;
const BS: Record<BookingStatus, [string, Tone]> = { BOOKED: ['Booked', 'teal'], RESCHEDULED: ['Rescheduled', 'gray'], CANCELLED: ['Cancelled', 'red'], COMPLETED: ['Completed', 'gray'] };
export const BookingPill = ({ s }: { s: BookingStatus }) => <Pill tone={BS[s][1]}>{BS[s][0]}</Pill>;
const BG: Record<BadgeStatus, [string, Tone]> = { EARNED: ['Earned', 'green'], UNDER_REVIEW: ['Under review', 'amber'], NULLIFIED: ['Nullified', 'red'] };
export const BadgePill = ({ s }: { s: BadgeStatus }) => <Pill tone={BG[s][1]} dot>{BG[s][0]}</Pill>;
const CS: Record<CaseStatus, [string, Tone]> = { FLAGGED: ['Flagged', 'amber'], UNDER_INVESTIGATION: ['Investigating', 'blue'], CONFIRMED: ['Confirmed', 'red'], DISMISSED: ['Dismissed', 'gray'] };
export const CasePill = ({ s }: { s: CaseStatus }) => <Pill tone={CS[s][1]} dot>{CS[s][0]}</Pill>;

export const slotOfAttempt = (db: DB, a: InterviewAttempt) => {
  const b = db.bookings.find(x => x.id === a.bookingId); return b ? db.slots.find(s => s.id === b.slotId) : undefined;
};
export const userOfStudent = (db: DB, studentId: ID) => db.users.find(u => u.id === db.students.find(s => s.id === studentId)?.userId);

export function BadgeMedal({ level, status, size = 44 }: { level: string; status?: BadgeStatus | 'LOCKED' | 'IN_PROGRESS'; size?: number }) {
  const muted = status === 'LOCKED' || status === 'IN_PROGRESS';
  const nullified = status === 'NULLIFIED';
  const fill = nullified ? '#fee2e2' : muted ? '#f1f5f9' : level === 'Master' ? '#013D5A' : '#708C69';  // Midnight / Herb
  const ring = nullified ? '#dc2626' : muted ? '#cbd5e1' : level === 'Master' ? '#F4A258' : '#BDD3CE';  // Marigold / Celeste
  return (
    <svg width={size} height={size} viewBox="0 0 48 48" aria-hidden>
      <path d="M24 3l17 9.5v19L24 41 7 31.5v-19z" fill={fill} stroke={ring} strokeWidth="2.5" strokeLinejoin="round" />
      <text x="24" y="27.5" textAnchor="middle" fontSize="13" fontWeight="800" fill={muted ? '#94a3b8' : nullified ? '#b91c1c' : '#fff'} fontFamily="inherit">{level === 'Master' ? 'M' : 'N'}</text>
      {nullified && <line x1="11" y1="37" x2="37" y2="9" stroke="#dc2626" strokeWidth="3" strokeLinecap="round" />}
    </svg>
  );
}

export function Scores({ a }: { a: InterviewAttempt }) {
  if (!a.scores) return null;
  const rows: [string, number][] = [['Technical', a.scores.technical], ['Communication', a.scores.communication], ['Problem-solving', a.scores.problemSolving]];
  return (
    <div className="grid grid-cols-3 gap-2">
      {rows.map(([l, v]) => (
        <div key={l} className="rounded-lg bg-slate-50 px-3 py-2">
          <div className="text-[11px] font-medium text-slate-500">{l}</div>
          <div className="mt-1 flex gap-1" aria-label={`${l} ${v} of 5`}>{[1, 2, 3, 4, 5].map(i => <span key={i} className={`h-1.5 flex-1 rounded-full ${i <= v ? 'bg-indigo-600' : 'bg-slate-200'}`} />)}</div>
          <div className="mt-1 text-[12px] font-semibold tabular-nums text-slate-800">{v}/5</div>
        </div>
      ))}
    </div>
  );
}
