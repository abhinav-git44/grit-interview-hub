# Test execution report — GRIT Interview Hub

Every result below was produced by actually running the suite on 2026-11-11; raw logs are in `test-results/`.

| Suite | Command | Result |
|---|---|---|
| TypeScript (strict) | `npm run typecheck` | ✅ no errors (domain layer + tests) |
| Domain unit/integration | `npm test` | ✅ **41 / 41** |
| Database: security, rules, RLS, privileges | `npm run test:db` | ✅ **94 / 94** |
| Database: live two-session booking races | (part of `test:db`) | ✅ **2 / 2** |
| Database: seed applies through the RPCs | (part of `test:db`) | ✅ |
| Browser E2E — every screen, all roles, workflows, mobile | `npm run test:e2e` | ✅ **42 / 42**, 0 uncaught page errors |
| 2-page write-up | `npm run pdf` | ✅ exactly 2 A4 pages, no clipped content |
| Clean-checkout reproducibility | copy repo without `node_modules`, install only the `package-lock.json` tree, then run typecheck, unit tests, build, E2E and PDF | ✅ identical results |

**Environment:** Node v22.23.4 · PostgreSQL 16.15 (Ubuntu 16.15-0ubuntu0.24.04.1) (plain Postgres with `supabase/tests/00_local_auth_stub.sql` standing in for Supabase's `auth.uid()`/roles) · Google Chrome for Testing 153.0.8010.12 via Playwright 1.63.

**Not executed (no credentials available):** a live Supabase project (GoTrue sign-in, Realtime, PostgREST). The SQL that Supabase would run is exactly what was tested above; `supabase/seed.sql`'s `auth.users` block is skipped on plain Postgres.

## 1. Domain tests (`tests/domain.test.ts`)
```
  ✔ rejects invalid transitions
  ✔ every status change writes an audit record
✔ state machine
  ✔ computed from cleared skills, not a flag
  ✔ master level requires the novice badge
  ✔ not-eligible student cannot book
  ✔ requirement change: booked students are grandfathered
✔ eligibility
  ✔ students cannot clear their own skills; the contest system and ops can
  ✔ interviewers can flag only students they interviewed
  ✔ slots beyond the booking horizon are rejected
  ✔ a decided case cannot be decided again
✔ authorisation parity with SQL
  ✔ books a slot and sends the exact confirmation message
  ✔ RACE: two students submit the same slot concurrently → exactly one booking
  ✔ duplicate request with same idempotency key returns the original booking
  ✔ cannot hold two active bookings for the same badge
  ✔ past and too-soon slots are rejected
  ✔ a student cannot book for someone else
  ✔ cancel inside the cutoff is refused for students, allowed for ops
  ✔ reschedule keeps the same attempt and releases the old slot
✔ booking
  ✔ overlapping availability is rejected
  ✔ removing a window with bookings is blocked (never silently invalidated)
  ✔ interviewer unavailable → reassigned to a free colleague at the same time
  ✔ interviewer unavailable with no cover → priority rebook, not counted as an attempt
✔ availability
  ✔ outcome requires a started interview; pass awards the badge and the exact pass message
  ✔ double submission is rejected
  ✔ only the assigned interviewer can record the result
  ✔ retake: new attempt is created, the previous attempt is preserved
  ✔ retake cooldown blocks early booking
  ✔ max attempts enforced
  ✔ amending a result: inside window with reason keeps history; reversing a Pass is blocked
  ✔ interviewer cannot amend after the edit window
  ✔ student no-show counts as an attempt and applies a cooldown
  ✔ forgotten outcome shows as awaiting result and can still be submitted
✔ interviews and outcomes
  ✔ flag puts badge under review but never nullifies on its own
  ✔ dismissal reinstates; confirmation nullifies and keeps history
  ✔ nullification without reviewer permission is refused
  ✔ multiple flags: dismissing one keeps the badge under review while another is open
  ✔ student keeps several badges with different statuses
✔ malpractice and badges
  ✔ a failing step rolls back the whole transaction
  ✔ notification delivery failure does not roll back the booking
  ✔ missing records raise NOT_FOUND
  ✔ only reviewers with settings permission can change policies
✔ reliability
```

## 2. Database tests (`supabase/tests/10_db_tests.sql`)
| | Check |
|---|---|
| ✅ | anon cannot read users |
| ✅ | anon cannot execute book_slot |
| ✅ | anon cannot read audit_logs |
| ✅ | signed-in role without a user id is rejected (no NULL bypass) |
| ✅ | no NULL bypass on submit_outcome |
| ✅ | admin without settings permission cannot change policies |
| ✅ | policy validation rejects unknown keys |
| ✅ | ops lead sets booking lead time to 0 for the test run |
| ✅ | interviewer adds a near window (for live interview tests) |
| ✅ | interviewer adds a window in 2 days |
| ✅ | overlapping availability is rejected |
| ✅ | interviewer cannot add availability for a colleague |
| ✅ | availability in the past is rejected |
| ✅ | second interviewer adds a matching window |
| ✅ | slot generation: 30-min slots + 10-min buffer (120-min window → 3 slots) |
| ✅ | student cannot book for another student |
| ✅ | student cannot insert a booking directly |
| ✅ | student cannot clear their own skills |
| ✅ | student cannot call internal helpers |
| ✅ | past slots are rejected |
| ✅ | master level needs the novice badge |
| ✅ | eligible student books the near slot |
| ✅ | idempotent retry returns the same booking |
| ✅ | second active booking for the same badge is rejected |
| ✅ | booking confirmation uses the exact message title |
| ✅ | student cannot cancel inside the 12 h cutoff |
| ✅ | journey state is BOOKED |
| ✅ | not-eligible student cannot book |
| ✅ | RLS: a student sees no other student's bookings |
| ✅ | RLS: a student cannot read audit logs |
| ✅ | student cannot read another student's journey |
| ✅ | student books a far slot |
| ✅ | reschedule #1 |
| ✅ | reschedule #2 |
| ✅ | reschedule #3 exceeds the limit |
| ✅ | reschedule keeps ONE attempt and releases old slots |
| ✅ | window with a booking cannot be removed |
| ✅ | a booked slot cannot be blocked |
| ✅ | interview cannot start 2 days early |
| ✅ | reassigned to Rahul |
| ✅ | interviewer unavailable → reassigned to a colleague at the same time |
| ✅ | RLS: an interviewer cannot see a colleague's interview |
| ✅ | another interviewer cannot start Meera's interview |
| ✅ | a student cannot record a result |
| ✅ | outcome before the interview starts is rejected |
| ✅ | interviewer starts the interview (within 60 min of start) |
| ✅ | scores outside 1–5 are rejected |
| ✅ | interviewer records PASS |
| ✅ | double submission is rejected |
| ✅ | a Pass cannot be amended away |
| ✅ | direct update of attempts is denied |
| ✅ | PASS awarded the badge in the same transaction |
| ✅ | pass notification uses the exact message |
| ✅ | trigger blocks EARNED → NULLIFIED without review (even for the owner role) |
| ✅ | attempts can never be deleted |
| ✅ | audit log is append-only |
| ✅ | contest service records a cleared skill |
| ✅ | eligibility recomputed + exact eligibility message sent |
| ✅ | Rohan books the second near slot |
| ✅ | Meera starts Rohan's interview |
| ✅ | retake needs ≥ 20 chars of feedback |
| ✅ | Meera records RETAKE_LATER |
| ✅ | amendment without a reason is rejected |
| ✅ | amendment inside the window, with reason |
| ✅ | journey after Fail = FAIL_COOLDOWN |
| ✅ | fail cooldown blocks rebooking |
| ✅ | ops sets cooldowns to 0 and max attempts to 1 |
| ✅ | attempt limit is enforced |
| ✅ | amendment keeps both revisions |
| ✅ | interviewer cannot flag a student they never interviewed |
| ✅ | a student cannot raise a flag |
| ✅ | assigned interviewer flags the badge |
| ✅ | ops raises a second flag |
| ✅ | admin without reviewer rights cannot decide |
| ✅ | cannot confirm before an investigation |
| ✅ | decision needs a reason |
| ✅ | reviewer opens an investigation |
| ✅ | reviewer dismisses the second case |
| ✅ | badge stays under review while another case is open |
| ✅ | reviewer confirms the first case |
| ✅ | student sees the nullification notice |
| ✅ | student can never read malpractice cases (evidence hidden) |
| ✅ | student sees own badge as NULLIFIED with history kept |
| ✅ | a nullified badge cannot be flagged again |
| ✅ | interviewer sees only cases they reported |
| ✅ | ops adds a required skill to Novice |
| ✅ | unbooked students re-evaluated (no longer eligible) |
| ✅ | booked student keeps the booking (grandfathered) |
| ✅ | every write produced an audit record |
| ✅ | anon can execute NO public function |
| ✅ | no client role can INSERT/UPDATE/DELETE any public table |
| ✅ | RLS is enabled on every public table |
| ✅ | every SECURITY DEFINER function pins search_path |
| ✅ | internal helpers (_*) are not executable by signed-in users |

## 3. Concurrency (`supabase/tests/20_booking_race.sh`) — two real Postgres sessions
```
Race 1: two students, one slot (19358d54-ef16-452d-8075-af91eeff17e0)
  [A] 00000000-0000-0000-0000-0000000000d1
  [A] session A booked a5b67de9-4e47-4dcc-8fc8-be0c7e53f83d
  [B] 00000000-0000-0000-0000-0000000000d2
  [B] ERROR:  SLOT_TAKEN: Sorry — someone just booked that slot. Please pick another time.
  active bookings on the slot: 1
PASS race 1 — exactly one booking
Race 2: one student double-submits (different requests) for the same badge
  [1] 00000000-0000-0000-0000-0000000000d2
  [1] request 1 booked 5154f88e-e468-433e-beeb-d1d0971c14dd
  [2] 00000000-0000-0000-0000-0000000000d2
  [2] ERROR:  ALREADY_BOOKED: You already have an interview booked for this badge. Reschedule it instead.
  active bookings for the student: 1
PASS race 2 — one active booking per student × badge
```

## 4. Seed (`supabase/seed.sql`) on a fresh database — journey state per demo student
```
NOTICE:  database "grit_test_seed" does not exist, skipping
Aarav Sharma → ELIGIBLE
Ishita Rao → RETAKE_COOLDOWN
Riya Patel → BOOKED
Rohan Das → NOT_ELIGIBLE
Tara Menon → BOOKED
PASS seed — applied through the RPCs
```

## 5. Browser E2E (`tests/e2e.mjs`, Chromium, desktop 1400×1000 and mobile 390×844)
| | Check |
|---|---|
| ✅ | Aarav · student-home renders |
| ✅ | Aarav · student-book renders |
| ✅ | Aarav · student-interviews renders |
| ✅ | Aarav · student-badges renders |
| ✅ | Aarav · notifications renders |
| ✅ | Aarav · showcase renders |
| ✅ | Aarav · every sidebar link navigates |
| ✅ | Meera · interviewer-schedule renders |
| ✅ | Meera · interviewer-availability renders |
| ✅ | Meera · interviewer-history renders |
| ✅ | Meera · notifications renders |
| ✅ | Meera · every sidebar link navigates |
| ✅ | Priya · admin-overview renders |
| ✅ | Priya · admin-students renders |
| ✅ | Priya · admin-bookings renders |
| ✅ | Priya · admin-interviewers renders |
| ✅ | Priya · admin-malpractice renders |
| ✅ | Priya · admin-audit renders |
| ✅ | Priya · admin-settings renders |
| ✅ | Priya · every sidebar link navigates |
| ✅ | J1 Rohan: contest result → eligible (exact message 1) → book → confirmation (exact message 2) |
| ✅ | Student can cancel outside the cutoff; slot returns to the pool |
| ✅ | Student reschedules; the attempt is kept |
| ✅ | Booked student inside 12 h cutoff sees changes locked with a clear explanation |
| ✅ | Notification CTA navigates to the right screen |
| ✅ | J2 Meera: start → validation → Pass → student sees badge (exact message 3) |
| ✅ | J3 Retake later → student sees feedback + cooldown; a retake-eligible student books attempt 2, attempt 1 kept |
| ✅ | Interviewer adds availability; overlap is rejected with a readable error |
| ✅ | "I can't make it" reassigns the interview to a free colleague |
| ✅ | Ops: overview KPIs and "eligible, not booked" list reflect state; nudge works; duplicate nudge explained |
| ✅ | Ops: bookings — move and cancel with override |
| ✅ | Ops: policy change saves and is audited |
| ✅ | Ops without reviewer rights: view-only malpractice, cannot decide |
| ✅ | J4 flag → investigate → dismiss → badge reinstated (student sees it) |
| ✅ | J5 confirm → nullified → student dashboard + audit |
| ✅ | J7 student cannot open ops pages |
| ✅ | J6 two tabs book the same slot → exactly one succeeds, the other gets a clear error |
| ✅ | All 10 before/after scenarios build from real logic |
| ✅ | Aarav on mobile: no horizontal overflow |
| ✅ | Meera on mobile: no horizontal overflow |
| ✅ | Priya on mobile: no horizontal overflow |
| ✅ | No uncaught page errors during the whole run |

Screenshots of every screen and every before/after state: `test-results/screens/`.

## Defects found and fixed during this audit
| Severity | Finding | Fix |
|---|---|---|
| Critical | `book_slot()` (SECURITY DEFINER) never checked that the caller owned the student → anyone could book for anyone | Caller resolved from `auth.uid()`; `_assert_student_self_or_admin` on every student action |
| Critical | Postgres grants EXECUTE to PUBLIC by default → anon could call every function | `revoke execute … from public, anon`; explicit grants per RPC; privilege-sweep test |
| Critical | 9 tables had no RLS (incl. `users`, `system_settings`) and Supabase's default table grants would make them writable | RLS on every table, all client write privileges revoked; sweep tests both |
| Critical | `submit_outcome()` compared `interviewer_id <> (subquery on auth.uid())` → NULL when signed out, check skipped | `_actor()` raises `UNAUTHENTICATED` before any check; test proves it |
| High | Cancel, reschedule, availability, no-shows, amendments, flags, skills, policies had no SQL — rules lived only in TypeScript | 23 RPCs in `0002_functions.sql` mirroring `services.ts`, incl. cooldowns, attempt limits, cutoffs, horizon |
| High | Students could clear their own skills (TS) | Contest system / ops only, in TS and SQL |
| Medium | Any interviewer could flag any student | Only students they interviewed (or ops), in TS and SQL |
| Medium | Mobile: booking date strip, header and case actions overflowed 19–724 px | Shrinkable grid columns, wrapping header/actions; overflow test per role |
| Medium | Machine-specific paths in tests; no `package.json`/lockfile | Portable Node/bash scripts driven by env vars; pinned `package.json` + derived lockfile |
| Low | “Eligible, not booked” KPI didn't add up | KPI now states how many are waiting out a cooldown |
