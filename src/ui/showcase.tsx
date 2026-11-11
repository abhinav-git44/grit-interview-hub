import React, { useEffect, useMemo, useRef, useState } from 'react';
import { LuMessageSquareText, LuMoveRight } from 'react-icons/lu';
import { clock, DomainError } from '../domain/core';
import { dayKey, fmtDate, fmtTime } from '../domain/format';
import { MESSAGES } from '../domain/messages';
import { createSeed } from '../domain/seed';
import * as S from '../domain/services';
import type { DB, ID } from '../domain/types';
import { AdminMalpractice, AdminOverview } from './admin';
import { InterviewerSchedule } from './interviewer';
import { AppCtx, Card, CardHeader, MessageBody, PageHeader, Pill, Tabs, cx, useApp } from './kit';
import { StudentBadges, StudentHome, StudentInterviews } from './student';

/**
 * Before/after screens. Each "after" is produced by running the REAL service calls on a copy of a
 * pristine seed — so what you see is exactly what the app does, without touching your sandbox data.
 */
type Step = (db: DB) => void;
interface Scenario { id: string; group: string; title: string; who: string; userId: ID; render: (db: DB) => React.ReactNode; states: { label: string; steps: Step[] }[]; note: string }

const run = (base: DB, steps: Step[]): { db: DB; error?: string } => {
  const db = structuredClone(base);
  try { steps.forEach(s => s(db)); return { db }; } catch (e) { clock.set(null); return { db, error: e instanceof DomainError ? e.message : String(e) }; }
};
const attemptOf = (db: DB, first: string) => db.attempts.find(a => a.interviewStatus === 'SCHEDULED' && db.users.find(u => u.id === db.students.find(s => s.id === a.studentId)?.userId)?.fullName.startsWith(first))!;
const slotStart = (db: DB, attId: ID) => { const a = db.attempts.find(x => x.id === attId)!; const b = db.bookings.find(x => x.id === a.bookingId)!; return new Date(db.slots.find(s => s.id === b.slotId)!.startAt); };
const conduct = (first: string, outcome: 'PASS' | 'FAIL' | 'RETAKE_LATER'): Step => db => {
  const a = attemptOf(db, first); clock.set(new Date(slotStart(db, a.id).getTime() + 60_000));
  try {
    S.startInterview(db, `u_${a.interviewerId}`, a.id);
    S.submitOutcome(db, `u_${a.interviewerId}`, a.id, { outcome, scores: { technical: outcome === 'PASS' ? 4 : 3, communication: 4, problemSolving: outcome === 'FAIL' ? 2 : 3 }, feedback: outcome === 'PASS' ? 'Clear, structured answers and a strong live demo.' : outcome === 'RETAKE_LATER' ? 'Good product instincts. Strengthen evaluation metrics (precision/recall trade-offs) and retry.' : 'Could not complete the prompt-design task; revisit fundamentals before the next attempt.' });
  } finally { clock.set(null); }
};
const firstSlotAfter = (db: DB, studentId: ID, iv?: ID) => S.bookableSlots(db, studentId).find(s => new Date(s.startAt).getTime() > Date.now() + 20 * 3_600_000 && (!iv || s.interviewerId === iv))!;
const bookAarav = (iv?: ID): Step => db => { const s = firstSlotAfter(db, 'st_01', iv); S.bookSlot(db, 'u_st_01', { studentId: 'st_01', badgeDefId: 'bd_prod_nov', slotId: s.id }); };
const badgeOf = (db: DB, first: string) => db.studentBadges.find(b => db.users.find(u => u.id === db.students.find(s => s.id === b.studentId)?.userId)?.fullName.startsWith(first))!;

function scenarios(base: DB): Scenario[] {
  const meeraDay = dayKey(firstSlotAfter(base, 'st_01', 'iv_meera').startAt);
  return [
    { id: 'home-booking', group: 'Student home', title: 'Before interview → after booking', who: 'Aarav Sharma', userId: 'u_st_01', render: () => <StudentHome />,
      states: [{ label: 'Before: eligible, not booked', steps: [] }, { label: 'After: booked', steps: [bookAarav()] }], note: 'The eligibility message (Message 1) is replaced by the confirmed interview details, with reschedule/cancel available until the cutoff.' },
    { id: 'home-pass', group: 'Student home', title: 'Booked → Pass', who: 'Riya Patel', userId: 'u_st_02', render: () => <StudentHome />,
      states: [{ label: 'Before: interview booked', steps: [] }, { label: 'After: Pass', steps: [conduct('Riya', 'PASS')] }], note: 'The pass result (Message 3) replaces the booking card; the badge path shows the Novice badge earned and the Master level next.' },
    { id: 'home-retake', group: 'Student home', title: 'Booked → Retake later', who: 'Riya Patel', userId: 'u_st_02', render: () => <StudentHome />,
      states: [{ label: 'Before: interview booked', steps: [] }, { label: 'After: Retake later', steps: [conduct('Riya', 'RETAKE_LATER')] }], note: 'Framed as “not yet”, with the interviewer’s feedback, scores and the exact date booking reopens.' },
    { id: 'home-fail', group: 'Student home', title: 'Booked → Fail', who: 'Riya Patel', userId: 'u_st_02', render: () => <StudentHome />,
      states: [{ label: 'Before: interview booked', steps: [] }, { label: 'After: Fail', steps: [conduct('Riya', 'FAIL')] }], note: 'Shows feedback, attempts left and when the next attempt opens (longer cooldown than a retake).' },
    { id: 'home-malpractice', group: 'Student home', title: 'Badge earned → under review → nullified', who: 'Ananya Reddy', userId: 'u_st_04', render: () => <StudentHome />,
      states: [
        { label: 'Before: badge earned', steps: [] },
        { label: 'After flag: under review', steps: [db => { S.flagMalpractice(db, 'u_admin2', badgeOf(db, 'Ananya').id, 'Similarity alert on interview answers.', 'SA-9001'); }] },
        { label: 'After decision: nullified', steps: [db => { const c = S.flagMalpractice(db, 'u_admin2', badgeOf(db, 'Ananya').id, 'Similarity alert on interview answers.', 'SA-9001'); S.startInvestigation(db, 'u_admin1', c, ''); S.decideCase(db, 'u_admin1', c, 'CONFIRMED', 'Recording shows an external person answering.'); }] },
      ], note: 'Review and confirmed nullification are visibly different. Evidence is never shown to the student.' },
    { id: 'badges', group: 'Other screens', title: 'Badge page before and after passing', who: 'Riya Patel', userId: 'u_st_02', render: () => <StudentBadges />,
      states: [{ label: 'Before', steps: [] }, { label: 'After: Pass', steps: [conduct('Riya', 'PASS')] }], note: 'The Novice badge unlocks with its history; Master shows what is required next.' },
    { id: 'history', group: 'Other screens', title: 'Interview history before and after a retake booking', who: 'Ishita Rao', userId: 'u_st_06', render: () => <StudentInterviews />,
      states: [{ label: 'Before', steps: [] }, { label: 'After: attempt 2 booked', steps: [db => { const s = S.bookableSlots(db, 'st_06')[2]; S.bookSlot(db, 'u_st_06', { studentId: 'st_06', badgeDefId: 'bd_sys_nov', slotId: s.id }); }] }], note: 'A retake is a new attempt record. Attempt 1 and its feedback stay exactly as they were.' },
    { id: 'schedule', group: 'Other screens', title: 'Interviewer schedule before and after a booking', who: 'Meera Iyer', userId: 'u_iv_meera', render: () => <InterviewerSchedule initialDay={meeraDay} />,
      states: [{ label: 'Before', steps: [] }, { label: 'After: Aarav books Meera', steps: [bookAarav('iv_meera')] }], note: `Meera's day (${fmtDate(`${meeraDay}T06:30:00Z`)}) before and after a student books one of her slots.` },
    { id: 'admin', group: 'Other screens', title: 'Admin dashboard before and after interviews', who: 'Priya Menon', userId: 'u_admin1', render: () => <AdminOverview />,
      states: [{ label: 'Before', steps: [] }, { label: 'After: 2 interviews + 1 booking', steps: [conduct('Riya', 'PASS'), conduct('Kabir', 'RETAKE_LATER'), bookAarav()] }], note: 'KPIs, the not-booked list, outcomes and the funnel all move with the underlying data.' },
    { id: 'case', group: 'Other screens', title: 'Malpractice case before and after a decision', who: 'Priya Menon', userId: 'u_admin1', render: (db) => <AdminMalpractice caseId={db.malpracticeCases.find(c => c.status === 'UNDER_INVESTIGATION' || (c.status === 'CONFIRMED' && c.studentId === 'st_10'))?.id} />,
      states: [{ label: 'Before: investigating', steps: [] }, { label: 'After: confirmed', steps: [db => { const c = db.malpracticeCases.find(x => x.status === 'UNDER_INVESTIGATION')!; S.decideCase(db, 'u_admin1', c.id, 'CONFIRMED', 'Recording confirms off-screen assistance during the interview.'); }] }],
      note: 'The decision, reason, reviewer and badge history are recorded; a second open flag on the same badge is shown in the case count.' },
  ];
}

const DESIGN_W = 1120;
function Frame({ db, userId, children, label, error }: { db: DB; userId: ID; children: React.ReactNode; label: string; error?: string }) {
  const parent = useApp();
  const me = db.users.find(u => u.id === userId)!;
  const ctx = { ...parent, db, me, readOnly: true, nav: () => {}, act: () => undefined };
  const ref = useRef<HTMLDivElement>(null); const [w, setW] = useState(600);
  useEffect(() => { const el = ref.current; if (!el) return; const ro = new ResizeObserver(([e]) => setW(e.contentRect.width)); ro.observe(el); return () => ro.disconnect(); }, []);
  return (
    <div className="min-w-0 flex-1">
      <div className="mb-2 flex items-center gap-2"><Pill tone={label.startsWith('Before') ? 'gray' : 'navy'}>{label}</Pill></div>
      <div ref={ref} className="overflow-hidden rounded-xl border-2 border-dashed border-slate-300 bg-lionsmane">
        {error ? <p className="p-4 text-[13px] text-red-700">Could not build this state: {error}</p> : (
          <div style={{ width: DESIGN_W, zoom: Math.min(1, w / DESIGN_W) } as React.CSSProperties} className="p-6"><AppCtx.Provider value={ctx}>{children}</AppCtx.Provider></div>
        )}
      </div>
    </div>
  );
}

export function Showcase() {
  const base = useMemo(() => createSeed(), []);
  const list = useMemo(() => scenarios(base), [base]);
  const [id, setId] = useState(list[0].id);
  const [tab, setTab] = useState('screens');
  const sc = list.find(s => s.id === id)!;
  const built = useMemo(() => sc.states.map(st => ({ label: st.label, ...run(base, st.steps) })), [sc, base]);
  const groups = [...new Set(list.map(s => s.group))];
  const sample = new Date(base.slots.find(s => s.status === 'OPEN' && new Date(s.startAt).getTime() > Date.now() + 86_400_000)!.startAt).toISOString();
  return (
    <div data-testid="showcase">
      <PageHeader title="Before & after" subtitle="Every “after” is generated by running the real booking, interview and review logic on a fresh copy of the sample data. Your own sandbox is not affected." right={<Tabs value={tab} onChange={setTab} items={[['screens', 'Screens'], ['messages', 'The 3 student messages']]} />} />
      {tab === 'messages' ? (
        <div className="grid gap-5 lg:grid-cols-3">
          {([['1 · Eligibility', MESSAGES.eligible()], ['2 · Booking confirmation', MESSAGES.bookingConfirmed({ date: fmtDate(sample), time: `${fmtTime(sample)} IST`, interviewer: 'Meera Iyer' })], ['3 · Pass result', MESSAGES.pass()]] as const).map(([k, m]) => (
            <Card key={k} data-testid="exact-message"><CardHeader title={k} subtitle="Rendered exactly as students see it" right={<LuMessageSquareText size={16} className="text-slate-400" />} />
              <div className="px-5 py-4"><div className="text-[15px] font-bold text-slate-900">{m.title}</div><div className="mt-2"><MessageBody body={m.body} /></div>{m.cta && <div className="mt-4 inline-flex h-9 items-center rounded-lg bg-navy-900 px-3.5 text-[13px] font-semibold text-white">{m.cta.label}</div>}</div></Card>
          ))}
          <p className="text-[12.5px] text-slate-500 lg:col-span-3">Contextual messages also exist for Retake later, Fail, No-show, Cancellation, Rescheduling, Interviewer unavailable, Badge under review, Badge reinstated and Badge nullified — open any student's notifications to see them in context.</p>
        </div>
      ) : (
        <div>
          <Card className="mb-4 p-3">{groups.map(g => (
            <div key={g} className="mb-1 flex flex-wrap items-center gap-1.5"><span className="w-28 shrink-0 px-1 text-[11px] font-bold uppercase tracking-wider text-slate-400">{g}</span>
              {list.filter(s => s.group === g).map(s => (
                <button key={s.id} onClick={() => setId(s.id)} data-testid={`scenario-${s.id}`} className={cx('rounded-lg px-3 py-1.5 text-left text-[12.5px] font-semibold', s.id === id ? 'bg-navy-900 text-white' : 'bg-slate-100 text-slate-700 hover:bg-slate-200')}>{s.title}<span className={cx('ml-1.5 font-normal', s.id === id ? 'text-slate-300' : 'text-slate-500')}>· {s.who}</span></button>
              ))}</div>
          ))}</Card>
          <Card className="mb-4 px-5 py-3.5"><div className="flex flex-wrap items-center gap-2 text-sm font-semibold text-slate-900">{sc.states.map((s, i) => <React.Fragment key={s.label}>{i > 0 && <LuMoveRight className="text-slate-400" />}<span>{s.label}</span></React.Fragment>)}</div><p className="mt-1 text-[13px] text-slate-600">{sc.note}</p></Card>
          <div className="space-y-6">
            {built.map(b => <Frame key={b.label} db={b.db} userId={sc.userId} label={b.label} error={b.error}>{sc.render(b.db)}</Frame>)}
          </div>
        </div>
      )}
    </div>
  );
}

