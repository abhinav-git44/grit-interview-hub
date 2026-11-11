# GRIT Interview Hub

Track Badge interview scheduling and badge lifecycle for GRIT (NIAT). Students book a live interview once every required skill is cleared. Interviewers manage availability and record Pass / Fail / Retake later. The ops team sees who has booked and who hasn't, and reviews malpractice after a badge is awarded.

> **Two layers, both in this repo**
> 1. **`supabase/`: the production backend.** It's a PostgreSQL/Supabase schema where the database itself enforces every security and business rule: RLS on every table, no client write privileges, and 23 authorised `SECURITY DEFINER` RPCs with audit and notifications. It's tested on PostgreSQL 16 (94 checks plus live concurrency races).
> 2. **`src/`: the clickable prototype in local demo mode.** It's a React app whose TypeScript domain layer mirrors the SQL rules and runs in the browser on sample data. It's clearly labelled “Local demo · no backend connected”.
>
> **Supabase status:** no Supabase credentials were available while building this, so the prototype is **not** connected to a live project. Nothing in the UI claims otherwise. Setup steps to stand up the real backend are below.

- **Live demo:** https://claude.ai/artifact/MbQC8qMBxcGsZfaQEV8jxv (local demo mode)
- **Assignment write-up (2 pages):** `docs/GRIT_Interview_Hub_Writeup.pdf`
- **Test report:** `TEST_REPORT.md`, with raw logs and screenshots in `test-results/`

## Demo credentials

**Live demo (local mode).** Sign-in is one click, with no passwords. The sign-in page also lets you jump in as any of the 20 sample students, each at a different lifecycle state. *Reset demo* regenerates the data around today's date. Data stays in your browser only.

| Role | Account | Use it to see |
|---|---|---|
| Student | **Aarav Sharma** | Eligible, not booked: the booking flow |
| Interviewer | **Meera Iyer** | Interviews today: start an interview, record an outcome |
| Ops (integrity reviewer) | **Priya Menon** | Booked vs not-booked, malpractice decisions, settings |
| Ops (no review rights) | **Karan Shah** | Can raise a flag, can't decide a case |

**Supabase (after following the setup below).** Every account's password is `GritDemo!2026`.

| Email | Role |
|---|---|
| `aarav@demo.grit.example` | Student, eligible and unbooked |
| `riya@demo.grit.example` | Student, booked today |
| `ishita@demo.grit.example` | Student, retake recommended |
| `rohan@demo.grit.example` | Student, not eligible |
| `tara@demo.grit.example` | Student, booked in 3 days |
| `meera@demo.grit.example` · `rahul@demo.grit.example` | Interviewers |
| `priya@demo.grit.example` | Ops, integrity reviewer and settings editor |
| `karan@demo.grit.example` | Ops, no special rights |

All names and records are fictional sample data.

## Quick start (local demo)

```bash
npm ci                                   # exact versions from package-lock.json (Node ≥ 20)
npx playwright install chromium          # only for E2E tests and the PDF (or set CHROME_PATH to a local Chrome)
npm run build                            # → dist/index.html (single self-contained file)
open dist/index.html                     # or serve it; no server or backend needed
```

| Script | What it does |
|---|---|
| `npm run build` | Bundles React + Tailwind v4 into `dist/index.html` (esbuild) |
| `npm run typecheck` | `tsc --strict` over the domain layer and tests |
| `npm test` | 41 domain tests (node:test) |
| `npm run test:db` | Creates a throw-away Postgres DB and applies the auth stub + migrations; runs 94 SQL checks, 2 live booking races and the seed. Uses `PGHOST`/`PGPORT`/`PGUSER`/`PGPASSWORD` |
| `npm run test:e2e` | Builds, then runs 42 browser checks (every screen, every role, workflows, mobile overflow) |
| `npm run pdf` | Renders `docs/writeup.html` to the 2-page PDF and fails if it isn't exactly 2 pages |
| `npm run test:all` | All of the above except `pdf` |

Copy `.env.example` to `.env` for local Postgres and optional `CHROME_PATH`.

## Supabase setup (production backend)

1. **Create a project** at supabase.com, or run it locally with the Supabase CLI: `supabase init && supabase start`.
2. **Apply the migrations in order.** The CLI picks them up from `supabase/migrations/` (`supabase db reset` locally, `supabase db push` for a linked project). Or paste each file into the SQL editor:
   - `0001_schema.sql`: tables, constraints, exclusion constraints, transition and append-only triggers
   - `0002_functions.sql`: eligibility, journey and the 23 client RPCs
   - `0003_security.sql`: revokes, grants, RLS on every table, Realtime publication
3. **Seed demo data:** `psql "$DATABASE_URL" -f supabase/seed.sql`. On Supabase it also creates the demo Auth users in `auth.users` and `auth.identities` with the password above. That block follows Supabase's standard local-seed pattern, but it was **not executed against a live project** here.
4. **Keys:** copy `SUPABASE_URL` and `SUPABASE_ANON_KEY` into `.env`. The anon key is safe in a browser: anon can't read a single table or call a single function. The `SUPABASE_SERVICE_ROLE_KEY` is only for the server-side contest-results integration (`record_skill_cleared`) and must never ship to clients.
5. **Notifications:** RPCs write `notifications` rows as `QUEUED`. A Supabase Edge Function or cron worker sends the email and marks each row `DELIVERED` or `FAILED`. The in-app list works without it.
6. **Wiring the UI** (next step, not done here): replace each `store.run(d => S.xyz(...))` call with `supabase.rpc('xyz', …)` (the names and arguments map one to one; see the table below). Read screens with `select` (RLS filters the rows) and subscribe to the Realtime tables listed in `0003`.

### RPC contract (all require a signed-in user unless noted)

| Area | RPC | Who may call |
|---|---|---|
| Journey | `student_journey(student, badge)` | The student, their assigned interviewer, ops |
| Booking | `book_slot(student, badge, slot, idempotency_key)` · `cancel_booking(booking, reason)` · `reschedule_booking(booking, new_slot)` | The student (own records only) or ops. Ops bypass the 12 h cutoff and reschedule limit, and the override is audited |
| Availability | `add_availability(interviewer, start, end, repeat_weeks)` · `remove_availability(window)` · `set_slot_blocked(slot, blocked)` · `interviewer_unavailable(attempt, reason)` | The interviewer themselves, or ops |
| Interviews | `start_interview(attempt)` · `submit_outcome(attempt, outcome, tech, comm, ps, feedback)` | Only the assigned interviewer |
| | `mark_student_no_show(attempt)` · `amend_outcome(…, reason)` | The assigned interviewer (amend within 24 h) or ops |
| | `mark_interviewer_no_show(attempt)` · `remind_interviewer(attempt)` · `nudge_student(student)` | Ops |
| Governance | `flag_malpractice(student_badge, description, evidence)` | Ops, or an interviewer who interviewed that student |
| | `start_investigation(case, note)` · `decide_case(case, decision, reason)` | Ops with `can_review_malpractice` |
| Settings | `update_policies(jsonb)` · `set_skill_required(badge, skill, required)` | Ops with `can_edit_settings` |
| | `set_interviewer_active(interviewer, active)` | Ops |
| Integration | `record_skill_cleared(student, skill)` | The service role (contest system) or ops. **Students can't clear their own skills.** |
| Misc | `mark_notifications_read(ids)` | Self |

Errors are raised as `CODE: human message` (SQLSTATE P0001). The codes are `UNAUTHENTICATED`, `FORBIDDEN`, `NOT_FOUND`, `NOT_ELIGIBLE`, `COOLDOWN`, `LIMIT_REACHED`, `SLOT_TAKEN`, `SLOT_IN_PAST`, `CUTOFF_PASSED`, `ALREADY_BOOKED`, `OVERLAP`, `HAS_BOOKINGS`, `INACTIVE`, `DUPLICATE`, `INVALID_TRANSITION`, `VALIDATION` and `CONFLICT`. The UI shows the message part.

## Security model

- **Deny by default.** `anon` has no table or function privileges. `authenticated` has `SELECT` only, filtered by RLS, plus `EXECUTE` on the client RPCs. No client role can `INSERT`, `UPDATE` or `DELETE` any table. Internal `_helpers` can't be called by clients.
- **Callers identified, never trusted.** Every RPC resolves the caller from `auth.uid()` through `_actor()`, which raises when the uid is missing, so a NULL comparison can't let a call through. It then checks role and ownership. Every `SECURITY DEFINER` function pins `search_path`.
- **RLS:**
  - Students see only their own rows.
  - Interviewers see their own schedule and the students assigned to them.
  - Ops see everything operational.
  - Malpractice cases and evidence are never visible to students, and an interviewer sees only the cases they reported.
  - Only ops read the audit log.
- **Integrity in the database:**
  - Triggers enforce the transition tables for badges, cases, bookings, slots and attempts.
  - Audit logs, badge events, case events and outcome revisions are append-only.
  - Attempts, badges, cases and bookings can never be deleted.
- **Concurrency:**
  - `book_slot` takes an advisory lock per student × badge, then `SELECT … FOR UPDATE` on the slot.
  - Partial unique indexes allow one active booking per slot and per student × badge.
  - A GiST exclusion constraint prevents overlapping windows and slots for the same interviewer.
  - Idempotency keys make retried requests safe.
  - Reschedules lock both slots in id order, so two reschedules can't deadlock.
- **Tests:** `supabase/tests/10_db_tests.sql` ends with a privilege sweep, so a function or table added later without the right grants fails CI.

## Lifecycle model

There's one journey per **student × badge level**, because each level has its own interview. The stored dimensions are eligibility (computed), booking, attendance, interview, outcome, badge and malpractice case. The student-facing state is derived from them (`deriveJourney()` in TS, `_journey()` in SQL):

`NOT_ELIGIBLE → ELIGIBLE → BOOKED → IN_INTERVIEW → AWAITING_RESULT → PASSED`, or one of the side paths:
- `RETAKE_COOLDOWN → RETAKE_ELIGIBLE`
- `FAIL_COOLDOWN → FAIL_REBOOKABLE`
- `NO_SHOW_COOLDOWN`
- `ATTEMPTS_EXHAUSTED`
- `PRIORITY_REBOOK` (the interviewer couldn't attend)

After a Pass, a malpractice flag moves the badge: `PASSED → BADGE_UNDER_REVIEW → PASSED | BADGE_NULLIFIED`.

**Policies.** These are illustrative assumptions, not confirmed GRIT policy. All of them are editable through `update_policies` or Admin → Settings, and every change is audited:
- 30-minute interviews with a 10-minute buffer
- Book at least 2 h ahead and at most 21 days ahead
- Cancel or reschedule until 12 h before, with at most 2 reschedules
- Cooldowns: 5 days after Retake later, 14 days after Fail, 3 days after a student no-show
- 3 attempts per badge; a student no-show counts as one
- Interviewers can correct a non-Pass result within 24 h

## Project structure

```
src/domain/     framework-free TypeScript (strict): types, stateMachine, eligibility, services, store, seed, messages
src/ui/         React 19 + Tailwind v4 screens: student, interviewer, admin, showcase (before/after), app shell
supabase/       migrations/0001–0003, seed.sql, tests/ (local auth stub, SQL suite, race script)
tests/          domain.test.ts (node:test), e2e.mjs (Playwright)
scripts/        build.mjs, build-writeup.mjs, test-db.sh, derive-lockfile.py
docs/           writeup.html → GRIT_Interview_Hub_Writeup.pdf
```

**Theme:** Midnight `#013D5A` · Lionsmane `#FCF3E3` · Celeste `#BDD3CE` · Herb `#708C69` · Marigold `#F4A258`. Text and button shades of Herb and Marigold are darkened to meet WCAG AA contrast on white.

## Deployment

- **Frontend (as built):** `dist/index.html` is a single static file. Host it on any static host (Vercel, Netlify, S3, GitHub Pages) or as a Claude artifact, which is the live link above.
- **Backend:** apply the Supabase setup above. Then add `SUPABASE_URL` and `SUPABASE_ANON_KEY` as environment variables on the frontend host once the UI is wired to the RPCs (step 6).

## Known limitations

- **Supabase isn't connected.** The UI runs on the in-browser domain layer, and data is per browser. The Supabase backend is complete and tested on plain PostgreSQL 16 (with a stub for `auth.uid()` and roles), but not against a live Supabase project (GoTrue, PostgREST, Realtime). Wiring the UI to the RPCs is the next step.
- **The lockfile was derived offline** from an already-resolved npm lockfile (`scripts/derive-lockfile.py`), because the build machine had no registry access. Every entry keeps its real `resolved` URL and `integrity` hash, and `npm ls --all` reports it consistent. Running `npm install` once with registry access will normalise it.
- **The UI isn't type-checked.** React type definitions weren't installable offline, so only the domain layer and tests are type-checked under `strict`.
- **Timezones:** all sample users are in IST. Times are stored in UTC and rendered in each user's timezone.
- **Simulated features:** meeting links are placeholders, and email delivery is simulated (with a toggle to simulate failure in Settings).
