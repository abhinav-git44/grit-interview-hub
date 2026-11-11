import React, { useState } from 'react';
import { LuBell, LuCopy, LuSearch, LuShieldCheck, LuShieldX, LuTriangleAlert, LuFlag, LuLock } from 'react-icons/lu';
import { badgeLabel, clock, DAY, interviewerName, nameOf, studentName } from '../domain/core';
import { currentBadgeDefId, deriveJourney, JOURNEY_LABEL, studentTrackId, type Journey } from '../domain/eligibility';
import { addDaysKey, dayKey, fmtDate, fmtDateShort, fmtDateTime, fmtTime } from '../domain/format';
import * as S from '../domain/services';
import type { DB, ID, Policies } from '../domain/types';
import { Button, Callout, Card, CardHeader, Empty, Field, Modal, PageHeader, Pager, Pill, Select, Stat, Table, Tabs, Td, cx, inputCls, useApp, useSort } from './kit';
import { AttendancePill, BadgePill, BookingPill, CasePill, InterviewPill, JourneyPill, OutcomePill, slotOfAttempt } from './shared';

// ── Derived rows ───────────────────────────────────────────
interface StudentRow { id: ID; name: string; code: string; track: string; trackId: ID; j: Journey; eligibleSince?: string; lastOutcome?: string }
export function studentRows(db: DB): StudentRow[] {
  return db.students.map(s => {
    const j = deriveJourney(db, s.id, currentBadgeDefId(db, s.id));
    const trackId = studentTrackId(db, s.id);
    const granted = db.auditLogs.filter(l => l.action === 'eligibility.granted' && l.entityId === s.id).map(l => l.createdAt).sort().pop();
    return { id: s.id, name: nameOf(db, s.userId), code: s.studentCode, track: db.tracks.find(t => t.id === trackId)!.name, trackId, j, eligibleSince: granted, lastOutcome: j.lastAttempt?.outcome };
  });
}
const isEligibleNow = (j: Journey) => j.eligibility.eligible && !['PASSED', 'BADGE_UNDER_REVIEW', 'BADGE_NULLIFIED', 'ATTEMPTS_EXHAUSTED'].includes(j.state);
const isBooked = (j: Journey) => !!j.activeBooking;

// ── Tiny single-hue bar charts (labels carry identity; hover shows exact values) ──
function HBars({ data, max, suffix = '' }: { data: { label: string; value: number; note?: string }[]; max?: number; suffix?: string }) {
  const m = max ?? Math.max(1, ...data.map(d => d.value));
  return (
    <div className="space-y-2.5">{data.map(d => (
      <div key={d.label} className="group" title={`${d.label}: ${d.value}${suffix}`}>
        <div className="mb-1 flex justify-between text-[12.5px]"><span className="text-slate-700">{d.label}</span><span className="font-semibold tabular-nums text-slate-900">{d.value}{suffix}{d.note && <span className="ml-1 font-normal text-slate-500">{d.note}</span>}</span></div>
        <div className="h-2.5 rounded-full bg-slate-100"><div className="h-full rounded-full bg-indigo-600 transition-all group-hover:bg-indigo-700" style={{ width: `${(d.value / m) * 100}%` }} /></div>
      </div>
    ))}</div>
  );
}
function Columns({ data }: { data: { label: string; value: number; today?: boolean; future?: boolean }[] }) {
  const m = Math.max(1, ...data.map(d => d.value));
  return (
    <div>
      <div className="flex h-36 items-end gap-[3px] border-b border-slate-200">{data.map(d => (
        <div key={d.label} className="group relative flex h-full flex-1 flex-col justify-end" title={`${d.label}: ${d.value} interview${d.value === 1 ? '' : 's'}`}>
          {d.value > 0 && <div className={cx('rounded-t-[4px]', d.future ? 'bg-indigo-300' : 'bg-indigo-600', 'group-hover:opacity-80')} style={{ height: `${(d.value / m) * 100}%` }} />}
          {d.today && <div className="absolute inset-x-0 -bottom-5 text-center text-[10px] font-bold text-slate-700">Today</div>}
        </div>
      ))}</div>
      <div className="mt-1 flex justify-between text-[10.5px] text-slate-400"><span>{data[0]?.label}</span><span>{data[data.length - 1]?.label}</span></div>
      <div className="mt-3 flex gap-4 text-[11.5px] text-slate-500"><span className="flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-sm bg-indigo-600" />Held</span><span className="flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-sm bg-indigo-300" />Scheduled</span></div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════
// OVERVIEW
// ═══════════════════════════════════════════════════════════
export function AdminOverview() {
  const { db, nav, act, me } = useApp();
  const rows = studentRows(db);
  const eligible = rows.filter(r => isEligibleNow(r.j));
  const booked = eligible.filter(r => isBooked(r.j));
  const unbooked = eligible.filter(r => !isBooked(r.j) && r.j.canBook);
  const now = clock.now();
  const live = db.attempts.filter(a => a.interviewStatus !== 'CANCELLED');
  const upcoming = live.filter(a => a.interviewStatus === 'SCHEDULED' && new Date(slotOfAttempt(db, a)!.startAt) > now);
  const completed = live.filter(a => a.interviewStatus === 'COMPLETED');
  const pendingOutcome = live.filter(a => a.interviewStatus !== 'COMPLETED' && new Date(slotOfAttempt(db, a)!.endAt) < now);
  const b = (s: string) => db.studentBadges.filter(x => x.status === s).length;
  const everBooked = new Set(db.bookings.map(x => x.studentId)).size;
  const everEligible = rows.filter(r => r.eligibleSince).length;
  const interviewed = new Set(completed.filter(a => a.attendance === 'PRESENT').map(a => a.studentId)).size;
  const passed = new Set(db.studentBadges.map(x => x.studentId)).size;
  const outcomes = [
    { label: 'Pass', value: completed.filter(a => a.outcome === 'PASS').length },
    { label: 'Retake later', value: completed.filter(a => a.outcome === 'RETAKE_LATER').length },
    { label: 'Fail', value: completed.filter(a => a.outcome === 'FAIL').length },
    { label: 'Student no-show', value: completed.filter(a => a.attendance === 'STUDENT_NO_SHOW').length },
  ];
  const today = dayKey(now);
  const volume = Array.from({ length: 28 }, (_, i) => { const d = addDaysKey(today, i - 20); return { label: fmtDateShort(`${d}T06:30:00Z`), value: live.filter(a => dayKey(slotOfAttempt(db, a)!.startAt) === d).length, today: d === today, future: d > today }; });
  const horizon = now.getTime() + 14 * DAY;
  const util = db.interviewers.map(iv => { const s = db.slots.filter(x => x.interviewerId === iv.id && new Date(x.startAt) > now && new Date(x.startAt).getTime() < horizon && (x.status === 'OPEN' || x.status === 'BOOKED')); const bk = s.filter(x => x.status === 'BOOKED').length; return { label: nameOf(db, iv.userId), value: s.length ? Math.round((100 * bk) / s.length) : 0, note: `(${bk}/${s.length} slots)` }; });
  const cancellations = db.bookings.filter(x => x.status === 'CANCELLED').length;
  const noShows = completed.filter(a => a.attendance !== 'PRESENT').length;

  return (
    <div data-testid="admin-overview">
      <PageHeader title="Interview operations" subtitle={`${fmtDate(now.toISOString())} · sample data`} right={<Button variant="secondary" onClick={() => nav({ name: 'admin-students' })}>View students</Button>} />
      <div className="mb-6 grid grid-cols-2 gap-3 md:grid-cols-5">
        <Stat label="Total students" value={rows.length} /><Stat label="Eligible now" value={eligible.length} /><Stat label="Booked" value={booked.length} hint={`${eligible.length ? Math.round(100 * booked.length / eligible.length) : 0}% of eligible`} />
        <Stat label="Eligible, not booked" value={unbooked.length} tone={unbooked.length ? 'warn' : undefined} hint={eligible.length - booked.length - unbooked.length > 0 ? `+${eligible.length - booked.length - unbooked.length} waiting out a cooldown` : 'can book now'} /><Stat label="Upcoming interviews" value={upcoming.length} />
        <Stat label="Completed interviews" value={completed.length} /><Stat label="Pending outcomes" value={pendingOutcome.length} tone={pendingOutcome.length ? 'warn' : undefined} />
        <Stat label="Badges earned" value={b('EARNED')} /><Stat label="Under review" value={b('UNDER_REVIEW')} tone={b('UNDER_REVIEW') ? 'warn' : undefined} /><Stat label="Nullified" value={b('NULLIFIED')} tone={b('NULLIFIED') ? 'bad' : undefined} />
      </div>
      <div className="mb-5 grid grid-cols-1 gap-5 lg:grid-cols-2">
        <Card><CardHeader title="Eligible but not booked" subtitle="Nudge students before slots run out" right={<Button size="sm" variant="ghost" onClick={() => nav({ name: 'admin-students', id: 'unbooked' })}>All</Button>} />
          {unbooked.length === 0 ? <Empty title="Everyone eligible has booked" /> : <ul className="divide-y divide-slate-100">{unbooked.slice(0, 5).map(r => (
            <li key={r.id} className="flex items-center gap-3 px-5 py-2.5 text-[13px]"><div className="min-w-0 flex-1"><div className="font-semibold text-slate-900">{r.name}</div><div className="text-[12px] text-slate-500">{badgeLabel(db, r.j.badgeDef.id)} · {r.eligibleSince ? `eligible ${Math.max(0, Math.round((now.getTime() - new Date(r.eligibleSince).getTime()) / DAY))} days` : ''}</div></div><JourneyPill s={r.j.state} /><Button size="sm" variant="secondary" icon={<LuBell size={13} />} onClick={() => act(d => S.nudgeStudent(d, me.id, r.id), `Reminder sent to ${r.name}`)}>Nudge</Button></li>
          ))}</ul>}
        </Card>
        <Card><CardHeader title="Outcomes waiting to be recorded" subtitle="Interview time has passed, no result yet" />
          {pendingOutcome.length === 0 ? <Empty title="No pending outcomes" /> : <ul className="divide-y divide-slate-100">{pendingOutcome.map(a => (
            <li key={a.id} className="flex items-center gap-3 px-5 py-2.5 text-[13px]"><div className="min-w-0 flex-1"><div className="font-semibold text-slate-900">{studentName(db, a.studentId)}</div><div className="text-[12px] text-slate-500">{interviewerName(db, a.interviewerId)} · {fmtDateTime(slotOfAttempt(db, a)!.startAt)}</div></div><InterviewPill s={a.interviewStatus} /><Button size="sm" variant="secondary" onClick={() => act(d => S.remindInterviewer(d, me.id, a.id), 'Reminder sent to interviewer')}>Remind</Button>
              {a.interviewStatus === 'SCHEDULED' && <Button size="sm" variant="ghost" onClick={() => act(d => S.markInterviewerNoShow(d, me.id, a.id), 'Marked interviewer no-show; student gets priority rebooking')}>Interviewer no-show</Button>}</li>
          ))}</ul>}
        </Card>
      </div>
      <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
        <Card><CardHeader title="Booking funnel" subtitle="Students who ever reached each stage" /><div className="px-5 py-4"><HBars data={[{ label: 'Became eligible', value: everEligible }, { label: 'Booked an interview', value: everBooked }, { label: 'Attended an interview', value: interviewed }, { label: 'Earned a badge', value: passed }]} /></div></Card>
        <Card><CardHeader title="Interview outcomes" subtitle={`${completed.length} completed interviews`} /><div className="px-5 py-4"><HBars data={outcomes} /></div></Card>
        <Card><CardHeader title="Interview volume" subtitle="Last 20 days and next 7 days" /><div className="px-5 pb-4 pt-5"><Columns data={volume} /></div></Card>
        <Card><CardHeader title="Interviewer utilisation" subtitle="Booked share of slots in the next 14 days" /><div className="px-5 py-4"><HBars data={util} max={100} suffix="%" /><p className="mt-4 text-[12px] text-slate-500">{cancellations} cancellations · {noShows} no-shows to date</p></div></Card>
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════
// STUDENTS
// ═══════════════════════════════════════════════════════════
export function AdminStudents({ preset }: { preset?: string }) {
  const { db, act, me, toast } = useApp();
  const [q, setQ] = useState(''); const [track, setTrack] = useState('all'); const [seg, setSeg] = useState(preset === 'unbooked' ? 'unbooked' : 'all');
  const [state, setState] = useState('all'); const [badge, setBadge] = useState('all'); const [page, setPage] = useState(1);
  const [open, setOpen] = useState<ID | null>(null);
  const all = studentRows(db);
  const filtered = all.filter(r => (!q || `${r.name} ${r.code}`.toLowerCase().includes(q.toLowerCase())) && (track === 'all' || r.trackId === track) && (state === 'all' || r.j.state === state)
    && (seg === 'all' || (seg === 'eligible' && isEligibleNow(r.j)) || (seg === 'booked' && isBooked(r.j)) || (seg === 'unbooked' && isEligibleNow(r.j) && !isBooked(r.j)))
    && (badge === 'all' || (badge === 'none' ? !db.studentBadges.some(b => b.studentId === r.id) : db.studentBadges.some(b => b.studentId === r.id && b.status === badge))));
  const { sorted, header } = useSort(filtered, { name: r => r.name, state: r => JOURNEY_LABEL[r.j.state], since: r => r.eligibleSince ?? 'z', skills: r => r.j.eligibility.required.filter(x => x.cleared).length }, 'name');
  const per = 10; const pages = Math.ceil(sorted.length / per); const pageRows = sorted.slice((page - 1) * per, page * per);
  const counts = { all: all.length, eligible: all.filter(r => isEligibleNow(r.j)).length, booked: all.filter(r => isBooked(r.j)).length, unbooked: all.filter(r => isEligibleNow(r.j) && !isBooked(r.j)).length };
  const copyCsv = async () => {
    const lines = [['Name', 'Student ID', 'Track', 'Badge', 'Status', 'Booked', 'Last outcome'].join(','), ...sorted.map(r => [r.name, r.code, r.track, r.j.badgeDef.level, JOURNEY_LABEL[r.j.state], isBooked(r.j) ? 'Yes' : 'No', r.lastOutcome ?? ''].map(v => `"${v}"`).join(','))];
    try { await navigator.clipboard.writeText(lines.join('\n')); toast?.('ok', `Copied ${sorted.length} rows as CSV`); } catch { toast?.('err', 'Clipboard is blocked in this browser'); }
  };
  return (
    <div data-testid="admin-students">
      <PageHeader title="Students" subtitle="Who is eligible, who has booked, and who hasn't" right={<Button variant="secondary" icon={<LuCopy size={14} />} onClick={copyCsv}>Copy CSV</Button>} />
      <div className="mb-4"><Tabs value={seg} onChange={v => { setSeg(v); setPage(1); }} items={[['all', `All (${counts.all})`], ['eligible', `Eligible (${counts.eligible})`], ['booked', `Booked (${counts.booked})`], ['unbooked', `Eligible, not booked (${counts.unbooked})`]]} /></div>
      <Card>
        <div className="flex flex-wrap items-center gap-2 border-b border-slate-100 px-4 py-3">
          <div className="relative"><LuSearch size={14} className="absolute left-2.5 top-2.5 text-slate-400" /><input aria-label="Search students" className={cx(inputCls, 'h-9 w-56 py-1 pl-8')} placeholder="Search name or ID" value={q} onChange={e => { setQ(e.target.value); setPage(1); }} /></div>
          <Select label="Track" value={track} onChange={v => { setTrack(v); setPage(1); }} options={[['all', 'All tracks'], ...db.tracks.map(t => [t.id, t.name] as [string, string])]} />
          <Select label="Status" value={state} onChange={v => { setState(v); setPage(1); }} options={[['all', 'All statuses'], ...Object.entries(JOURNEY_LABEL) as [string, string][]]} />
          <Select label="Badge" value={badge} onChange={v => { setBadge(v); setPage(1); }} options={[['all', 'Any badge status'], ['none', 'No badge'], ['EARNED', 'Earned'], ['UNDER_REVIEW', 'Under review'], ['NULLIFIED', 'Nullified']]} />
        </div>
        <Table head={[header('name', 'Student'), 'Track · badge', header('skills', 'Skills'), header('state', 'Status'), 'Booking', 'Last result', header('since', 'Eligible since'), '']} empty={<Empty title="No students match these filters" />}>
          {pageRows.map(r => {
            const sb = db.studentBadges.filter(b => b.studentId === r.id);
            const req = r.j.eligibility.required;
            return (
              <tr key={r.id} className="cursor-pointer hover:bg-slate-50" onClick={() => setOpen(r.id)} data-testid="student-row">
                <Td><div className="font-semibold text-slate-900">{r.name}</div><div className="text-[12px] text-slate-500">{r.code}</div></Td>
                <Td><div>{r.track}</div><div className="text-[12px] text-slate-500">{r.j.badgeDef.level}{sb.length > 0 && <span className="ml-1 inline-flex gap-1 align-middle">{sb.map(b => <BadgePill key={b.id} s={b.status} />)}</span>}</div></Td>
                <Td className="tabular-nums">{req.filter(x => x.cleared).length}/{req.length}</Td>
                <Td><JourneyPill s={r.j.state} /></Td>
                <Td>{r.j.activeBooking ? <span className="text-[12.5px]">{fmtDateTime(db.slots.find(s => s.id === r.j.activeBooking!.slotId)!.startAt)}</span> : isEligibleNow(r.j) ? <Pill tone="amber">Not booked</Pill> : <span className="text-slate-400">—</span>}</Td>
                <Td>{r.lastOutcome ? <OutcomePill o={r.lastOutcome as never} /> : <span className="text-slate-400">—</span>}</Td>
                <Td className="text-[12.5px]">{r.eligibleSince ? fmtDateShort(r.eligibleSince) : '—'}</Td>
                <Td>{isEligibleNow(r.j) && !isBooked(r.j) && r.j.canBook && <Button size="sm" variant="secondary" onClick={e => { e.stopPropagation(); act(d => S.nudgeStudent(d, me.id, r.id), `Reminder sent to ${r.name}`); }}>Nudge</Button>}</Td>
              </tr>
            );
          })}
        </Table>
        <Pager page={page} pages={pages} total={sorted.length} onPage={setPage} />
      </Card>
      {open && <StudentDrawer id={open} onClose={() => setOpen(null)} />}
    </div>
  );
}

function StudentDrawer({ id, onClose }: { id: ID; onClose: () => void }) {
  const { db, act, me } = useApp();
  const st = db.students.find(s => s.id === id)!;
  const atts = db.attempts.filter(a => a.studentId === id).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  const j = deriveJourney(db, id, currentBadgeDefId(db, id));
  return (
    <Modal open onClose={onClose} wide title={nameOf(db, st.userId)}>
      <div className="mb-4 flex flex-wrap items-center gap-2 text-[13px] text-slate-600">{st.studentCode} · {st.campus} · <JourneyPill s={j.state} /></div>
      <div className="mb-4 text-[12px] font-semibold uppercase tracking-wide text-slate-500">Interview attempts</div>
      {atts.length === 0 ? <p className="text-[13px] text-slate-500">No interviews yet.</p> : (
        <ul className="space-y-2">{atts.map(a => { const s = slotOfAttempt(db, a); const bk = db.bookings.find(b => b.id === a.bookingId)!; return (
          <li key={a.id} className="rounded-lg border border-slate-200 p-3 text-[13px]">
            <div className="flex flex-wrap items-center gap-2"><span className="font-semibold">Attempt {a.attemptNumber}</span><span className="text-slate-500">{s && fmtDateTime(s.startAt)} · {interviewerName(db, a.interviewerId)}</span><span className="ml-auto flex gap-1.5"><BookingPill s={bk.status} /><InterviewPill s={a.interviewStatus} /><AttendancePill a={a.attendance} />{a.outcome !== 'PENDING' && <OutcomePill o={a.outcome} />}</span></div>
            {bk.status === 'BOOKED' && a.interviewStatus === 'SCHEDULED' && <div className="mt-2 flex gap-2"><Button size="sm" variant="danger" onClick={() => act(d => S.cancelBooking(d, me.id, bk.id, 'Cancelled by ops'), 'Booking cancelled (ops override)')}>Cancel booking</Button>{s && new Date(s.endAt) < clock.now() && <Button size="sm" variant="secondary" onClick={() => act(d => S.markInterviewerNoShow(d, me.id, a.id), 'Interviewer no-show recorded')}>Interviewer no-show</Button>}</div>}
          </li>
        ); })}</ul>
      )}
    </Modal>
  );
}

// ═══════════════════════════════════════════════════════════
// BOOKINGS
// ═══════════════════════════════════════════════════════════
export function AdminBookings() {
  const { db, act, me } = useApp();
  const [status, setStatus] = useState('BOOKED'); const [q, setQ] = useState(''); const [page, setPage] = useState(1);
  const [cancelId, setCancelId] = useState<ID | null>(null); const [reason, setReason] = useState('');
  const [reschedId, setReschedId] = useState<ID | null>(null);
  const rows = db.bookings.filter(b => (status === 'all' || b.status === status) && (!q || studentName(db, b.studentId).toLowerCase().includes(q.toLowerCase())))
    .map(b => ({ b, slot: db.slots.find(s => s.id === b.slotId)! })).sort((x, y) => x.slot.startAt.localeCompare(y.slot.startAt));
  const per = 12; const pages = Math.ceil(rows.length / per);
  const grandfathered = db.bookings.filter(b => b.status === 'BOOKED' && !deriveJourney(db, b.studentId, b.badgeDefId).eligibility.eligible);
  const rb = reschedId ? db.bookings.find(b => b.id === reschedId) : undefined;
  return (
    <div>
      <PageHeader title="Bookings" subtitle="Ops can cancel or move any booking. Overrides ignore the student cutoff and are audited." />
      {grandfathered.length > 0 && <div className="mb-4"><Callout tone="amber" icon={<LuTriangleAlert size={18} className="text-amber-700" />} title={`${grandfathered.length} booking(s) no longer meet the current skill requirements`}>Requirements changed after these students booked. They are grandfathered (eligibility is locked at booking time) — review if needed: {grandfathered.map(b => studentName(db, b.studentId)).join(', ')}.</Callout></div>}
      <Card>
        <div className="flex flex-wrap items-center gap-2 border-b border-slate-100 px-4 py-3">
          <div className="relative"><LuSearch size={14} className="absolute left-2.5 top-2.5 text-slate-400" /><input aria-label="Search bookings" className={cx(inputCls, 'h-9 w-56 py-1 pl-8')} placeholder="Search student" value={q} onChange={e => { setQ(e.target.value); setPage(1); }} /></div>
          <Select label="Status" value={status} onChange={v => { setStatus(v); setPage(1); }} options={[['all', 'All bookings'], ['BOOKED', 'Active'], ['COMPLETED', 'Completed'], ['RESCHEDULED', 'Rescheduled'], ['CANCELLED', 'Cancelled']]} />
        </div>
        <Table head={['When', 'Student', 'Interviewer', 'Badge', 'Status', 'Notes', '']} empty={<Empty title="No bookings" />}>
          {rows.slice((page - 1) * per, page * per).map(({ b, slot }) => (
            <tr key={b.id} className="hover:bg-slate-50"><Td className="whitespace-nowrap">{fmtDateTime(slot.startAt)}</Td><Td className="font-semibold text-slate-900">{studentName(db, b.studentId)}</Td><Td>{interviewerName(db, slot.interviewerId)}</Td><Td>{badgeLabel(db, b.badgeDefId)}</Td><Td><BookingPill s={b.status} /></Td>
              <Td className="text-[12px] text-slate-500">{b.priorityRebook ? 'Interviewer unavailable · priority rebook' : b.cancellationReason ?? (b.rescheduledFromId ? 'Rescheduled booking' : '')}</Td>
              <Td>{b.status === 'BOOKED' && new Date(slot.startAt) > clock.now() && <div className="flex gap-1.5"><Button size="sm" variant="secondary" onClick={() => setReschedId(b.id)}>Move</Button><Button size="sm" variant="danger" onClick={() => setCancelId(b.id)}>Cancel</Button></div>}</Td></tr>
          ))}
        </Table>
        <Pager page={page} pages={pages} total={rows.length} onPage={setPage} />
      </Card>
      <Modal open={!!cancelId} onClose={() => setCancelId(null)} title="Cancel booking (ops override)" footer={<><Button variant="secondary" onClick={() => setCancelId(null)}>Back</Button><Button variant="danger" onClick={() => { if (act(d => S.cancelBooking(d, me.id, cancelId!, reason || 'Cancelled by ops'), 'Booking cancelled; student notified') !== undefined) setCancelId(null); }}>Cancel booking</Button></>}>
        <Field label="Reason (shown in the audit log)"><input className={inputCls} value={reason} onChange={e => setReason(e.target.value)} /></Field>
      </Modal>
      <Modal open={!!rb} onClose={() => setReschedId(null)} title="Move booking to another slot" wide>
        {rb && (() => { const opts = S.bookableSlots(db, rb.studentId).slice(0, 40); return opts.length === 0 ? <Empty title="No open slots" /> : (
          <div className="grid max-h-[50vh] grid-cols-2 gap-2 overflow-auto sm:grid-cols-3">{opts.map(s => (
            <button key={s.id} className="rounded-lg border border-slate-200 px-3 py-2 text-left text-[13px] hover:border-slate-500" onClick={() => { if (act(d => S.rescheduleBooking(d, me.id, rb.id, s.id), 'Booking moved; student notified') !== undefined) setReschedId(null); }}>
              <div className="font-semibold">{fmtDateShort(s.startAt)} · {fmtTime(s.startAt)}</div><div className="text-[12px] text-slate-500">{interviewerName(db, s.interviewerId)}</div></button>
          ))}</div>
        ); })()}
      </Modal>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════
// INTERVIEWERS
// ═══════════════════════════════════════════════════════════
export function AdminInterviewers() {
  const { db, act, me } = useApp(); const now = clock.now(); const horizon = now.getTime() + 14 * DAY;
  return (
    <div>
      <PageHeader title="Interviewers" subtitle="Availability and load over the next 14 days" />
      <Card><Table head={['Interviewer', 'Specialisation', 'Open slots', 'Booked', 'Utilisation', 'Completed', 'Pending outcomes', 'Status']}>
        {db.interviewers.map(iv => {
          const s = db.slots.filter(x => x.interviewerId === iv.id && new Date(x.startAt) > now && new Date(x.startAt).getTime() < horizon);
          const open = s.filter(x => x.status === 'OPEN').length; const booked = s.filter(x => x.status === 'BOOKED').length;
          const atts = db.attempts.filter(a => a.interviewerId === iv.id);
          const pend = atts.filter(a => a.interviewStatus !== 'COMPLETED' && a.interviewStatus !== 'CANCELLED' && new Date(slotOfAttempt(db, a)!.endAt) < now).length;
          const u = open + booked ? Math.round(100 * booked / (open + booked)) : 0;
          return (
            <tr key={iv.id} className="hover:bg-slate-50"><Td><div className="font-semibold text-slate-900">{nameOf(db, iv.userId)}</div><div className="text-[12px] text-slate-500">{iv.employeeCode}</div></Td><Td>{iv.specialization}</Td><Td className="tabular-nums">{open}</Td><Td className="tabular-nums">{booked}</Td>
              <Td><div className="flex items-center gap-2"><div className="h-2 w-20 rounded-full bg-slate-100"><div className="h-full rounded-full bg-indigo-600" style={{ width: `${u}%` }} /></div><span className="tabular-nums">{u}%</span></div></Td>
              <Td className="tabular-nums">{atts.filter(a => a.interviewStatus === 'COMPLETED').length}</Td><Td>{pend ? <Pill tone="amber">{pend}</Pill> : '0'}</Td>
              <Td><Button size="sm" variant={iv.isActive ? 'secondary' : 'teal'} onClick={() => act(d => S.setInterviewerActive(d, me.id, iv.id, !iv.isActive), iv.isActive ? 'Interviewer deactivated; open slots blocked' : 'Interviewer activated')}>{iv.isActive ? 'Active · Deactivate' : 'Inactive · Activate'}</Button></Td></tr>
          );
        })}
      </Table></Card>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════
// MALPRACTICE
// ═══════════════════════════════════════════════════════════
export function AdminMalpractice({ caseId }: { caseId?: ID }) {
  const { db, me, act } = useApp();
  const [tab, setTab] = useState('open'); const [sel, setSel] = useState<ID | undefined>(caseId);
  const [flagOpen, setFlagOpen] = useState(false); const [pickBadge, setPickBadge] = useState(''); const [fDesc, setFDesc] = useState(''); const [fEv, setFEv] = useState('');
  const [note, setNote] = useState(''); const [decision, setDecision] = useState<'CONFIRMED' | 'DISMISSED' | ''>(''); const [reason, setReason] = useState('');
  const isReviewer = !!me.permissions?.reviewMalpractice;
  const cases = db.malpracticeCases.filter(c => tab === 'all' || (tab === 'open' ? c.status === 'FLAGGED' || c.status === 'UNDER_INVESTIGATION' : c.status === 'CONFIRMED' || c.status === 'DISMISSED')).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  const c = db.malpracticeCases.find(x => x.id === (sel ?? cases[0]?.id));
  const sb = c && db.studentBadges.find(b => b.id === c.studentBadgeId);
  const flaggable = db.studentBadges.filter(b => b.status !== 'NULLIFIED');
  return (
    <div data-testid="admin-malpractice">
      <PageHeader title="Malpractice review" subtitle="A flag never nullifies a badge by itself. Only an authorised reviewer can confirm, after an investigation." right={<Button variant="danger" icon={<LuFlag size={14} />} onClick={() => { setPickBadge(flaggable[0]?.id ?? ''); setFlagOpen(true); }}>Flag a badge</Button>} />
      {!isReviewer && <div className="mb-4"><Callout tone="gray" icon={<LuLock size={16} className="text-slate-500" />} title="View-only">Your account can raise flags but cannot investigate or decide cases. Sign in as Priya Menon (integrity reviewer) to decide.</Callout></div>}
      <div className="grid grid-cols-1 gap-5 [&>*]:min-w-0 lg:grid-cols-[360px_minmax(0,1fr)]">
        <Card className="h-fit">
          <div className="border-b border-slate-100 p-3"><Tabs value={tab} onChange={v => { setTab(v); setSel(undefined); }} items={[['open', 'Open'], ['closed', 'Decided'], ['all', 'All']]} /></div>
          {cases.length === 0 ? <Empty title="No cases" /> : <ul className="divide-y divide-slate-100">{cases.map(x => (
            <li key={x.id}><button onClick={() => { setSel(x.id); setDecision(''); setReason(''); }} className={cx('w-full px-4 py-3 text-left hover:bg-slate-50', c?.id === x.id && 'bg-indigo-50/60')} data-testid="case-row">
              <div className="flex items-center justify-between gap-2"><span className="text-[13px] font-semibold text-slate-900">{studentName(db, x.studentId)}</span><CasePill s={x.status} /></div>
              <div className="mt-0.5 truncate text-[12px] text-slate-500">{x.description}</div><div className="mt-0.5 text-[11.5px] text-slate-400">{x.id} · {fmtDateShort(x.createdAt)}</div></button></li>
          ))}</ul>}
        </Card>
        {c && sb ? (
          <div className="space-y-5">
            <Card>
              <CardHeader title={`Case ${c.id}`} subtitle={`${studentName(db, c.studentId)} · ${badgeLabel(db, sb.badgeDefId)}`} right={<div className="flex gap-2"><CasePill s={c.status} /><BadgePill s={sb.status} /></div>} />
              <dl className="grid gap-4 px-5 py-4 text-[13px] sm:grid-cols-2">
                <div><dt className="text-[12px] text-slate-500">Reported by</dt><dd className="font-semibold">{nameOf(db, c.reportedBy)}</dd></div>
                <div><dt className="text-[12px] text-slate-500">Evidence reference</dt><dd className="font-semibold">{c.evidenceRef}</dd></div>
                <div className="sm:col-span-2"><dt className="text-[12px] text-slate-500">Allegation</dt><dd>{c.description}</dd></div>
                {c.decisionReason && <div className="sm:col-span-2"><dt className="text-[12px] text-slate-500">Decision reason</dt><dd>{c.decisionReason} <span className="text-slate-500">— {nameOf(db, c.reviewedBy!)}, {fmtDateTime(c.reviewedAt!)}</span></dd></div>}
              </dl>
              {(c.status === 'FLAGGED' || c.status === 'UNDER_INVESTIGATION') && (
                <div className="border-t border-slate-100 px-5 py-4">
                  {c.status === 'FLAGGED' ? (
                    <div className="space-y-3"><Field label="Investigation note (optional)"><input className={inputCls} value={note} onChange={e => setNote(e.target.value)} placeholder="e.g. Requested proctoring recording" /></Field>
                      <div className="flex flex-wrap gap-2"><Button disabled={!isReviewer} onClick={() => act(d => S.startInvestigation(d, me.id, c.id, note), 'Investigation opened')} data-testid="start-investigation">Open investigation</Button><Button variant="secondary" disabled={!isReviewer} onClick={() => { setDecision('DISMISSED'); }}>Dismiss without investigation</Button></div></div>
                  ) : null}
                  {(c.status === 'UNDER_INVESTIGATION' || decision === 'DISMISSED') && (
                    <div className="mt-3 space-y-3" data-testid="decision-form">
                      <div className="text-[13px] font-semibold text-slate-800">Decision</div>
                      <div className="grid gap-2 sm:grid-cols-2">
                        {c.status === 'UNDER_INVESTIGATION' && <button disabled={!isReviewer} onClick={() => setDecision('CONFIRMED')} data-testid="decide-confirm" className={cx('rounded-xl border-2 p-3 text-left disabled:opacity-50', decision === 'CONFIRMED' ? 'border-red-500 bg-red-50' : 'border-slate-200')}><div className="flex items-center gap-1.5 text-sm font-bold"><LuShieldX size={15} className="text-red-700" />Confirm malpractice</div><div className="text-[12px] text-slate-600">Badge will be nullified</div></button>}
                        <button disabled={!isReviewer} onClick={() => setDecision('DISMISSED')} data-testid="decide-dismiss" className={cx('rounded-xl border-2 p-3 text-left disabled:opacity-50', decision === 'DISMISSED' ? 'border-emerald-600 bg-emerald-50' : 'border-slate-200')}><div className="flex items-center gap-1.5 text-sm font-bold"><LuShieldCheck size={15} className="text-emerald-700" />Dismiss</div><div className="text-[12px] text-slate-600">Badge restored if no other open case</div></button>
                      </div>
                      <Field label="Reason" hint="Required (min. 15 characters). The student sees the outcome, not the evidence."><textarea data-testid="decision-reason" className={cx(inputCls, 'min-h-[70px]')} value={reason} onChange={e => setReason(e.target.value)} /></Field>
                      <Button disabled={!decision || !isReviewer} variant={decision === 'CONFIRMED' ? 'danger' : 'primary'} data-testid="record-decision" onClick={() => { if (act(d => S.decideCase(d, me.id, c.id, decision as 'CONFIRMED' | 'DISMISSED', reason), decision === 'CONFIRMED' ? 'Malpractice confirmed — badge nullified' : 'Case dismissed') !== undefined) { setDecision(''); setReason(''); } }}>Record decision</Button>
                    </div>
                  )}
                </div>
              )}
            </Card>
            <div className="grid grid-cols-1 gap-5 md:grid-cols-2">
              <Card><CardHeader title="Investigation timeline" /><ol className="space-y-3 px-5 py-4">{c.timeline.map((t, i) => <li key={i} className="flex gap-3 text-[13px]"><span className="mt-1.5 h-2 w-2 shrink-0 rounded-full bg-indigo-500" /><div><div className="font-semibold text-slate-800">{t.action}</div><div className="text-[12px] text-slate-500">{nameOf(db, t.by)} · {fmtDateTime(t.at)}</div>{t.note && <div className="mt-0.5 text-slate-600">{t.note}</div>}</div></li>)}</ol></Card>
              <Card><CardHeader title="Badge history" subtitle="Never deleted — nullification is a status change" /><ol className="space-y-3 px-5 py-4">{sb.history.map((h, i) => <li key={i} className="flex gap-3 text-[13px]"><span className="mt-1.5 h-2 w-2 shrink-0 rounded-full bg-slate-400" /><div><div className="font-semibold text-slate-800">{h.from ? `${h.from.replace('_', ' ').toLowerCase()} → ` : ''}{h.to.replace('_', ' ').toLowerCase()}</div><div className="text-[12px] text-slate-500">{h.note} · {fmtDateTime(h.at)}</div></div></li>)}</ol>
                <div className="border-t border-slate-100 px-5 py-3 text-[12px] text-slate-500">{db.malpracticeCases.filter(x => x.studentBadgeId === sb.id).length} case(s) on this badge</div></Card>
            </div>
          </div>
        ) : <Card><Empty title="Select a case" /></Card>}
      </div>
      <Modal open={flagOpen} onClose={() => setFlagOpen(false)} title="Flag possible malpractice" footer={<><Button variant="secondary" onClick={() => setFlagOpen(false)}>Cancel</Button><Button variant="danger" data-testid="raise-flag" onClick={() => { const id = act(d => S.flagMalpractice(d, me.id, pickBadge, fDesc, fEv), 'Flag raised — badge moved to under review'); if (id !== undefined) { setFlagOpen(false); setFDesc(''); setFEv(''); setTab('open'); setSel(id); } }}>Raise flag</Button></>}>
        <Callout tone="amber" title="A flag is not a decision">The badge moves to “under review”. Only an authorised integrity reviewer can nullify it, after an investigation.</Callout>
        <div className="mt-3 space-y-3">
          <Field label="Badge"><Select label="Badge" className="w-full" value={pickBadge} onChange={setPickBadge} options={flaggable.map(b => [b.id, `${studentName(db, b.studentId)} — ${badgeLabel(db, b.badgeDefId)} (${b.status.replace('_', ' ').toLowerCase()})`] as [string, string])} /></Field>
          <Field label="What happened?"><textarea data-testid="flag-desc" className={cx(inputCls, 'min-h-[80px]')} value={fDesc} onChange={e => setFDesc(e.target.value)} /></Field>
          <Field label="Evidence reference" hint="Link or ID — evidence is never shown to the student."><input className={inputCls} value={fEv} onChange={e => setFEv(e.target.value)} /></Field>
        </div>
      </Modal>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════
// AUDIT LOG
// ═══════════════════════════════════════════════════════════
export function AdminAudit() {
  const { db } = useApp();
  const [entity, setEntity] = useState('all'); const [q, setQ] = useState(''); const [page, setPage] = useState(1);
  const entities = [...new Set(db.auditLogs.map(l => l.entityType))].sort();
  const rows = db.auditLogs.filter(l => (entity === 'all' || l.entityType === entity) && (!q || `${l.action} ${l.entityId} ${nameOf(db, l.actorId)}`.toLowerCase().includes(q.toLowerCase()))).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  const per = 15; const pages = Math.ceil(rows.length / per);
  const show = (v: unknown) => v === undefined ? '' : typeof v === 'string' ? v : JSON.stringify(v).slice(0, 80);
  return (
    <div>
      <PageHeader title="Audit log" subtitle="Every state change is written in the same transaction as the change itself." />
      <Card>
        <div className="flex flex-wrap items-center gap-2 border-b border-slate-100 px-4 py-3">
          <div className="relative"><LuSearch size={14} className="absolute left-2.5 top-2.5 text-slate-400" /><input aria-label="Search audit log" className={cx(inputCls, 'h-9 w-64 py-1 pl-8')} placeholder="Search action, entity or person" value={q} onChange={e => { setQ(e.target.value); setPage(1); }} /></div>
          <Select label="Entity" value={entity} onChange={v => { setEntity(v); setPage(1); }} options={[['all', 'All entities'], ...entities.map(e => [e, e] as [string, string])]} />
        </div>
        <Table head={['Time', 'Actor', 'Action', 'Entity', 'Change']}>
          {rows.slice((page - 1) * per, page * per).map(l => (
            <tr key={l.id}><Td className="whitespace-nowrap text-[12.5px]">{fmtDateTime(l.createdAt)}</Td><Td>{l.actorId === 'system' ? 'System' : nameOf(db, l.actorId)}</Td><Td><code className="rounded bg-slate-100 px-1.5 py-0.5 text-[12px]">{l.action}</code></Td><Td className="text-[12.5px]">{l.entityType} · <span className="text-slate-500">{l.entityId}</span></Td>
              <Td className="max-w-[320px] truncate text-[12.5px] text-slate-600">{show(l.oldValue)}{l.oldValue !== undefined && ' → '}{show(l.newValue)}{l.metadata?.reason ? ` · “${String(l.metadata.reason)}”` : ''}</Td></tr>
          ))}
        </Table>
        <Pager page={page} pages={pages} total={rows.length} onPage={setPage} />
      </Card>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════
// SETTINGS
// ═══════════════════════════════════════════════════════════
const POLICY_FIELDS: [keyof Policies, string, string][] = [
  ['interviewDurationMin', 'Interview duration (min)', 'Applies to newly created slots'],
  ['slotBufferMin', 'Buffer between interviews (min)', ''],
  ['minBookingLeadHours', 'Minimum booking notice (hours)', 'Slots sooner than this are hidden'],
  ['cancelRescheduleCutoffHours', 'Cancel / reschedule cutoff (hours)', 'Students only; ops can override'],
  ['maxReschedulesPerBooking', 'Max reschedules per booking', ''],
  ['retakeCooldownDays', 'Retake-later cooldown (days)', ''],
  ['failCooldownDays', 'Fail cooldown (days)', ''],
  ['maxAttemptsPerBadge', 'Max attempts per badge', 'Interviewer no-shows and cancellations never count'],
  ['studentNoShowCooldownDays', 'Student no-show cooldown (days)', ''],
  ['outcomeEditWindowHours', 'Interviewer result-correction window (hours)', ''],
  ['bookingHorizonDays', 'Booking horizon (days)', ''],
];
export function AdminSettings() {
  const { db, act, me } = useApp();
  const [p, setP] = useState<Policies>(db.policies);
  const canEdit = !!me.permissions?.editSettings;
  return (
    <div>
      <PageHeader title="Policies & settings" />
      <div className="mb-5"><Callout tone="amber" icon={<LuTriangleAlert size={18} className="text-amber-700" />} title="Illustrative assumptions, not confirmed GRIT policy">These defaults were chosen for the prototype (e.g. the 5-day retake cooldown mirrors GRIT's published 5-day gap for skill re-attempts). Every value is configurable here and every change is audited.</Callout></div>
      <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
        <Card><CardHeader title="Scheduling & attempt policy" right={!canEdit && <Pill>Read-only</Pill>} />
          <form className="grid gap-3 px-5 py-4 sm:grid-cols-2" onSubmit={e => { e.preventDefault(); act(d => S.updatePolicies(d, me.id, p), 'Policies saved'); }}>
            {POLICY_FIELDS.map(([k, l, h]) => <Field key={k} label={l} hint={h || undefined}><input type="number" min={0} disabled={!canEdit} className={inputCls} value={p[k] as number} onChange={e => setP({ ...p, [k]: Number(e.target.value) })} /></Field>)}
            <Field label="Student no-show counts as an attempt"><Select className="w-full" value={p.studentNoShowCountsAsAttempt ? 'yes' : 'no'} onChange={v => setP({ ...p, studentNoShowCountsAsAttempt: v === 'yes' })} options={[['yes', 'Yes'], ['no', 'No']]} /></Field>
            <div className="flex items-end sm:col-span-2"><Button type="submit" disabled={!canEdit}>Save policies</Button></div>
          </form></Card>
        <div className="space-y-5">
          <Card><CardHeader title="Badge requirements" subtitle="Students who already booked keep their booking (grandfathered)." />
            <div className="space-y-4 px-5 py-4">{db.tracks.map(t => (
              <div key={t.id}><div className="mb-2 text-[13px] font-semibold text-slate-900">{t.name}</div>
                <div className="overflow-x-auto"><table className="text-[12.5px]"><thead><tr><th className="pr-4 text-left font-medium text-slate-500">Skill</th>{db.badgeDefs.filter(b => b.trackId === t.id).map(b => <th key={b.id} className="px-3 font-medium text-slate-500">{b.level}</th>)}</tr></thead>
                  <tbody>{db.skills.filter(s => s.trackId === t.id).map(s => <tr key={s.id}><td className="py-1 pr-4 text-slate-700">{s.name}</td>{db.badgeDefs.filter(b => b.trackId === t.id).map(b => { const on = db.badgeSkillReqs.some(r => r.badgeDefId === b.id && r.skillId === s.id); return <td key={b.id} className="px-3 text-center"><input type="checkbox" aria-label={`${s.name} required for ${b.level}`} disabled={!canEdit} checked={on} onChange={() => act(d => S.setSkillRequired(d, me.id, b.id, s.id, !on), 'Requirements updated; eligibility re-evaluated')} /></td>; })}</tr>)}</tbody></table></div></div>
            ))}</div></Card>
          <Card><CardHeader title="Demo controls" subtitle="Simulate infrastructure failures" />
            <div className="flex items-center justify-between px-5 py-4 text-[13px]"><div><div className="font-semibold text-slate-800">Simulate notification delivery failure</div><div className="text-slate-500">New notifications are marked “delivery failed”; the underlying action still succeeds.</div></div>
              <Button size="sm" variant={db.simulateNotificationFailure ? 'danger' : 'secondary'} onClick={() => act(d => { d.simulateNotificationFailure = !d.simulateNotificationFailure; }, db.simulateNotificationFailure ? 'Notifications back to normal' : 'Notification failures simulated')}>{db.simulateNotificationFailure ? 'On' : 'Off'}</Button></div></Card>
        </div>
      </div>
    </div>
  );
}

