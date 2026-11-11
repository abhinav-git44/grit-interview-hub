import React, { useMemo, useState } from 'react';
import { LuArrowLeft, LuCalendarDays, LuChevronLeft, LuChevronRight, LuClock, LuFlag, LuList, LuPlay, LuPlus, LuTrash2, LuTriangleAlert, LuUserX, LuVideo, LuLayoutGrid, LuPencil } from 'react-icons/lu';
import { badgeLabel, clock, HOUR, interviewerByUser, studentName } from '../domain/core';
import { evaluateEligibility } from '../domain/eligibility';
import { addDaysKey, dayKey, fmtDate, fmtDateShort, fmtDateTime, fmtTime } from '../domain/format';
import * as S from '../domain/services';
import type { DB, ID, InterviewAttempt, Interviewer, Outcome } from '../domain/types';
import { Button, Callout, Card, CardHeader, Empty, Field, Modal, PageHeader, Pill, Select, Stat, Table, Tabs, Td, cx, inputCls, useApp } from './kit';
import { AttendancePill, BadgePill, BookingPill, InterviewPill, OutcomePill, Scores, slotOfAttempt, userOfStudent } from './shared';

export function useInterviewer(): { db: DB; iv: Interviewer } {
  const { db, me } = useApp(); return { db, iv: interviewerByUser(db, me.id)! };
}

type Row = { a: InterviewAttempt; start: string; end: string; bookingStatus: string };
function myRows(db: DB, ivId: ID): Row[] {
  return db.attempts.filter(a => a.interviewerId === ivId && a.interviewStatus !== 'CANCELLED').map(a => {
    const s = slotOfAttempt(db, a)!; const b = db.bookings.find(x => x.id === a.bookingId)!;
    return { a, start: s.startAt, end: s.endAt, bookingStatus: b.status };
  }).sort((x, y) => x.start.localeCompare(y.start));
}
const needsOutcome = (r: Row) => r.a.interviewStatus !== 'COMPLETED' && new Date(r.end) < clock.now();

// ═══════════════════════════════════════════════════════════
// DAILY SCHEDULE
// ═══════════════════════════════════════════════════════════
export function InterviewerSchedule({ initialDay, initialMode }: { initialDay?: string; initialMode?: string } = {}) {
  const { db, iv } = useInterviewer(); const { nav, me } = useApp();
  const today = dayKey(clock.now());
  const [day, setDay] = useState(initialDay ?? today);
  const [mode, setMode] = useState(initialMode ?? 'list');
  const [status, setStatus] = useState('all');
  const [outcome, setOutcome] = useState('all');
  const [track, setTrack] = useState('all');
  const rows = myRows(db, iv.id);
  const weekStart = addDaysKey(today, -6);
  const completed = rows.filter(r => r.a.interviewStatus === 'COMPLETED' && r.a.outcome !== 'PENDING');
  const pending = rows.filter(needsOutcome);
  const kpi = {
    today: rows.filter(r => dayKey(r.start) === today).length,
    upcoming: rows.filter(r => r.a.interviewStatus === 'SCHEDULED' && new Date(r.start) > clock.now()).length,
    completed: completed.length,
    pending: pending.length,
    passRate: completed.length ? Math.round(100 * completed.filter(r => r.a.outcome === 'PASS').length / completed.length) : 0,
    week: rows.filter(r => dayKey(r.start) >= weekStart && dayKey(r.start) <= today).length,
  };
  const dayRows = rows.filter(r => dayKey(r.start) === day)
    .filter(r => status === 'all' || r.a.interviewStatus === status)
    .filter(r => outcome === 'all' || r.a.outcome === outcome)
    .filter(r => track === 'all' || db.badgeDefs.find(b => b.id === r.a.badgeDefId)?.trackId === track);
  const daySlots = db.slots.filter(s => s.interviewerId === iv.id && dayKey(s.startAt) === day && s.status !== 'REMOVED').sort((a, b) => a.startAt.localeCompare(b.startAt));

  return (
    <div data-testid="interviewer-schedule">
      <PageHeader title={`Good ${clock.now().getHours() < 12 ? 'morning' : 'afternoon'}, ${me.fullName.split(' ')[0]}`} subtitle={`${iv.specialization} interviewer · ${iv.employeeCode}`} right={<Button variant="secondary" onClick={() => nav({ name: 'interviewer-availability' })} icon={<LuCalendarDays size={15} />}>Manage availability</Button>} />
      <div className="mb-6 grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
        <Stat label="Today" value={kpi.today} /><Stat label="Upcoming" value={kpi.upcoming} /><Stat label="Completed" value={kpi.completed} />
        <Stat label="Pending evaluations" value={kpi.pending} tone={kpi.pending ? 'warn' : undefined} /><Stat label="Pass rate" value={`${kpi.passRate}%`} /><Stat label="Last 7 days" value={kpi.week} />
      </div>
      {pending.length > 0 && <div className="mb-5"><Callout tone="amber" icon={<LuTriangleAlert size={18} className="text-amber-700" />} title={`${pending.length} interview${pending.length > 1 ? 's need' : ' needs'} an outcome`} action={pending.map(r => <Button key={r.a.id} size="sm" variant="secondary" onClick={() => nav({ name: 'interviewer-interview', id: r.a.id })}>{studentName(db, r.a.studentId)} · {fmtDateShort(r.start)}</Button>)}>Students are waiting for their result.</Callout></div>}
      <Card>
        <div className="flex flex-wrap items-center gap-2 border-b border-slate-100 px-4 py-3">
          <div className="flex items-center gap-1"><Button size="sm" variant="ghost" aria-label="Previous day" onClick={() => setDay(addDaysKey(day, -1))}><LuChevronLeft size={16} /></Button>
            <span className="min-w-[150px] text-center text-sm font-semibold text-slate-900">{day === today ? 'Today · ' : ''}{fmtDateShort(`${day}T06:30:00Z`)}</span>
            <Button size="sm" variant="ghost" aria-label="Next day" onClick={() => setDay(addDaysKey(day, 1))}><LuChevronRight size={16} /></Button>
            {day !== today && <Button size="sm" variant="secondary" onClick={() => setDay(today)}>Today</Button>}</div>
          <div className="ml-auto flex flex-wrap items-center gap-2">
            <Select label="Status" value={status} onChange={setStatus} options={[['all', 'All statuses'], ['SCHEDULED', 'Scheduled'], ['IN_PROGRESS', 'In progress'], ['COMPLETED', 'Completed']]} />
            <Select label="Outcome" value={outcome} onChange={setOutcome} options={[['all', 'All outcomes'], ['PENDING', 'Pending'], ['PASS', 'Pass'], ['FAIL', 'Fail'], ['RETAKE_LATER', 'Retake later']]} />
            <Select label="Track" value={track} onChange={setTrack} options={[['all', 'All tracks'], ...db.tracks.map(t => [t.id, t.name] as [string, string])]} />
            <Tabs value={mode} onChange={setMode} items={[['list', <span className="flex items-center gap-1"><LuList size={14} />List</span>], ['timeline', <span className="flex items-center gap-1"><LuLayoutGrid size={14} />Day</span>]]} />
          </div>
        </div>
        {mode === 'list' ? (
          dayRows.length === 0 ? <Empty title="No interviews on this day" body="Booked interviews appear here automatically." /> : (
            <ul className="divide-y divide-slate-100">{dayRows.map(r => {
              const st = db.students.find(s => s.id === r.a.studentId)!;
              return (
                <li key={r.a.id} className="flex flex-wrap items-center gap-x-4 gap-y-2 px-4 py-3.5 hover:bg-slate-50" data-testid="schedule-row">
                  <div className="w-24"><div className="text-sm font-bold tabular-nums text-slate-900">{fmtTime(r.start)}</div><div className="text-[12px] text-slate-500">{fmtTime(r.end)}</div></div>
                  <div className="min-w-[180px] flex-1"><div className="text-sm font-semibold text-slate-900">{studentName(db, st.id)}</div><div className="text-[12px] text-slate-500">{st.studentCode} · {badgeLabel(db, r.a.badgeDefId)} · Attempt {r.a.attemptNumber}</div></div>
                  <div className="flex flex-wrap gap-1.5">{r.bookingStatus !== 'COMPLETED' && <BookingPill s={r.bookingStatus as never} />}<AttendancePill a={r.a.attendance} /><InterviewPill s={r.a.interviewStatus} />{r.a.outcome !== 'PENDING' && <OutcomePill o={r.a.outcome} />}{needsOutcome(r) && <Pill tone="amber">Outcome due</Pill>}</div>
                  <Button size="sm" variant={r.a.interviewStatus === 'COMPLETED' ? 'secondary' : 'primary'} onClick={() => nav({ name: 'interviewer-interview', id: r.a.id })}>{r.a.interviewStatus === 'COMPLETED' ? 'View' : r.a.interviewStatus === 'IN_PROGRESS' ? 'Continue' : 'Open'}</Button>
                </li>
              );
            })}</ul>
          )
        ) : (
          <div className="px-4 py-4">{daySlots.length === 0 ? <Empty title="No availability on this day" /> : (
            <div className="relative space-y-1.5">{daySlots.map(s => {
              const r = rows.find(x => db.bookings.find(b => b.id === x.a.bookingId)?.slotId === s.id);
              return (
                <div key={s.id} className="flex items-stretch gap-3">
                  <div className="w-20 pt-2 text-right text-[12px] font-semibold tabular-nums text-slate-500">{fmtTime(s.startAt)}</div>
                  <button disabled={!r} onClick={() => r && nav({ name: 'interviewer-interview', id: r.a.id })} className={cx('flex-1 rounded-lg border px-3 py-2 text-left text-[13px]', r ? 'border-teal-200 bg-teal-50 hover:bg-teal-100' : s.status === 'BLOCKED' ? 'border-slate-200 bg-[repeating-linear-gradient(45deg,#f8fafc,#f8fafc_6px,#eef2f7_6px,#eef2f7_12px)] text-slate-400' : 'border-dashed border-slate-300 text-slate-400')}>
                    {r ? <span className="font-semibold text-teal-900">{studentName(db, r.a.studentId)} <span className="font-normal text-teal-700">· {badgeLabel(db, r.a.badgeDefId)}</span></span> : s.status === 'BLOCKED' ? 'Blocked' : 'Open slot'}
                  </button>
                </div>
              );
            })}</div>
          )}</div>
        )}
      </Card>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════
// INTERVIEW DETAIL + OUTCOME RECORDING
// ═══════════════════════════════════════════════════════════
export function InterviewerInterview({ id }: { id: ID }) {
  const { db, me, act, nav } = useApp();
  const a = db.attempts.find(x => x.id === id);
  const [confirm, setConfirm] = useState(false);
  const [unavail, setUnavail] = useState(false);
  const [flag, setFlag] = useState(false);
  const [amend, setAmend] = useState(false);
  const [reason, setReason] = useState('');
  const [form, setForm] = useState({ outcome: '' as Outcome | '', technical: 0, communication: 0, problemSolving: 0, feedback: '' });
  const [errors, setErrors] = useState<Record<string, string>>({});
  if (!a) return <Card><Empty title="Interview not found" /></Card>;
  const iv = interviewerByUser(db, me.id);
  if (me.role !== 'ADMIN' && iv?.id !== a.interviewerId) return <Card><Empty title="Not your interview" body="Interviewers can only open interviews assigned to them." /></Card>;
  const slot = slotOfAttempt(db, a)!; const st = db.students.find(s => s.id === a.studentId)!; const user = userOfStudent(db, st.id)!;
  const elig = evaluateEligibility(db, st.id, a.badgeDefId);
  const prior = db.attempts.filter(x => x.studentId === st.id && x.badgeDefId === a.badgeDefId && x.id !== a.id && x.interviewStatus === 'COMPLETED');
  const sb = db.studentBadges.find(b => b.attemptId === a.id);
  const minsToStart = (new Date(slot.startAt).getTime() - clock.now().getTime()) / 60000;
  const canEdit = a.interviewStatus === 'COMPLETED' && a.outcome !== 'PENDING' && a.outcome !== 'PASS' && (clock.now().getTime() - new Date(a.submittedAt!).getTime()) / HOUR <= db.policies.outcomeEditWindowHours;

  const validate = () => {
    const e: Record<string, string> = {};
    if (!form.outcome) e.outcome = 'Choose a final recommendation.';
    (['technical', 'communication', 'problemSolving'] as const).forEach(k => { if (!form[k]) e[k] = 'Required'; });
    if (form.outcome && form.outcome !== 'PASS' && form.feedback.trim().length < 20) e.feedback = 'At least 20 characters so the student knows what to improve.';
    setErrors(e); return Object.keys(e).length === 0;
  };
  const payload = () => ({ outcome: form.outcome as Exclude<Outcome, 'PENDING'>, scores: { technical: form.technical, communication: form.communication, problemSolving: form.problemSolving }, feedback: form.feedback });

  return (
    <div data-testid="interview-detail">
      <PageHeader title={studentName(db, st.id)} subtitle={<>{badgeLabel(db, a.badgeDefId)} · Attempt {a.attemptNumber} · {fmtDateTime(slot.startAt)}</>} right={<Button variant="ghost" onClick={() => nav({ name: 'interviewer-schedule' })} icon={<LuArrowLeft size={15} />}>Schedule</Button>} />
      <div className="grid grid-cols-1 gap-5 [&>*]:min-w-0 lg:grid-cols-[minmax(0,1fr)_330px]">
        <div className="space-y-5">
          <Card className="p-5">
            <div className="flex flex-wrap items-center gap-2"><InterviewPill s={a.interviewStatus} /><AttendancePill a={a.attendance} />{a.outcome !== 'PENDING' && <OutcomePill o={a.outcome} />}{sb && <BadgePill s={sb.status} />}</div>
            {a.interviewStatus === 'SCHEDULED' && (
              <div className="mt-4 flex flex-wrap items-center gap-2">
                <Button onClick={() => act(d => S.startInterview(d, me.id, a.id), 'Interview started — student marked present')} icon={<LuPlay size={15} />} data-testid="start-interview">Start interview</Button>
                <Button variant="secondary" disabled={minsToStart > 0} onClick={() => act(d => S.markStudentNoShow(d, me.id, a.id), 'Marked as student no-show')} icon={<LuUserX size={15} />}>Student didn't join</Button>
                <Button variant="ghost" disabled={minsToStart < 0} onClick={() => setUnavail(true)}>I can't make it</Button>
                <span className="text-[12px] text-slate-500">{minsToStart > 0 ? `Starts in ${minsToStart >= 120 ? `${Math.round(minsToStart / 60)} h` : `${Math.round(minsToStart)} min`} · room opens ${S.START_WINDOW_BEFORE_MIN} min early` : 'Start time has passed'}</span>
              </div>
            )}
            {a.interviewStatus !== 'COMPLETED' && <div className="mt-4 flex items-center gap-2 rounded-lg border border-slate-200 px-3 py-2 text-[13px]"><LuVideo size={15} className="text-slate-500" /><span className="truncate">{db.bookings.find(b => b.id === a.bookingId)!.meetingLink}</span><Pill>Demo link</Pill></div>}
          </Card>

          {a.interviewStatus === 'IN_PROGRESS' && (
            <Card data-testid="evaluation-form">
              <CardHeader title="Evaluation" subtitle="Scores 1 (weak) – 5 (excellent). Results are final once submitted." />
              <div className="space-y-5 px-5 py-4">
                {(['technical', 'communication', 'problemSolving'] as const).map(k => (
                  <div key={k}><div className="mb-1.5 flex items-center justify-between"><span className="text-[13px] font-semibold text-slate-700">{k === 'technical' ? 'Technical proficiency' : k === 'communication' ? 'Communication' : 'Problem-solving'}</span>{errors[k] && <span className="text-[12px] font-medium text-red-700">{errors[k]}</span>}</div>
                    <div className="flex gap-1.5" role="radiogroup" aria-label={k}>{[1, 2, 3, 4, 5].map(v => (
                      <button key={v} role="radio" aria-checked={form[k] === v} data-testid={`score-${k}-${v}`} onClick={() => { setForm({ ...form, [k]: v }); setErrors(e => ({ ...e, [k]: '' })); }} className={cx('h-9 w-11 rounded-lg border text-sm font-bold tabular-nums', form[k] === v ? 'border-indigo-600 bg-indigo-600 text-white' : 'border-slate-300 text-slate-700 hover:border-slate-500')}>{v}</button>
                    ))}</div></div>
                ))}
                <Field label="Overall feedback" hint="Shared with the student. Be specific about what to work on." error={errors.feedback}><textarea data-testid="feedback" className={cx(inputCls, 'min-h-[96px]')} value={form.feedback} onChange={e => setForm({ ...form, feedback: e.target.value })} /></Field>
                <div><div className="mb-1.5 flex items-center justify-between"><span className="text-[13px] font-semibold text-slate-700">Final recommendation</span>{errors.outcome && <span className="text-[12px] font-medium text-red-700">{errors.outcome}</span>}</div>
                  <div className="grid gap-2 sm:grid-cols-3">{([['PASS', 'Pass', 'Award the badge', 'border-emerald-600 bg-emerald-50'], ['RETAKE_LATER', 'Retake later', `Close — retry after ${db.policies.retakeCooldownDays} days`, 'border-amber-500 bg-amber-50'], ['FAIL', 'Fail', `Not ready — ${db.policies.failCooldownDays}-day cooldown`, 'border-red-500 bg-red-50']] as const).map(([v, l, h, on]) => (
                    <button key={v} data-testid={`outcome-${v}`} onClick={() => { setForm({ ...form, outcome: v }); setErrors(e => ({ ...e, outcome: '' })); }} className={cx('rounded-xl border-2 px-3 py-2.5 text-left', form.outcome === v ? on : 'border-slate-200 hover:border-slate-400')}><div className="text-sm font-bold text-slate-900">{l}</div><div className="text-[12px] text-slate-600">{h}</div></button>
                  ))}</div></div>
                <div className="flex justify-end"><Button data-testid="submit-outcome" onClick={() => validate() && setConfirm(true)}>Review & submit</Button></div>
              </div>
            </Card>
          )}

          {a.interviewStatus === 'COMPLETED' && (
            <Card>
              <CardHeader title="Recorded result" subtitle={a.submittedAt ? `Submitted ${fmtDateTime(a.submittedAt)}` : undefined} right={<div className="flex gap-2">{canEdit && <Button size="sm" variant="secondary" icon={<LuPencil size={14} />} onClick={() => { setForm({ outcome: a.outcome, technical: a.scores?.technical ?? 3, communication: a.scores?.communication ?? 3, problemSolving: a.scores?.problemSolving ?? 3, feedback: a.feedback ?? '' }); setAmend(true); }}>Correct result</Button>}{sb && sb.status !== 'NULLIFIED' && <Button size="sm" variant="danger" icon={<LuFlag size={14} />} onClick={() => setFlag(true)}>Flag malpractice</Button>}</div>} />
              <div className="space-y-4 px-5 py-4">
                {a.scores && <Scores a={a} />}{a.feedback && <p className="text-[13px] text-slate-700"><span className="font-semibold">Feedback: </span>{a.feedback}</p>}
                {a.revisions.length > 1 && <div><div className="mb-1 text-[12px] font-semibold uppercase tracking-wide text-slate-500">Revision history</div><ul className="space-y-1 text-[12.5px] text-slate-600">{a.revisions.map((r, i) => <li key={i}>{fmtDateTime(r.changedAt)} · <OutcomePill o={r.outcome} />{r.reason && <> · “{r.reason}”</>}</li>)}</ul></div>}
                {!canEdit && a.outcome !== 'PENDING' && <p className="text-[12px] text-slate-500">{a.outcome === 'PASS' ? 'A Pass that awarded a badge can only be reversed through a malpractice review.' : `Corrections are allowed within ${db.policies.outcomeEditWindowHours} hours of submission; after that, contact the ops team.`}</p>}
              </div>
            </Card>
          )}
        </div>

        <div className="space-y-5">
          <Card>
            <CardHeader title="Student" />
            <dl className="space-y-2 px-5 py-4 text-[13px]">
              {([['Name', user.fullName], ['Student ID', st.studentCode], ['Campus', st.campus], ['Batch', String(st.batch)]] as const).map(([k, v]) => <div key={k} className="flex justify-between gap-3"><dt className="text-slate-500">{k}</dt><dd className="font-semibold text-slate-800">{v}</dd></div>)}
            </dl>
            <div className="border-t border-slate-100 px-5 py-3"><div className="mb-2 text-[12px] font-semibold uppercase tracking-wide text-slate-500">Skills for this badge</div>
              <ul className="space-y-1.5">{elig.required.map(r => <li key={r.skillId} className="flex items-center justify-between text-[13px]"><span>{r.name}</span><Pill tone={r.cleared ? 'green' : 'gray'}>{r.cleared ? 'Cleared' : 'Not cleared'}</Pill></li>)}</ul></div>
          </Card>
          <Card>
            <CardHeader title="Previous attempts" subtitle={prior.length ? undefined : 'First attempt'} />
            {prior.length > 0 && <ul className="divide-y divide-slate-100">{prior.map(p => <li key={p.id} className="px-5 py-3 text-[13px]"><div className="flex items-center justify-between"><span className="font-semibold">Attempt {p.attemptNumber}</span>{p.attendance === 'STUDENT_NO_SHOW' ? <AttendancePill a={p.attendance} /> : <OutcomePill o={p.outcome} />}</div>{p.feedback && <p className="mt-1 text-slate-600">“{p.feedback}”</p>}</li>)}</ul>}
          </Card>
        </div>
      </div>

      <Modal open={confirm} onClose={() => setConfirm(false)} title="Submit this result?" footer={<><Button variant="secondary" onClick={() => setConfirm(false)}>Go back</Button><Button data-testid="confirm-outcome" onClick={() => { act(d => S.submitOutcome(d, me.id, a.id, payload()), 'Result recorded and shared with the student'); setConfirm(false); }}>Submit result</Button></>}>
        <p className="text-[13.5px] text-slate-700">You're recording <strong>{form.outcome === 'PASS' ? 'Pass' : form.outcome === 'FAIL' ? 'Fail' : 'Retake later'}</strong> for {user.fullName}. {form.outcome === 'PASS' ? 'The badge will be awarded immediately.' : 'The student will be notified with your feedback and their next booking date.'}</p>
        <p className="mt-2 text-[12.5px] text-slate-500">You can correct a non-Pass result within {db.policies.outcomeEditWindowHours} hours (reason required).</p>
      </Modal>
      <Modal open={amend} onClose={() => setAmend(false)} title="Correct a submitted result" footer={<><Button variant="secondary" onClick={() => setAmend(false)}>Cancel</Button><Button onClick={() => { if (act(d => S.amendOutcome(d, me.id, a.id, { ...payload(), reason }), 'Result corrected — previous version kept in history') !== undefined) setAmend(false); }}>Save correction</Button></>}>
        <div className="space-y-3">
          <Field label="New outcome"><Select value={form.outcome} onChange={v => setForm({ ...form, outcome: v as Outcome })} options={[['PASS', 'Pass'], ['RETAKE_LATER', 'Retake later'], ['FAIL', 'Fail']]} className="w-full" /></Field>
          <Field label="Feedback"><textarea className={cx(inputCls, 'min-h-[80px]')} value={form.feedback} onChange={e => setForm({ ...form, feedback: e.target.value })} /></Field>
          <Field label="Reason for correction" hint="Required. Stored in the audit log."><input className={inputCls} value={reason} onChange={e => setReason(e.target.value)} /></Field>
        </div>
      </Modal>
      <UnavailableModal open={unavail} onClose={() => setUnavail(false)} attemptId={a.id} />
      <FlagModal open={flag} onClose={() => setFlag(false)} studentBadgeId={sb?.id} />
    </div>
  );
}

function UnavailableModal({ open, onClose, attemptId }: { open: boolean; onClose: () => void; attemptId: ID }) {
  const { act, me, db } = useApp(); const [reason, setReason] = useState('');
  return (
    <Modal open={open} onClose={onClose} title="Can't make this interview?" footer={<><Button variant="secondary" onClick={onClose}>Back</Button><Button variant="danger" onClick={() => { const r = act(d => S.interviewerUnavailable(d, me.id, attemptId, reason || 'Unavailable'), res => res.reassignedTo ? `Reassigned to ${db.users.find(u => u.id === db.interviewers.find(i => i.id === res.reassignedTo)?.userId)?.fullName}` : 'Cancelled — student has priority rebooking'); if (r) onClose(); }}>Release interview</Button></>}>
      <p className="text-[13px] text-slate-600">We'll first try to hand it to a colleague who is free at the same time. If nobody is, the booking is cancelled, the student is told it wasn't their fault, and they get priority rebooking. It never counts as their attempt.</p>
      <div className="mt-3"><Field label="Reason"><input className={inputCls} value={reason} onChange={e => setReason(e.target.value)} placeholder="e.g. Unwell" /></Field></div>
    </Modal>
  );
}

export function FlagModal({ open, onClose, studentBadgeId }: { open: boolean; onClose: () => void; studentBadgeId?: ID }) {
  const { act, me } = useApp(); const [desc, setDesc] = useState(''); const [ev, setEv] = useState('');
  if (!studentBadgeId) return null;
  return (
    <Modal open={open} onClose={onClose} title="Flag possible malpractice" footer={<><Button variant="secondary" onClick={onClose}>Cancel</Button><Button variant="danger" onClick={() => { if (act(d => S.flagMalpractice(d, me.id, studentBadgeId, desc, ev), 'Flag raised — badge moved to under review') !== undefined) { setDesc(''); setEv(''); onClose(); } }}>Raise flag</Button></>}>
      <Callout tone="amber" title="A flag is not a decision">The badge moves to “under review”. Only an authorised integrity reviewer can nullify it, after an investigation.</Callout>
      <div className="mt-3 space-y-3"><Field label="What happened?"><textarea className={cx(inputCls, 'min-h-[80px]')} value={desc} onChange={e => setDesc(e.target.value)} /></Field><Field label="Evidence reference" hint="Link or ID — evidence itself is never shown to the student."><input className={inputCls} value={ev} onChange={e => setEv(e.target.value)} /></Field></div>
    </Modal>
  );
}

// ═══════════════════════════════════════════════════════════
// AVAILABILITY
// ═══════════════════════════════════════════════════════════
export function InterviewerAvailability() {
  const { db, iv } = useInterviewer(); const { act, me } = useApp();
  const today = dayKey(clock.now());
  const [form, setForm] = useState({ date: addDaysKey(today, 1), start: '15:00', end: '17:00', repeatWeeks: 1 });
  const windows = db.windows.filter(w => w.interviewerId === iv.id && !w.removedAt && new Date(w.endAt) > clock.now()).sort((a, b) => a.startAt.localeCompare(b.startAt));
  const byDay = useMemo(() => { const m = new Map<string, typeof windows>(); windows.forEach(w => { const k = dayKey(w.startAt); m.set(k, [...(m.get(k) ?? []), w]); }); return [...m.entries()]; }, [windows]);
  const p = db.policies;
  const preview = (() => { const [sh, sm] = form.start.split(':').map(Number); const [eh, em] = form.end.split(':').map(Number); const mins = eh * 60 + em - (sh * 60 + sm); return mins > 0 ? Math.max(0, Math.floor((mins - p.interviewDurationMin) / (p.interviewDurationMin + p.slotBufferMin)) + 1) : 0; })();

  return (
    <div data-testid="availability-page">
      <PageHeader title="Availability" subtitle={`Slots are ${p.interviewDurationMin} min with a ${p.slotBufferMin}-min buffer. Students can book up to ${p.bookingHorizonDays} days ahead.`} />
      <div className="grid grid-cols-1 gap-5 [&>*]:min-w-0 lg:grid-cols-[340px_minmax(0,1fr)]">
        <Card className="h-fit">
          <CardHeader title="Add availability" />
          <form className="space-y-3 px-5 py-4" onSubmit={e => { e.preventDefault(); act(d => S.addAvailability(d, me.id, { interviewerId: iv.id, ...form }), ids => `Added ${ids.length} window${ids.length > 1 ? 's' : ''}`); }}>
            <Field label="Date"><input type="date" min={today} className={inputCls} value={form.date} onChange={e => setForm({ ...form, date: e.target.value })} data-testid="avail-date" /></Field>
            <div className="grid grid-cols-2 gap-3"><Field label="From"><input type="time" className={inputCls} value={form.start} onChange={e => setForm({ ...form, start: e.target.value })} data-testid="avail-start" /></Field><Field label="To"><input type="time" className={inputCls} value={form.end} onChange={e => setForm({ ...form, end: e.target.value })} data-testid="avail-end" /></Field></div>
            <Field label="Repeat"><Select className="w-full" value={String(form.repeatWeeks)} onChange={v => setForm({ ...form, repeatWeeks: Number(v) })} options={[['1', 'Does not repeat'], ['2', 'Weekly for 2 weeks'], ['4', 'Weekly for 4 weeks'], ['8', 'Weekly for 8 weeks']]} /></Field>
            <p className="text-[12px] text-slate-500">Creates {preview} slot{preview === 1 ? '' : 's'}{form.repeatWeeks > 1 ? ` per week (${preview * form.repeatWeeks} total)` : ''}.</p>
            <Button type="submit" className="w-full" icon={<LuPlus size={15} />} disabled={!iv.isActive}>Add</Button>
          </form>
        </Card>
        <Card>
          <CardHeader title="Upcoming windows" subtitle="Click an open slot to block it (e.g. for a break). Booked slots can't be removed here — release the interview instead." />
          {byDay.length === 0 ? <Empty title="No upcoming availability" body="Add a window so students can book you." /> : (
            <div className="divide-y divide-slate-100">{byDay.map(([d, ws]) => (
              <div key={d} className="px-5 py-3.5">
                <div className="mb-2 text-[13px] font-semibold text-slate-900">{fmtDate(`${d}T06:30:00Z`)}</div>
                {ws.map(w => { const slots = db.slots.filter(s => s.windowId === w.id); const booked = slots.filter(s => s.status === 'BOOKED').length; return (
                  <div key={w.id} className="mb-2 flex flex-wrap items-center gap-2">
                    <span className="w-36 text-[12.5px] tabular-nums text-slate-600"><LuClock size={12} className="mr-1 inline" />{fmtTime(w.startAt)}–{fmtTime(w.endAt)}</span>
                    <div className="flex flex-wrap gap-1.5">{slots.map(s => (
                      <button key={s.id} onClick={() => s.status !== 'BOOKED' && new Date(s.startAt) > clock.now() && act(dd => S.setSlotBlocked(dd, me.id, s.id, s.status === 'OPEN'), s.status === 'OPEN' ? 'Slot blocked' : 'Slot reopened')}
                        title={s.status} className={cx('rounded-md px-2 py-1 text-[12px] font-semibold tabular-nums', s.status === 'BOOKED' ? 'cursor-default bg-teal-600 text-white' : s.status === 'BLOCKED' ? 'bg-slate-200 text-slate-500 line-through' : 'bg-white text-slate-700 ring-1 ring-slate-300 hover:ring-slate-500')}>{fmtTime(s.startAt)}</button>
                    ))}</div>
                    <Button size="sm" variant="ghost" className="ml-auto" aria-label="Remove window" onClick={() => act(dd => S.removeAvailability(dd, me.id, w.id), 'Availability removed')} icon={<LuTrash2 size={14} />}>{booked ? `${booked} booked` : 'Remove'}</Button>
                  </div>
                ); })}
              </div>
            ))}</div>
          )}
          <div className="flex flex-wrap gap-3 border-t border-slate-100 px-5 py-3 text-[12px] text-slate-500"><span className="flex items-center gap-1.5"><span className="h-3 w-3 rounded bg-white ring-1 ring-slate-300" />Open</span><span className="flex items-center gap-1.5"><span className="h-3 w-3 rounded bg-teal-600" />Booked</span><span className="flex items-center gap-1.5"><span className="h-3 w-3 rounded bg-slate-200" />Blocked</span></div>
        </Card>
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════
// HISTORY
// ═══════════════════════════════════════════════════════════
export function InterviewerHistory() {
  const { db, iv } = useInterviewer(); const { nav } = useApp();
  const [outcome, setOutcome] = useState('all');
  const rows = myRows(db, iv.id).filter(r => r.a.interviewStatus === 'COMPLETED').filter(r => outcome === 'all' || r.a.outcome === outcome || (outcome === 'NO_SHOW' && r.a.attendance === 'STUDENT_NO_SHOW')).reverse();
  return (
    <div>
      <PageHeader title="Interview history" right={<Select label="Outcome" value={outcome} onChange={setOutcome} options={[['all', 'All outcomes'], ['PASS', 'Pass'], ['FAIL', 'Fail'], ['RETAKE_LATER', 'Retake later'], ['NO_SHOW', 'No-show']]} />} />
      <Card><Table head={['Date', 'Student', 'Badge', 'Attempt', 'Result', '']} empty={<Empty title="No completed interviews" />}>
        {rows.map(r => (
          <tr key={r.a.id} className="hover:bg-slate-50"><Td>{fmtDateTime(r.start)}</Td><Td className="font-semibold text-slate-900">{studentName(db, r.a.studentId)}</Td><Td>{badgeLabel(db, r.a.badgeDefId)}</Td><Td>{r.a.attemptNumber}</Td>
            <Td>{r.a.attendance === 'STUDENT_NO_SHOW' ? <AttendancePill a={r.a.attendance} /> : <OutcomePill o={r.a.outcome} />}</Td><Td><Button size="sm" variant="ghost" onClick={() => nav({ name: 'interviewer-interview', id: r.a.id })}>View</Button></Td></tr>
        ))}
      </Table></Card>
    </div>
  );
}

