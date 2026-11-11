import React, { useCallback, useEffect, useMemo, useState, useSyncExternalStore } from 'react';
import { LuBadgeCheck, LuBell, LuCalendarCheck, LuCalendarDays, LuClipboardList, LuFileClock, LuGraduationCap, LuHistory, LuHouse, LuLayoutDashboard, LuLogOut, LuRotateCcw, LuSettings, LuShieldAlert, LuSparkles, LuUsers, LuUserCog, LuCircleCheck, LuCircleX, LuArrowRight, LuSplit } from 'react-icons/lu';
import { DomainError } from '../domain/core';
import { currentBadgeDefId, deriveJourney, JOURNEY_LABEL } from '../domain/eligibility';
import { createSeed, DEMO_ACCOUNTS } from '../domain/seed';
import { Store } from '../domain/store';
import type { DB, Role, User } from '../domain/types';
import { AdminAudit, AdminBookings, AdminInterviewers, AdminMalpractice, AdminOverview, AdminSettings, AdminStudents } from './admin';
import { InterviewerAvailability, InterviewerHistory, InterviewerInterview, InterviewerSchedule } from './interviewer';
import { AppCtx, Button, Card, Empty, Modal, Pill, cx, type Ctx, type View } from './kit';
import { Showcase } from './showcase';
import { NotificationsPage, StudentBadges, StudentBook, StudentHome, StudentInterviews } from './student';

// ── Persistence: this browser only (each evaluator gets a private sandbox) ──
const DB_KEY = 'grit-hub-db-v3'; const SESSION_KEY = 'grit-hub-session-v3';
const safeGet = (k: string) => { try { return localStorage.getItem(k); } catch { return null; } };
const safeSet = (k: string, v: string | null) => { try { if (v === null) localStorage.removeItem(k); else localStorage.setItem(k, v); } catch { /* storage unavailable */ } };
function loadDb(): DB { const raw = safeGet(DB_KEY); if (raw) { try { const db = JSON.parse(raw) as DB; if (db?.users?.length) return db; } catch { /* corrupt → reseed */ } } return createSeed(); }
const store = new Store(loadDb(), db => safeSet(DB_KEY, JSON.stringify(db)));
// Another tab committed → adopt its data (the next commit from a stale draft in this tab is rejected with CONFLICT).
if (typeof window !== 'undefined') window.addEventListener('storage', e => { if (e.key === DB_KEY && e.newValue) { try { store.replace(JSON.parse(e.newValue)); } catch { /* ignore */ } } });

const HOME: Record<Role, string> = { STUDENT: 'student-home', INTERVIEWER: 'interviewer-schedule', ADMIN: 'admin-overview' };
const NAV: Record<Role, [string, string, React.ReactNode][]> = {
  STUDENT: [['student-home', 'Home', <LuHouse size={17} />], ['student-book', 'Book interview', <LuCalendarCheck size={17} />], ['student-interviews', 'My interviews', <LuHistory size={17} />], ['student-badges', 'Badges', <LuBadgeCheck size={17} />], ['notifications', 'Notifications', <LuBell size={17} />]],
  INTERVIEWER: [['interviewer-schedule', 'Schedule', <LuCalendarDays size={17} />], ['interviewer-availability', 'Availability', <LuClipboardList size={17} />], ['interviewer-history', 'History', <LuHistory size={17} />], ['notifications', 'Notifications', <LuBell size={17} />]],
  ADMIN: [['admin-overview', 'Overview', <LuLayoutDashboard size={17} />], ['admin-students', 'Students', <LuGraduationCap size={17} />], ['admin-bookings', 'Bookings', <LuCalendarCheck size={17} />], ['admin-interviewers', 'Interviewers', <LuUsers size={17} />], ['admin-malpractice', 'Malpractice', <LuShieldAlert size={17} />], ['admin-audit', 'Audit log', <LuFileClock size={17} />], ['admin-settings', 'Settings', <LuSettings size={17} />]],
};
const ROLE_PREFIX: Record<Role, string> = { STUDENT: 'student-', INTERVIEWER: 'interviewer-', ADMIN: 'admin-' };
const SHARED = ['notifications', 'showcase'];

function readHash(): View { const h = (typeof location !== 'undefined' ? location.hash.slice(1) : '') || ''; return { name: h }; }

interface Toast { id: number; kind: 'ok' | 'err'; text: string }

export function App() {
  const db = useSyncExternalStore(l => store.subscribe(l), () => store.snapshot);
  const [userId, setUserId] = useState<string | null>(() => safeGet(SESSION_KEY));
  const [view, setView] = useState<View>(readHash);
  const [toasts, setToasts] = useState<Toast[]>([]);
  const [resetOpen, setResetOpen] = useState(false);
  const me = userId ? db.users.find(u => u.id === userId) : undefined;

  const toast = useCallback((kind: 'ok' | 'err', text: string) => {
    const id = Date.now() + Math.random(); setToasts(t => [...t, { id, kind, text }]);
    setTimeout(() => setToasts(t => t.filter(x => x.id !== id)), kind === 'err' ? 6000 : 3500);
  }, []);
  const nav = useCallback((v: View) => { setView(v); try { if (location.hash.slice(1) !== v.name) history.replaceState(null, '', `#${v.name}`); } catch { /* sandboxed */ } window.scrollTo?.(0, 0); }, []);
  useEffect(() => { const h = () => setView(v => (readHash().name === v.name ? v : readHash())); window.addEventListener('hashchange', h); return () => window.removeEventListener('hashchange', h); }, []);

  const login = (id: string) => { safeSet(SESSION_KEY, id); setUserId(id); const u = store.snapshot.users.find(x => x.id === id)!; nav({ name: HOME[u.role] }); };
  const logout = () => { safeSet(SESSION_KEY, null); setUserId(null); nav({ name: '' }); };

  const ctx: Ctx | null = useMemo(() => me ? {
    db, me, nav, toast,
    act: <R,>(fn: (d: DB) => R, ok?: string | ((r: R) => string)) => {
      try { const r = store.run(fn); if (ok) toast('ok', typeof ok === 'function' ? ok(r) : ok); return (r === undefined ? null : r) as R; }
      catch (e) { toast('err', e instanceof DomainError ? e.message : 'Something went wrong — nothing was saved. Please try again.'); if (!(e instanceof DomainError)) console.error(e); return undefined; }
    },
  } : null, [db, me, nav, toast]);

  if (!me || !ctx) return <Login db={db} onLogin={login} />;

  const name = view.name || HOME[me.role];
  const allowed = SHARED.includes(name) || name.startsWith(ROLE_PREFIX[me.role]);
  const unread = db.notifications.filter(n => n.userId === me.id && !n.isRead).length;

  let page: React.ReactNode;
  if (!allowed) page = <Card><Empty title="You don't have access to this page" body={`This area is for ${name.split('-')[0]}s. You're signed in as ${me.role.toLowerCase()}.`} action={<Button onClick={() => nav({ name: HOME[me.role] })}>Go to my home</Button>} /></Card>;
  else switch (name) {
    case 'student-home': page = <StudentHome />; break;
    case 'student-book': page = <StudentBook key={view.id ?? 'new'} rescheduleId={view.id} />; break;
    case 'student-interviews': page = <StudentInterviews />; break;
    case 'student-badges': page = <StudentBadges />; break;
    case 'notifications': page = <NotificationsPage />; break;
    case 'showcase': page = <Showcase />; break;
    case 'interviewer-schedule': page = <InterviewerSchedule />; break;
    case 'interviewer-interview': page = view.id ? <InterviewerInterview key={view.id} id={view.id} /> : <InterviewerSchedule />; break;
    case 'interviewer-availability': page = <InterviewerAvailability />; break;
    case 'interviewer-history': page = <InterviewerHistory />; break;
    case 'admin-overview': page = <AdminOverview />; break;
    case 'admin-students': page = <AdminStudents key={view.id ?? 'all'} preset={view.id} />; break;
    case 'admin-bookings': page = <AdminBookings />; break;
    case 'admin-interviewers': page = <AdminInterviewers />; break;
    case 'admin-malpractice': page = <AdminMalpractice />; break;
    case 'admin-audit': page = <AdminAudit />; break;
    case 'admin-settings': page = <AdminSettings />; break;
    default: page = <Card><Empty title="Page not found" action={<Button onClick={() => nav({ name: HOME[me.role] })}>Go home</Button>} /></Card>;
  }

  return (
    <AppCtx.Provider value={ctx}>
      <div className="min-h-screen bg-lionsmane text-slate-900 lg:flex">
        <aside className="sticky top-0 z-30 border-b border-navy-800 bg-navy-900 text-celeste lg:h-screen lg:w-60 lg:shrink-0 lg:border-b-0 lg:border-r">
          <div className="flex items-center gap-2.5 px-5 py-4 lg:py-5"><Logo /><div><div className="text-[15px] font-bold leading-tight text-white">GRIT Interview Hub</div><div className="text-[11px] text-slate-400">{me.role === 'STUDENT' ? 'Student' : me.role === 'INTERVIEWER' ? 'Interviewer' : 'Interview operations'}</div></div></div>
          <nav className="flex gap-1 overflow-x-auto px-3 pb-3 lg:flex-col lg:overflow-visible lg:pb-0" aria-label="Main">
            {NAV[me.role].map(([v, l, icon]) => (
              <button key={v} onClick={() => nav({ name: v })} className={cx('flex shrink-0 items-center gap-2.5 rounded-lg px-3 py-2 text-[13.5px] font-medium', (name === v || (v === 'interviewer-schedule' && name === 'interviewer-interview')) ? 'bg-celeste/20 text-white' : 'hover:bg-white/5 hover:text-white')}>
                {icon}{l}{v === 'notifications' && unread > 0 && <span className="ml-auto rounded-full bg-marigold px-1.5 text-[11px] font-bold text-midnight">{unread}</span>}
              </button>
            ))}
            <div className="hidden lg:my-3 lg:block lg:border-t lg:border-white/10" />
            <button onClick={() => nav({ name: 'showcase' })} className={cx('flex shrink-0 items-center gap-2.5 rounded-lg px-3 py-2 text-[13.5px] font-medium', name === 'showcase' ? 'bg-marigold/20 text-marigold' : 'text-marigold hover:bg-white/5')}><LuSplit size={17} />Before & after</button>
          </nav>
        </aside>
        <div className="min-w-0 flex-1">
          <header className="flex flex-wrap items-center gap-2 border-b border-slate-200 bg-white px-4 py-2.5 lg:px-8">
            <Pill tone="amber"><span className="sm:hidden">Local demo</span><span className="hidden sm:inline">Local demo · sample data · no backend connected</span></Pill>
            <div className="ml-auto flex min-w-0 flex-wrap items-center justify-end gap-1 sm:gap-2">
              <AccountSwitcher db={db} me={me} onSwitch={login} />
              <Button variant="ghost" size="sm" aria-label="Notifications" onClick={() => nav({ name: 'notifications' })}><LuBell size={16} />{unread > 0 && <span className="text-[12px] font-bold text-indigo-700">{unread}</span>}</Button>
              <Button variant="ghost" size="sm" onClick={() => setResetOpen(true)} icon={<LuRotateCcw size={14} />}><span className="hidden sm:inline">Reset demo</span></Button>
              <Button variant="ghost" size="sm" onClick={logout} icon={<LuLogOut size={14} />}><span className="hidden sm:inline">Sign out</span></Button>
            </div>
          </header>
          <main className="mx-auto max-w-[1280px] px-4 py-6 lg:px-8 lg:py-8">{page}</main>
        </div>
      </div>
      <Modal open={resetOpen} onClose={() => setResetOpen(false)} title="Reset demo data?" footer={<><Button variant="secondary" onClick={() => setResetOpen(false)}>Cancel</Button><Button variant="danger" onClick={() => { store.replace(createSeed()); setResetOpen(false); toast('ok', 'Demo data reset to a fresh sample'); nav({ name: HOME[me.role] }); }}>Reset</Button></>}>
        <p className="text-[13.5px] text-slate-600">All bookings, results and changes you made in this browser are replaced with fresh sample data. Dates are regenerated around today.</p>
      </Modal>
      <div className="pointer-events-none fixed bottom-4 right-4 z-[60] flex w-[min(92vw,380px)] flex-col gap-2" aria-live="polite">
        {toasts.map(t => (
          <div key={t.id} role={t.kind === 'err' ? 'alert' : 'status'} data-testid={t.kind === 'err' ? 'toast-error' : 'toast-ok'} className={cx('pointer-events-auto flex items-start gap-2.5 rounded-xl border px-4 py-3 text-[13px] shadow-lg', t.kind === 'ok' ? 'border-emerald-200 bg-white text-slate-800' : 'border-red-200 bg-red-50 text-red-900')}>
            {t.kind === 'ok' ? <LuCircleCheck size={17} className="mt-px shrink-0 text-emerald-600" /> : <LuCircleX size={17} className="mt-px shrink-0 text-red-600" />}<span>{t.text}</span>
          </div>
        ))}
      </div>
    </AppCtx.Provider>
  );
}

function AccountSwitcher({ db, me, onSwitch }: { db: DB; me: User; onSwitch: (id: string) => void }) {
  return (
    <label className="flex min-w-0 items-center gap-2 text-[13px]">
      <LuUserCog size={15} className="hidden text-slate-500 sm:block" />
      <select aria-label="Switch demo account" value={me.id} onChange={e => onSwitch(e.target.value)} className="h-8 w-[150px] min-w-0 rounded-lg sm:w-auto sm:max-w-[230px] border border-slate-300 bg-white px-2 text-[13px] font-semibold text-slate-800">
        {(['STUDENT', 'INTERVIEWER', 'ADMIN'] as Role[]).map(r => (
          <optgroup key={r} label={r === 'ADMIN' ? 'Ops / admin' : r === 'STUDENT' ? 'Students' : 'Interviewers'}>
            {db.users.filter(u => u.role === r).map(u => <option key={u.id} value={u.id}>{u.fullName}{r === 'STUDENT' ? ` — ${JOURNEY_LABEL[deriveJourney(db, db.students.find(s => s.userId === u.id)!.id, currentBadgeDefId(db, db.students.find(s => s.userId === u.id)!.id)).state]}` : r === 'ADMIN' ? (u.permissions?.reviewMalpractice ? ' — reviewer' : ' — no review rights') : ''}</option>)}
          </optgroup>
        ))}
      </select>
    </label>
  );
}

function Logo() {
  return <svg width="32" height="32" viewBox="0 0 48 48" aria-hidden><path d="M24 3l17 9.5v19L24 41 7 31.5v-19z" fill="#F4A258" /><path d="M17 24.5l5 5 9.5-10" stroke="#013D5A" strokeWidth="3.5" fill="none" strokeLinecap="round" strokeLinejoin="round" /></svg>;
}

function Login({ db, onLogin }: { db: DB; onLogin: (id: string) => void }) {
  const roles: [Role, string, string, React.ReactNode][] = [
    ['STUDENT', 'Student', 'Book an interview, see your status and results', <LuGraduationCap size={22} />],
    ['INTERVIEWER', 'Interviewer', 'Run today’s interviews, record outcomes, set availability', <LuCalendarDays size={22} />],
    ['ADMIN', 'Interview ops', 'Track who has booked, resolve issues, review malpractice', <LuLayoutDashboard size={22} />],
  ];
  const students = db.students.map(s => ({ u: db.users.find(u => u.id === s.userId)!, st: deriveJourney(db, s.id, currentBadgeDefId(db, s.id)).state }));
  return (
    <div className="min-h-screen bg-lionsmane">
      <div className="bg-navy-900 px-6 pb-28 pt-10 text-white">
        <div className="mx-auto max-w-5xl">
          <div className="flex items-center gap-3"><Logo /><span className="text-lg font-bold">GRIT Interview Hub</span><Pill tone="amber">Local demo · sample data</Pill></div>
          <h1 className="mt-10 max-w-2xl text-[34px] font-bold leading-tight tracking-tight">Track Badge interviews, from eligibility to badge — and beyond.</h1>
          <p className="mt-3 max-w-2xl text-[15px] text-slate-300">Students book live interviews once every required skill is cleared. Interviewers manage availability and record outcomes. The ops team sees who has booked, and reviews malpractice after a badge is awarded.</p>
        </div>
      </div>
      <div className="mx-auto -mt-20 max-w-5xl px-6 pb-16">
        <div className="grid gap-4 md:grid-cols-3">{roles.map(([r, title, body, icon]) => { const acc = DEMO_ACCOUNTS[r]; return (
          <Card key={r} className="flex flex-col p-5">
            <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-indigo-50 text-indigo-700">{icon}</div>
            <div className="mt-4 text-base font-bold text-slate-900">{title}</div><p className="mt-1 flex-1 text-[13px] text-slate-600">{body}</p>
            <div className="mt-4 rounded-lg bg-slate-50 px-3 py-2 text-[12.5px]"><span className="font-semibold text-slate-800">{acc.label}</span><span className="text-slate-500"> · {acc.hint}</span></div>
            <Button className="mt-3 w-full" onClick={() => onLogin(acc.userId)} data-testid={`login-${r.toLowerCase()}`} icon={<LuArrowRight size={15} />}>Continue as {acc.label.split(' ')[0]}</Button>
          </Card>
        ); })}</div>
        <Card className="mt-6">
          <div className="border-b border-slate-100 px-5 py-4"><div className="flex items-center gap-2 text-[15px] font-semibold text-slate-900"><LuSparkles size={16} className="text-teal-600" />Jump straight to a lifecycle state</div><p className="mt-0.5 text-[13px] text-slate-500">Each sample student sits at a different point in the journey.</p></div>
          <div className="grid gap-2 p-4 sm:grid-cols-2 lg:grid-cols-4">{students.map(({ u, st }) => (
            <button key={u.id} onClick={() => onLogin(u.id)} className="rounded-lg border border-slate-200 px-3 py-2 text-left hover:border-slate-400 hover:bg-slate-50"><div className="text-[13px] font-semibold text-slate-900">{u.fullName}</div><div className="text-[12px] text-slate-500">{JOURNEY_LABEL[st]}</div></button>
          ))}
            {db.users.filter(u => u.role !== 'STUDENT').map(u => (
              <button key={u.id} onClick={() => onLogin(u.id)} className="rounded-lg border border-slate-200 px-3 py-2 text-left hover:border-slate-400 hover:bg-slate-50"><div className="text-[13px] font-semibold text-slate-900">{u.fullName}</div><div className="text-[12px] text-slate-500">{u.role === 'INTERVIEWER' ? 'Interviewer' : u.permissions?.reviewMalpractice ? 'Ops · integrity reviewer' : 'Ops · no review rights'}</div></button>
            ))}</div>
        </Card>
        <p className="mt-6 text-center text-[12px] text-slate-600"><strong>Local demo mode.</strong> No backend is connected: sign-in has no passwords and data lives only in this browser (use “Reset demo” to start over). The production backend — Supabase Auth, row-level security and transactional RPCs — is in <code>supabase/</code>, tested on PostgreSQL 16.</p>
      </div>
    </div>
  );
}
