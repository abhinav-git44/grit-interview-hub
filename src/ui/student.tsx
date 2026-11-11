import React, { useMemo, useState } from 'react';
import { LuCalendarCheck, LuCalendarClock, LuCheck, LuCircleAlert, LuClock, LuLock, LuPartyPopper, LuShieldAlert, LuShieldX, LuSparkles, LuUser, LuVideo, LuRotateCcw, LuArrowRight, LuArrowLeft, LuFlaskConical } from 'react-icons/lu';
import { badgeLabel, clock, DAY, HOUR, interviewerName, studentByUser } from '../domain/core';
import { currentBadgeDefId, deriveJourney, studentTrackId, type Journey } from '../domain/eligibility';
import { addDaysKey, dayKey, fmtDate, fmtDateShort, fmtDateTime, fmtTime, tzLabel } from '../domain/format';
import { MESSAGES } from '../domain/messages';
import * as S from '../domain/services';
import type { DB, ID, Student } from '../domain/types';
import { Button, Callout, Card, CardHeader, Empty, Field, MessageBody, Modal, PageHeader, Pill, cx, inputCls, useApp } from './kit';
import { AttendancePill, BadgeMedal, BadgePill, BookingPill, JourneyPill, OutcomePill, Scores, slotOfAttempt } from './shared';

export function useStudent(): { db: DB; student: Student } {
  const { db, me } = useApp();
  return { db, student: studentByUser(db, me.id)! };
}

// ═══════════════════════════════════════════════════════════
// HOME
// ═══════════════════════════════════════════════════════════
export function StudentHome() {
  const { db, student } = useStudent(); const { me, nav } = useApp();
  const bd = currentBadgeDefId(db, student.id);
  const j = deriveJourney(db, student.id, bd);
  const recentPass = db.attempts.filter(a => a.studentId === student.id && a.outcome === 'PASS' && a.submittedAt && clock.now().getTime() - new Date(a.submittedAt).getTime() < 7 * DAY)
    .sort((a, b) => b.submittedAt!.localeCompare(a.submittedAt!))[0];
  const passBadge = recentPass && db.studentBadges.find(b => b.attemptId === recentPass.id && b.status === 'EARNED');
  const track = db.tracks.find(t => t.id === studentTrackId(db, student.id))!;
  const notes = db.notifications.filter(n => n.userId === me.id).sort((a, b) => b.createdAt.localeCompare(a.createdAt)).slice(0, 3);

  return (
    <div data-testid="student-home">
      <PageHeader title={`Hi ${me.fullName.split(' ')[0]}`} subtitle={<>{track.name} · {student.studentCode} · {student.campus}</>} right={<JourneyPill s={j.state} />} />
      {passBadge && j.badgeDef.id !== recentPass.badgeDefId && <div className="mb-5"><PassBanner badgeDefId={recentPass.badgeDefId} /></div>}
      <div className="grid grid-cols-1 gap-5 [&>*]:min-w-0 lg:grid-cols-[minmax(0,1fr)_340px]">
        <div className="space-y-5">
          <JourneyCard j={j} />
          <SkillsCard j={j} />
          <AttemptsCard j={j} />
        </div>
        <div className="space-y-5">
          <BadgePathCard />
          <Card>
            <CardHeader title="Notifications" right={<Button size="sm" variant="ghost" onClick={() => nav({ name: 'notifications' })}>View all</Button>} />
            {notes.length === 0 ? <Empty title="No notifications yet" /> : (
              <ul className="divide-y divide-slate-100">{notes.map(n => (
                <li key={n.id} className="px-5 py-3"><div className="flex items-center gap-2">{!n.isRead && <span className="h-2 w-2 rounded-full bg-indigo-600" />}<span className="text-[13px] font-semibold text-slate-900">{n.title}</span></div><div className="mt-0.5 text-[12px] text-slate-500">{fmtDateTime(n.createdAt)}</div></li>
              ))}</ul>
            )}
          </Card>
        </div>
      </div>
    </div>
  );
}

function PassBanner({ badgeDefId }: { badgeDefId: ID }) {
  const { nav } = useApp(); const m = MESSAGES.pass(); const { db } = useStudent();
  return (
    <div className="flex items-start gap-4 rounded-xl border border-emerald-200 bg-gradient-to-r from-emerald-50 to-white p-5" data-testid="pass-banner">
      <BadgeMedal level={db.badgeDefs.find(b => b.id === badgeDefId)!.level} status="EARNED" size={52} />
      <div className="flex-1"><div className="flex items-center gap-2 text-base font-bold text-emerald-900"><LuPartyPopper size={18} />{m.title}</div><div className="mt-1 text-[13px] font-semibold text-emerald-800">{badgeLabel(db, badgeDefId)}</div><div className="mt-2"><MessageBody body={m.body} /></div>
        <div className="mt-3"><Button variant="teal" size="sm" onClick={() => nav({ name: 'student-badges' })}>{m.cta!.label}</Button></div></div>
    </div>
  );
}

function JourneyCard({ j }: { j: Journey }) {
  const { db, student } = useStudent(); const { nav, act } = useApp();
  const [cancelOpen, setCancelOpen] = useState(false);
  const badge = badgeLabel(db, j.badgeDef.id);
  const head = (icon: React.ReactNode, eyebrow: string) => (
    <div className="mb-3 flex items-center gap-2 text-[12px] font-semibold uppercase tracking-wide text-slate-500">{icon}{eyebrow}<span className="text-slate-300">·</span><span className="normal-case tracking-normal text-slate-600">{badge}</span></div>
  );
  const wrap = (tone: string, children: React.ReactNode) => <Card className={cx('p-6', tone)} data-testid="journey-card" data-state={j.state}>{children}</Card>;
  const fb = j.lastAttempt?.feedback;
  const nextOn = j.nextBookableAt ? fmtDate(j.nextBookableAt, student.timezone) : '';

  switch (j.state) {
    case 'NOT_ELIGIBLE': {
      const missing = j.eligibility.required.filter(r => !r.cleared);
      return wrap('', <>
        {head(<LuLock size={14} />, 'Interview locked')}
        <h2 className="text-lg font-bold text-slate-900">{j.eligibility.missingPrereqBadge ? `Earn ${j.eligibility.missingPrereqBadge} first` : `Clear ${missing.length} more skill${missing.length === 1 ? '' : 's'} to unlock your interview`}</h2>
        <p className="mt-1.5 text-[13.5px] text-slate-600">Your Track Badge interview opens automatically once every required skill is cleared in GRIT contests. No action needed from you — keep going.</p>
      </>);
    }
    case 'ELIGIBLE': case 'RETAKE_ELIGIBLE': case 'FAIL_REBOOKABLE': case 'PRIORITY_REBOOK': {
      const m = j.state === 'ELIGIBLE' ? MESSAGES.eligible()
        : j.state === 'PRIORITY_REBOOK' ? MESSAGES.interviewerUnavailable({ when: 'your interview' })
        : j.state === 'RETAKE_ELIGIBLE' ? { title: 'Your retake is open', body: `Your cooldown is over. Book attempt ${j.attemptsUsed + 1} of ${db.policies.maxAttemptsPerBadge} whenever you're ready.${fb ? `\n\nLast time your interviewer said: “${fb}”` : ''}` }
        : { title: 'You can try again', body: `Book attempt ${j.attemptsUsed + 1} of ${db.policies.maxAttemptsPerBadge} when you're ready.${fb ? `\n\nLast time your interviewer said: “${fb}”` : ''}` };
      return wrap('border-indigo-200 bg-gradient-to-br from-indigo-50/70 to-white', <>
        {head(<LuSparkles size={14} className="text-indigo-600" />, j.state === 'PRIORITY_REBOOK' ? 'Priority rebooking' : 'Ready to book')}
        <h2 className="text-xl font-bold text-slate-900" data-testid="journey-title">{m.title}</h2>
        <div className="mt-2"><MessageBody body={m.body} /></div>
        <div className="mt-5 flex flex-wrap items-center gap-3"><Button variant="primary" onClick={() => nav({ name: 'student-book' })} icon={<LuCalendarCheck size={16} />}>{j.state === 'ELIGIBLE' ? 'Book Your Interview' : 'Pick a slot'}</Button>
          <span className="text-[12px] text-slate-500">{S.bookableSlots(db, student.id).length} open slots in the next {db.policies.bookingHorizonDays} days</span></div>
      </>);
    }
    case 'BOOKED': case 'IN_INTERVIEW': {
      const b = j.activeBooking!; const slot = db.slots.find(s => s.id === b.slotId)!;
      const hoursLeft = (new Date(slot.startAt).getTime() - clock.now().getTime()) / HOUR;
      const canChange = hoursLeft >= db.policies.cancelRescheduleCutoffHours;
      return wrap('border-teal-200 bg-gradient-to-br from-teal-50/70 to-white', <>
        {head(<LuCalendarCheck size={14} className="text-teal-700" />, j.state === 'IN_INTERVIEW' ? 'Happening now' : 'Upcoming interview')}
        <h2 className="text-xl font-bold text-slate-900" data-testid="journey-title">{j.state === 'IN_INTERVIEW' ? 'Your interview is in progress' : 'Your interview is confirmed!'}</h2>
        <dl className="mt-4 grid grid-cols-2 gap-x-6 gap-y-3 sm:grid-cols-4">
          {([['Date', fmtDate(slot.startAt, student.timezone)], ['Time', `${fmtTime(slot.startAt, student.timezone)} ${tzLabel(student.timezone)}`], ['Interviewer', interviewerName(db, slot.interviewerId)], ['Mode', `Online · ${db.policies.interviewDurationMin} min`]] as const).map(([k, v]) => (
            <div key={k}><dt className="text-[12px] font-medium text-slate-500">{k}</dt><dd className="mt-0.5 text-sm font-semibold text-slate-900">{v}</dd></div>
          ))}
        </dl>
        <div className="mt-4 flex items-center gap-2 rounded-lg border border-slate-200 bg-white px-3 py-2 text-[13px]"><LuVideo size={15} className="text-slate-500" /><span className="truncate text-slate-700">{b.meetingLink}</span><Pill tone="gray">Demo link</Pill></div>
        <p className="mt-3 text-[12.5px] text-slate-500">Please join using the interview link at your scheduled time. We recommend joining 5 minutes early. {j.attemptsUsed > 0 && `This is attempt ${j.attemptsUsed + 1}.`}</p>
        <div className="mt-4 flex flex-wrap items-center gap-2">
          <Button variant="secondary" size="sm" disabled={!canChange} onClick={() => nav({ name: 'student-book', id: b.id })} icon={<LuCalendarClock size={15} />}>Reschedule</Button>
          <Button variant="danger" size="sm" disabled={!canChange} onClick={() => setCancelOpen(true)}>Cancel</Button>
          <span className="text-[12px] text-slate-500">{canChange ? `Changes allowed until ${fmtDateTime(new Date(new Date(slot.startAt).getTime() - db.policies.cancelRescheduleCutoffHours * HOUR).toISOString(), student.timezone)}` : `Changes closed ${db.policies.cancelRescheduleCutoffHours}h before the interview. Contact the GRIT team for emergencies.`}</span>
        </div>
        <CancelModal open={cancelOpen} onClose={() => setCancelOpen(false)} onConfirm={reason => { act(d => S.cancelBooking(d, student.userId, b.id, reason), 'Interview cancelled. Your slot has been released.'); setCancelOpen(false); }} />
      </>);
    }
    case 'AWAITING_RESULT':
      return wrap('', <>{head(<LuClock size={14} />, 'Result pending')}<h2 className="text-lg font-bold text-slate-900" data-testid="journey-title">Your interview is done — your result is on its way</h2><p className="mt-1.5 text-[13.5px] text-slate-600">Interviewers record results within 24 hours. You'll get a notification the moment it's in.</p></>);
    case 'RETAKE_COOLDOWN': {
      const m = MESSAGES.retake({ badge, availableOn: nextOn, feedback: fb });
      return wrap('border-amber-200 bg-gradient-to-br from-amber-50/70 to-white', <>{head(<LuRotateCcw size={14} className="text-amber-700" />, 'Retake recommended')}
        <h2 className="text-xl font-bold text-slate-900" data-testid="journey-title">{m.title}</h2><div className="mt-2"><MessageBody body={m.body} /></div>
        {j.lastAttempt && <div className="mt-4"><Scores a={j.lastAttempt} /></div>}
        <div className="mt-4 flex items-center gap-2"><Button disabled icon={<LuLock size={14} />}>Booking opens {nextOn}</Button><span className="text-[12px] text-slate-500">Attempt {j.attemptsUsed} of {db.policies.maxAttemptsPerBadge} used</span></div></>);
    }
    case 'FAIL_COOLDOWN': case 'ATTEMPTS_EXHAUSTED': {
      const m = MESSAGES.fail({ badge, availableOn: nextOn, attemptsLeft: j.attemptsLeft });
      return wrap('border-red-200 bg-gradient-to-br from-red-50/60 to-white', <>{head(<LuCircleAlert size={14} className="text-red-700" />, j.state === 'ATTEMPTS_EXHAUSTED' ? 'No attempts left' : 'Not cleared')}
        <h2 className="text-xl font-bold text-slate-900" data-testid="journey-title">{m.title}</h2><div className="mt-2"><MessageBody body={m.body} /></div>
        {fb && <Callout tone="gray" title="Interviewer feedback"><span>“{fb}”</span></Callout>}
        {j.state === 'FAIL_COOLDOWN' && <div className="mt-4"><Button disabled icon={<LuLock size={14} />}>Booking opens {nextOn}</Button></div>}</>);
    }
    case 'NO_SHOW_COOLDOWN': {
      const m = MESSAGES.noShow({ badge, availableOn: nextOn });
      return wrap('border-red-200', <>{head(<LuCircleAlert size={14} className="text-red-700" />, 'Missed interview')}<h2 className="text-xl font-bold text-slate-900" data-testid="journey-title">{m.title}</h2><div className="mt-2"><MessageBody body={m.body} /></div><p className="mt-2 text-[12px] text-slate-500">A missed interview counts as an attempt ({j.attemptsUsed} of {db.policies.maxAttemptsPerBadge} used).</p></>);
    }
    case 'PASSED': {
      const m = MESSAGES.pass();
      return wrap('border-emerald-200 bg-gradient-to-br from-emerald-50/70 to-white', <>{head(<LuPartyPopper size={14} className="text-emerald-700" />, 'Badge earned')}
        <div className="flex items-start gap-4"><BadgeMedal level={j.badgeDef.level} status="EARNED" size={56} /><div><h2 className="text-xl font-bold text-slate-900" data-testid="journey-title">{m.title}</h2><div className="mt-2"><MessageBody body={m.body} /></div></div></div>
        <div className="mt-4 flex gap-2"><Button variant="teal" onClick={() => nav({ name: 'student-badges' })}>{m.cta!.label}</Button></div></>);
    }
    case 'BADGE_UNDER_REVIEW': {
      const m = MESSAGES.underReview({ badge });
      return wrap('border-amber-200 bg-amber-50/40', <>{head(<LuShieldAlert size={14} className="text-amber-700" />, 'Under review')}<div className="flex items-start gap-4"><BadgeMedal level={j.badgeDef.level} status="UNDER_REVIEW" size={52} /><div><h2 className="text-xl font-bold text-slate-900" data-testid="journey-title">{m.title}</h2><div className="mt-2"><MessageBody body={m.body} /></div></div></div></>);
    }
    case 'BADGE_NULLIFIED': {
      const m = MESSAGES.nullified({ badge });
      return wrap('border-red-200 bg-red-50/40', <>{head(<LuShieldX size={14} className="text-red-700" />, 'Decision')}<div className="flex items-start gap-4"><BadgeMedal level={j.badgeDef.level} status="NULLIFIED" size={52} /><div><h2 className="text-xl font-bold text-slate-900" data-testid="journey-title">{m.title}</h2><div className="mt-2"><MessageBody body={m.body} /></div></div></div></>);
    }
  }
}

function CancelModal({ open, onClose, onConfirm }: { open: boolean; onClose: () => void; onConfirm: (reason: string) => void }) {
  const [reason, setReason] = useState('');
  return (
    <Modal open={open} onClose={onClose} title="Cancel this interview?" footer={<><Button variant="secondary" onClick={onClose}>Keep it</Button><Button variant="danger" onClick={() => onConfirm(reason)}>Cancel interview</Button></>}>
      <p className="mb-3 text-[13px] text-slate-600">Your slot will be released for other students. Cancelling does not count as an attempt — you can book again any time.</p>
      <Field label="Reason (optional)"><input className={inputCls} value={reason} onChange={e => setReason(e.target.value)} placeholder="e.g. Exam clash" /></Field>
    </Modal>
  );
}

function SkillsCard({ j }: { j: Journey }) {
  const { db, student } = useStudent(); const { act, me } = useApp();
  const req = j.eligibility.required; const done = req.filter(r => r.cleared).length;
  const nextMissing = req.find(r => !r.cleared);
  return (
    <Card>
      <CardHeader title="Required skills" subtitle={`${done} of ${req.length} cleared for ${j.badgeDef.level}`} right={<Pill tone={j.eligibility.eligible ? 'green' : 'gray'}>{j.eligibility.eligible ? 'Eligible' : 'Not eligible yet'}</Pill>} />
      <div className="px-5 py-4">
        <div className="mb-4 h-2 overflow-hidden rounded-full bg-slate-100"><div className="h-full rounded-full bg-teal-600 transition-all" style={{ width: `${(done / Math.max(req.length, 1)) * 100}%` }} /></div>
        <ul className="grid gap-2 sm:grid-cols-2">
          {req.map(r => {
            const p = db.skillProgress.find(x => x.studentId === student.id && x.skillId === r.skillId);
            return (
              <li key={r.skillId} className="flex items-center gap-3 rounded-lg border border-slate-200 px-3 py-2.5">
                <span className={cx('flex h-6 w-6 items-center justify-center rounded-full', r.cleared ? 'bg-teal-600 text-white' : 'bg-slate-100 text-slate-400')}>{r.cleared ? <LuCheck size={14} /> : <LuLock size={12} />}</span>
                <div className="min-w-0"><div className="truncate text-[13px] font-semibold text-slate-800">{r.name}</div><div className="text-[12px] text-slate-500">{r.cleared ? `Cleared ${p?.clearedAt ? fmtDateShort(p.clearedAt) : ''}` : p?.status === 'IN_PROGRESS' ? 'In progress' : 'Not started'}</div></div>
              </li>
            );
          })}
        </ul>
        {nextMissing && !j.eligibility.missingPrereqBadge && (
          <div className="mt-4 flex flex-wrap items-center justify-between gap-2 rounded-lg border border-dashed border-indigo-300 bg-indigo-50/50 px-3 py-2.5">
            <span className="flex items-center gap-2 text-[12.5px] text-indigo-900"><LuFlaskConical size={15} /> Demo only: results normally arrive from the contest system.</span>
            <Button size="sm" variant="secondary" data-testid="simulate-clear" onClick={() => act(d => S.recordSkillCleared(d, S.SYSTEM_ACTOR, student.id, nextMissing.skillId), `Contest result received: ${nextMissing.name} cleared`)}>Simulate contest result: “{nextMissing.name}”</Button>
          </div>
        )}
      </div>
    </Card>
  );
}

function AttemptsCard({ j }: { j: Journey }) {
  const { db } = useStudent(); const { nav } = useApp();
  const rows = j.attempts.filter(a => a.interviewStatus !== 'CANCELLED');
  if (!rows.length) return null;
  return (
    <Card>
      <CardHeader title="Attempt history" subtitle={`${j.attemptsUsed} of ${db.policies.maxAttemptsPerBadge} attempts used`} right={<Button size="sm" variant="ghost" onClick={() => nav({ name: 'student-interviews' })}>Details</Button>} />
      <ul className="divide-y divide-slate-100">{rows.map(a => { const s = slotOfAttempt(db, a); return (
        <li key={a.id} className="flex flex-wrap items-center gap-3 px-5 py-3 text-[13px]"><span className="w-20 font-semibold text-slate-800">Attempt {a.attemptNumber}</span><span className="text-slate-500">{s ? fmtDateTime(s.startAt) : ''}</span><span className="text-slate-500">· {interviewerName(db, a.interviewerId)}</span><span className="ml-auto flex gap-1.5">{a.attendance !== 'PRESENT' && a.attendance !== 'PENDING' ? <AttendancePill a={a.attendance} /> : <OutcomePill o={a.outcome} />}</span></li>
      ); })}</ul>
    </Card>
  );
}

function BadgePathCard() {
  const { db, student } = useStudent(); const { nav } = useApp();
  const trackId = studentTrackId(db, student.id);
  const defs = db.badgeDefs.filter(b => b.trackId === trackId).sort((a, b) => a.order - b.order);
  return (
    <Card>
      <CardHeader title="Badge path" right={<Button size="sm" variant="ghost" onClick={() => nav({ name: 'student-badges' })}>All badges</Button>} />
      <ol className="space-y-3 px-5 py-4">{defs.map(d => {
        const sb = db.studentBadges.find(b => b.studentId === student.id && b.badgeDefId === d.id);
        const j = deriveJourney(db, student.id, d.id);
        return (
          <li key={d.id} className="flex items-center gap-3"><BadgeMedal level={d.level} status={sb?.status ?? (j.eligibility.eligible ? 'IN_PROGRESS' : 'LOCKED')} size={38} />
            <div className="min-w-0 flex-1"><div className="text-[13px] font-semibold text-slate-900">{d.level}</div><div className="text-[12px] text-slate-500">{sb ? `Earned ${fmtDateShort(sb.earnedAt)}` : j.eligibility.eligible ? 'Interview unlocked' : 'Locked'}</div></div>
            {sb ? <BadgePill s={sb.status} /> : <JourneyPill s={j.state} />}
          </li>
        );
      })}</ol>
    </Card>
  );
}

// ═══════════════════════════════════════════════════════════
// BOOKING FLOW
// ═══════════════════════════════════════════════════════════
export function StudentBook({ rescheduleId }: { rescheduleId?: ID }) {
  const { db, student } = useStudent(); const { act, nav, me } = useApp();
  const bd = currentBadgeDefId(db, student.id);
  const j = deriveJourney(db, student.id, bd);
  const resched = rescheduleId ? db.bookings.find(b => b.id === rescheduleId && b.status === 'BOOKED') : undefined;
  const slots = useMemo(() => S.bookableSlots(db, student.id), [db, student.id]);
  const byDay = useMemo(() => { const m = new Map<string, typeof slots>(); slots.forEach(s => { const k = dayKey(s.startAt, student.timezone); m.set(k, [...(m.get(k) ?? []), s]); }); return m; }, [slots, student.timezone]);
  const days = Array.from({ length: 14 }, (_, i) => addDaysKey(dayKey(clock.now()), i));
  const [day, setDay] = useState<string>(() => days.find(d => byDay.has(d)) ?? days[0]);
  const [slotId, setSlotId] = useState<ID | null>(null);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState<ID | null>(null);
  const [idemKey] = useState(() => `bk-${Math.random().toString(36).slice(2)}`);
  const slot = slotId ? db.slots.find(s => s.id === slotId) : undefined;
  const iv = slot && db.interviewers.find(i => i.id === slot.interviewerId);

  if (done) {
    const b = db.bookings.find(x => x.id === done)!; const s = db.slots.find(x => x.id === b.slotId)!;
    const m = MESSAGES.bookingConfirmed({ date: fmtDate(s.startAt, student.timezone), time: `${fmtTime(s.startAt, student.timezone)} ${tzLabel(student.timezone)}`, interviewer: interviewerName(db, s.interviewerId) });
    return (
      <div className="mx-auto max-w-xl" data-testid="booking-confirmation">
        <Card className="overflow-hidden">
          <div className="bg-teal-600 px-6 py-5 text-white"><LuCalendarCheck size={28} /><h1 className="mt-2 text-xl font-bold">{m.title}</h1></div>
          <div className="px-6 py-5"><MessageBody body={m.body} />
            <div className="mt-4 flex items-center gap-2 rounded-lg border border-slate-200 px-3 py-2 text-[13px]"><LuVideo size={15} className="text-slate-500" /><span className="truncate">{b.meetingLink}</span></div>
            <div className="mt-5 flex gap-2"><Button onClick={() => nav({ name: 'student-interviews' })}>{m.cta!.label}</Button><Button variant="secondary" onClick={() => nav({ name: 'student-home' })}>Back to home</Button></div></div>
        </Card>
      </div>
    );
  }

  const blocked = !resched && !j.canBook;
  const confirm = () => {
    if (!slotId || busy) return;
    setBusy(true);
    const r = act(d => resched ? S.rescheduleBooking(d, me.id, resched.id, slotId) : S.bookSlot(d, me.id, { studentId: student.id, badgeDefId: bd, slotId, idempotencyKey: idemKey }), resched ? 'Interview rescheduled' : 'Interview booked');
    setBusy(false);
    if (r) setDone(r.id); else setSlotId(null);
  };

  const steps = ['Eligibility', 'Date', 'Time', 'Confirm'];
  const step = blocked ? 0 : !slotId ? (day ? 2 : 1) : 3;
  return (
    <div data-testid="booking-page">
      <PageHeader title={resched ? 'Reschedule your interview' : 'Book your interview'} subtitle={badgeLabel(db, bd)} right={<Button variant="ghost" onClick={() => nav({ name: 'student-home' })} icon={<LuArrowLeft size={15} />}>Back</Button>} />
      <ol className="mb-6 flex flex-wrap gap-2">{steps.map((s, i) => (
        <li key={s} className={cx('flex items-center gap-2 rounded-full border px-3 py-1 text-[12.5px] font-semibold', i < step ? 'border-teal-200 bg-teal-50 text-teal-800' : i === step ? 'border-navy-900 bg-navy-900 text-white' : 'border-slate-200 bg-white text-slate-500')}>
          <span className="tabular-nums">{i < step ? <LuCheck size={13} /> : i + 1}</span>{s}</li>
      ))}</ol>
      {blocked ? (
        <Card className="p-6"><Callout tone="amber" icon={<LuLock size={18} className="text-amber-700" />} title="You can't book right now">
          {!j.eligibility.eligible ? 'Clear all required skills first — your interview unlocks automatically.' : j.activeBooking ? 'You already have an interview booked. You can reschedule it from your home page.' : j.state === 'ATTEMPTS_EXHAUSTED' ? 'You have used all attempts for this badge.' : j.nextBookableAt ? `Your next attempt opens on ${fmtDate(j.nextBookableAt)}.` : 'This interview is complete.'}
        </Callout><div className="mt-4"><Button variant="secondary" onClick={() => nav({ name: 'student-home' })}>Back to home</Button></div></Card>
      ) : (
        <div className="grid grid-cols-1 gap-5 [&>*]:min-w-0 lg:grid-cols-[minmax(0,1fr)_320px]">
          <Card>
            <CardHeader title="Choose a date and time" subtitle={`All times in ${tzLabel(student.timezone)} · ${db.policies.interviewDurationMin}-minute online interview`} />
            <div className="px-5 py-4">
              <div className="flex gap-2 overflow-x-auto pb-2" role="listbox" aria-label="Dates">{days.map(d => {
                const n = byDay.get(d)?.length ?? 0; const iso = `${d}T06:30:00Z`;
                return (
                  <button key={d} disabled={!n} onClick={() => { setDay(d); setSlotId(null); }} className={cx('flex w-[68px] shrink-0 flex-col items-center rounded-xl border px-2 py-2 text-center', d === day ? 'border-navy-900 bg-navy-900 text-white' : n ? 'border-slate-200 bg-white hover:border-slate-400' : 'border-slate-100 bg-slate-50 text-slate-300')}>
                    <span className="text-[11px] font-semibold uppercase">{new Intl.DateTimeFormat('en-IN', { weekday: 'short', timeZone: 'Asia/Kolkata' }).format(new Date(iso))}</span>
                    <span className="text-lg font-bold tabular-nums">{Number(d.slice(8))}</span>
                    <span className={cx('text-[10.5px]', d === day ? 'text-teal-200' : n ? 'text-teal-700' : '')}>{n ? `${n} slot${n > 1 ? 's' : ''}` : 'Full'}</span>
                  </button>
                );
              })}</div>
              <div className="mt-4">
                {(byDay.get(day) ?? []).length === 0 ? <Empty title="No slots on this day" body={slots.length ? 'Pick another date.' : 'All interview slots are taken right now. New slots are added every week — we will notify you.'} /> : (
                  <div className="grid grid-cols-2 gap-2 sm:grid-cols-4" role="listbox" aria-label="Times">{(byDay.get(day) ?? []).map(s => (
                    <button key={s.id} data-testid="slot" onClick={() => setSlotId(s.id)} className={cx('rounded-lg border px-3 py-2.5 text-left', slotId === s.id ? 'border-teal-600 bg-teal-50 ring-2 ring-teal-100' : 'border-slate-200 hover:border-slate-400')}>
                      <div className="text-sm font-bold tabular-nums text-slate-900">{fmtTime(s.startAt, student.timezone)}</div>
                      <div className="truncate text-[12px] text-slate-500">{interviewerName(db, s.interviewerId)}</div>
                    </button>
                  ))}</div>
                )}
              </div>
            </div>
          </Card>
          <Card className="h-fit">
            <CardHeader title="Summary" />
            <div className="space-y-3 px-5 py-4 text-[13px]">
              {resched && <Callout tone="gray" title="Current slot">{fmtDateTime(db.slots.find(s => s.id === resched.slotId)!.startAt)} — will be released when you confirm.</Callout>}
              {slot && iv ? (<>
                <div className="flex items-center gap-3"><div className="flex h-10 w-10 items-center justify-center rounded-full bg-indigo-100 text-indigo-700"><LuUser size={18} /></div><div><div className="font-semibold text-slate-900">{interviewerName(db, iv.id)}</div><div className="text-[12px] text-slate-500">{iv.specialization} interviewer</div></div></div>
                <div className="rounded-lg bg-slate-50 p-3"><div className="font-semibold text-slate-900">{fmtDate(slot.startAt, student.timezone)}</div><div className="text-slate-600">{fmtTime(slot.startAt, student.timezone)} – {fmtTime(slot.endAt, student.timezone)} {tzLabel(student.timezone)}</div></div>
                <p className="text-[12px] text-slate-500">You can reschedule or cancel up to {db.policies.cancelRescheduleCutoffHours} hours before the interview.</p>
                <Button className="w-full" onClick={confirm} disabled={busy} data-testid="confirm-booking">{busy ? 'Booking…' : resched ? 'Confirm new time' : 'Confirm booking'}</Button>
              </>) : <p className="text-slate-500">Select a time slot to continue.</p>}
            </div>
          </Card>
        </div>
      )}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════
// MY INTERVIEWS
// ═══════════════════════════════════════════════════════════
export function StudentInterviews() {
  const { db, student } = useStudent();
  const atts = db.attempts.filter(a => a.studentId === student.id).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  const bookings = db.bookings.filter(b => b.studentId === student.id).sort((a, b) => b.bookedAt.localeCompare(a.bookedAt));
  return (
    <div>
      <PageHeader title="My interviews" subtitle="Every attempt is kept — results are never overwritten." />
      <div className="space-y-5">
        {atts.length === 0 ? <Card><Empty title="No interviews yet" body="Once you book, your interview and its result will appear here." /></Card> : atts.map(a => {
          const s = slotOfAttempt(db, a);
          return (
            <Card key={a.id} data-testid="attempt-card">
              <div className="flex flex-wrap items-center gap-2 border-b border-slate-100 px-5 py-3.5">
                <span className="font-semibold text-slate-900">Attempt {a.attemptNumber}</span><span className="text-[13px] text-slate-500">· {badgeLabel(db, a.badgeDefId)}</span>
                <span className="ml-auto flex flex-wrap gap-1.5">{a.interviewStatus === 'CANCELLED' ? <Pill>Cancelled</Pill> : <>{a.attendance !== 'PENDING' && <AttendancePill a={a.attendance} />}<OutcomePill o={a.outcome} /></>}</span>
              </div>
              <div className="grid gap-4 px-5 py-4 text-[13px] sm:grid-cols-3">
                <div><div className="text-[12px] text-slate-500">When</div><div className="font-semibold text-slate-900">{s ? fmtDateTime(s.startAt, student.timezone) : '—'}</div></div>
                <div><div className="text-[12px] text-slate-500">Interviewer</div><div className="font-semibold text-slate-900">{interviewerName(db, a.interviewerId)}</div></div>
                <div><div className="text-[12px] text-slate-500">Result recorded</div><div className="font-semibold text-slate-900">{a.submittedAt ? fmtDateTime(a.submittedAt) : '—'}</div></div>
              </div>
              {(a.feedback || a.scores) && <div className="space-y-3 border-t border-slate-100 px-5 py-4">{a.scores && <Scores a={a} />}{a.feedback && <p className="text-[13px] text-slate-700"><span className="font-semibold">Feedback: </span>{a.feedback}</p>}</div>}
            </Card>
          );
        })}
        <Card>
          <CardHeader title="Booking history" subtitle="Includes reschedules and cancellations" />
          <ul className="divide-y divide-slate-100">{bookings.map(b => { const s = db.slots.find(x => x.id === b.slotId)!; return (
            <li key={b.id} className="flex flex-wrap items-center gap-3 px-5 py-2.5 text-[13px]"><BookingPill s={b.status} /><span className="font-medium text-slate-800">{fmtDateTime(s.startAt)}</span><span className="text-slate-500">{interviewerName(db, s.interviewerId)}</span>{b.cancellationReason && <span className="text-slate-500">· {b.cancellationReason}</span>}{b.priorityRebook && <Pill tone="amber">Priority rebook</Pill>}</li>
          ); })}</ul>
        </Card>
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════
// BADGES
// ═══════════════════════════════════════════════════════════
export function StudentBadges() {
  const { db, student } = useStudent();
  const trackId = studentTrackId(db, student.id);
  const defs = db.badgeDefs.filter(b => b.trackId === trackId).sort((a, b) => a.order - b.order);
  return (
    <div data-testid="badges-page">
      <PageHeader title="My badges" subtitle={db.tracks.find(t => t.id === trackId)!.name} />
      <div className="grid grid-cols-1 gap-5 md:grid-cols-2">{defs.map(d => {
        const sb = db.studentBadges.find(b => b.studentId === student.id && b.badgeDefId === d.id);
        const j = deriveJourney(db, student.id, d.id);
        return (
          <Card key={d.id} className="p-5">
            <div className="flex items-start gap-4"><BadgeMedal level={d.level} status={sb?.status ?? (j.eligibility.eligible ? 'IN_PROGRESS' : 'LOCKED')} size={64} />
              <div className="min-w-0 flex-1"><div className="flex flex-wrap items-center gap-2"><h3 className="text-base font-bold text-slate-900">{d.name}</h3></div>
                <div className="mt-1">{sb ? <BadgePill s={sb.status} /> : <JourneyPill s={j.state} />}</div>
                <p className="mt-2 text-[13px] text-slate-600">{sb?.status === 'EARNED' ? `Earned on ${fmtDate(sb.earnedAt)}. Counts towards your GRIT standing.` : sb?.status === 'UNDER_REVIEW' ? 'Under review by the GRIT integrity team. It stays on your profile until a decision is made.' : sb?.status === 'NULLIFIED' ? `Nullified on ${fmtDate(sb.nullifiedAt!)}. It no longer counts towards your GRIT standing.` : `Requires: ${j.eligibility.required.map(r => r.name).join(', ')}${j.eligibility.missingPrereqBadge ? ` and ${j.eligibility.missingPrereqBadge}` : ''}.`}</p>
              </div></div>
            {sb && (
              <div className="mt-4 border-t border-slate-100 pt-3"><div className="mb-2 text-[12px] font-semibold uppercase tracking-wide text-slate-500">History</div>
                <ol className="space-y-2">{sb.history.map((h, i) => (
                  <li key={i} className="flex gap-3 text-[12.5px]"><span className="mt-1.5 h-2 w-2 shrink-0 rounded-full bg-slate-300" /><div><span className="font-semibold text-slate-800">{h.to === 'EARNED' && h.from ? 'Review closed — reinstated' : h.to === 'EARNED' ? 'Earned' : h.to === 'UNDER_REVIEW' ? 'Review opened' : 'Nullified'}</span><span className="text-slate-500"> · {fmtDateTime(h.at)}</span></div></li>
                ))}</ol></div>
            )}
          </Card>
        );
      })}</div>
    </div>
  );
}

export function NotificationsPage() {
  const { db, me, act, nav } = useApp();
  const list = db.notifications.filter(n => n.userId === me.id).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  const unread = list.filter(n => !n.isRead).length;
  return (
    <div>
      <PageHeader title="Notifications" subtitle={`${unread} unread`} right={unread > 0 && <Button variant="secondary" size="sm" onClick={() => act(d => S.markNotificationsRead(d, me.id))}>Mark all as read</Button>} />
      <Card>{list.length === 0 ? <Empty title="You're all caught up" /> : (
        <ul className="divide-y divide-slate-100">{list.map(n => (
          <li key={n.id} className={cx('px-5 py-4', !n.isRead && 'bg-indigo-50/40')} data-testid="notification">
            <div className="flex flex-wrap items-center gap-2">{!n.isRead && <span className="h-2 w-2 rounded-full bg-indigo-600" />}<span className="text-sm font-semibold text-slate-900">{n.title}</span>
              <span className="ml-auto flex items-center gap-2 text-[12px] text-slate-500">{n.deliveryStatus === 'FAILED' ? <Pill tone="red">Email delivery failed · shown in app</Pill> : <Pill tone="gray">Delivered</Pill>}{fmtDateTime(n.createdAt)}</span></div>
            <div className="mt-2"><MessageBody body={n.body} /></div>
            {n.cta && <div className="mt-3"><Button size="sm" variant="secondary" onClick={() => { act(d => S.markNotificationsRead(d, me.id, [n.id])); const [a, b, id] = n.cta!.to.split('/'); nav({ name: `${a}-${b}`, id }); }} icon={<LuArrowRight size={14} />}>{n.cta.label}</Button></div>}
          </li>
        ))}</ul>
      )}</Card>
    </div>
  );
}

