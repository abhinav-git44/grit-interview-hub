-- ════════════════════════════════════════════════════════════════════
-- Database test suite: security, business rules, governance.
-- Run after the 3 migrations (and 00_local_auth_stub.sql on plain Postgres) via scripts/test-db.sh.
-- Each check is recorded in t.results; the script fails if any check fails.
-- ════════════════════════════════════════════════════════════════════
\set ON_ERROR_STOP on
\set QUIET on
\pset tuples_only on
drop schema if exists t cascade;
create schema t;
create table t.results (seq serial, name text, passed boolean, detail text);
create table t.vars (k text primary key, v uuid);
grant usage on schema t to anon, authenticated, service_role;
grant all on all tables in schema t to anon, authenticated, service_role;
grant all on all sequences in schema t to anon, authenticated, service_role;

create function t.v(p text) returns uuid language sql stable as $$ select v from t.vars where k = p $$;
create function t.set(p text, val uuid) returns void language sql as $$ insert into t.vars values (p, val) on conflict (k) do update set v = excluded.v $$;
create function t.ok(p_name text, p_cond boolean, p_detail text default null) returns void language sql as
  $$ insert into t.results (name, passed, detail) values (p_name, coalesce(p_cond, false), p_detail) $$;
create function t.expect_ok(p_name text, p_sql text) returns void language plpgsql as $$
begin execute p_sql; insert into t.results (name, passed) values (p_name, true);
exception when others then insert into t.results (name, passed, detail) values (p_name, false, sqlerrm); end $$;
create function t.expect_error(p_name text, p_sql text, p_code text) returns void language plpgsql as $$
begin
  execute p_sql;
  insert into t.results (name, passed, detail) values (p_name, false, 'expected ' || p_code || ' but the call succeeded');
exception when others then
  insert into t.results (name, passed, detail) values (p_name, sqlerrm like p_code || '%' or sqlstate = p_code, sqlstate || ' ' || sqlerrm);
end $$;
grant execute on all functions in schema t to anon, authenticated, service_role;

-- ── Fixtures (as the database owner, like a seed) ───────────────────
insert into users (id, full_name, email, role) values
 ('00000000-0000-0000-0000-0000000000a1','Aarav Sharma','aarav@demo.grit.example','STUDENT'),
 ('00000000-0000-0000-0000-0000000000a2','Tara Menon','tara@demo.grit.example','STUDENT'),
 ('00000000-0000-0000-0000-0000000000a3','Rohan Das','rohan@demo.grit.example','STUDENT'),
 ('00000000-0000-0000-0000-0000000000b1','Meera Iyer','meera@demo.grit.example','INTERVIEWER'),
 ('00000000-0000-0000-0000-0000000000b2','Rahul Verma','rahul@demo.grit.example','INTERVIEWER');
insert into users (id, full_name, email, role, can_review_malpractice, can_edit_settings) values
 ('00000000-0000-0000-0000-0000000000c1','Priya Menon','priya@demo.grit.example','ADMIN', true, true),
 ('00000000-0000-0000-0000-0000000000c2','Karan Shah','karan@demo.grit.example','ADMIN', false, false);
insert into students (id, user_id, student_code) values
 ('10000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-0000000000a1','NIAT241001'),
 ('10000000-0000-0000-0000-000000000002','00000000-0000-0000-0000-0000000000a2','NIAT241014'),
 ('10000000-0000-0000-0000-000000000003','00000000-0000-0000-0000-0000000000a3','NIAT241009');
insert into interviewers (id, user_id, employee_code) values
 ('20000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-0000000000b1','INT-101'),
 ('20000000-0000-0000-0000-000000000002','00000000-0000-0000-0000-0000000000b2','INT-102');
insert into tracks (id, name) values ('30000000-0000-0000-0000-000000000001','AI Product Mastery');
insert into badge_definitions (id, track_id, level, level_order, name) values
 ('40000000-0000-0000-0000-000000000001','30000000-0000-0000-0000-000000000001','Novice',1,'AI Product Mastery — Novice'),
 ('40000000-0000-0000-0000-000000000002','30000000-0000-0000-0000-000000000001','Master',2,'AI Product Mastery — Master');
insert into skills (id, track_id, name) values
 ('50000000-0000-0000-0000-000000000001','30000000-0000-0000-0000-000000000001','Product Discovery'),
 ('50000000-0000-0000-0000-000000000002','30000000-0000-0000-0000-000000000001','Prompt Design'),
 ('50000000-0000-0000-0000-000000000003','30000000-0000-0000-0000-000000000001','AI UX Patterns');
insert into badge_skill_requirements values
 ('40000000-0000-0000-0000-000000000001','50000000-0000-0000-0000-000000000001'),
 ('40000000-0000-0000-0000-000000000001','50000000-0000-0000-0000-000000000002'),
 ('40000000-0000-0000-0000-000000000002','50000000-0000-0000-0000-000000000003');
insert into student_skill_progress values
 ('10000000-0000-0000-0000-000000000001','50000000-0000-0000-0000-000000000001','CLEARED', now()),
 ('10000000-0000-0000-0000-000000000001','50000000-0000-0000-0000-000000000002','CLEARED', now()),
 ('10000000-0000-0000-0000-000000000002','50000000-0000-0000-0000-000000000001','CLEARED', now()),
 ('10000000-0000-0000-0000-000000000002','50000000-0000-0000-0000-000000000002','CLEARED', now()),
 ('10000000-0000-0000-0000-000000000003','50000000-0000-0000-0000-000000000001','CLEARED', now());
-- a past window/slot (history) for the "slot in the past" check
insert into availability_windows (id, interviewer_id, period) values ('60000000-0000-0000-0000-000000000099','20000000-0000-0000-0000-000000000001', tstzrange(now() - interval '2 days', now() - interval '2 days' + interval '30 min'));
insert into interview_slots (id, interviewer_id, window_id, period) values ('70000000-0000-0000-0000-000000000099','20000000-0000-0000-0000-000000000001','60000000-0000-0000-0000-000000000099', tstzrange(now() - interval '2 days', now() - interval '2 days' + interval '30 min'));
create view t.slot_list as select s.id, s.interviewer_id, lower(s.period) as starts, s.status from interview_slots s;
grant select on t.slot_list to authenticated;

-- ════════════════ SECURITY: anon & privileges ════════════════
set role anon;
select t.expect_error('anon cannot read users', 'select count(*) from users', '42501');
select t.expect_error('anon cannot execute book_slot', $$select book_slot('10000000-0000-0000-0000-000000000001','40000000-0000-0000-0000-000000000001','70000000-0000-0000-0000-000000000099')$$, '42501');
select t.expect_error('anon cannot read audit_logs', 'select count(*) from audit_logs', '42501');
reset role;

set role authenticated;
select set_config('request.jwt.claim.sub', '', false);
select t.expect_error('signed-in role without a user id is rejected (no NULL bypass)', $$select book_slot('10000000-0000-0000-0000-000000000001','40000000-0000-0000-0000-000000000001','70000000-0000-0000-0000-000000000099')$$, 'UNAUTHENTICATED');
select t.expect_error('no NULL bypass on submit_outcome', $$select submit_outcome(gen_random_uuid(),'PASS',5,5,5,'x')$$, 'UNAUTHENTICATED');

-- ════════════════ Policy setup by the ops lead (also tests update_policies) ════════════════
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000c2', false);   -- Karan: no edit rights
select t.expect_error('admin without settings permission cannot change policies', $$select update_policies('{"minBookingLeadHours":0}')$$, 'FORBIDDEN');
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000c1', false);   -- Priya
select t.expect_error('policy validation rejects unknown keys', $$select update_policies('{"bogus":1}')$$, 'VALIDATION');
select t.expect_ok('ops lead sets booking lead time to 0 for the test run', $$select update_policies('{"minBookingLeadHours":0}')$$);

-- ════════════════ Availability (as interviewers) ════════════════
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000b1', false);   -- Meera
select t.expect_ok('interviewer adds a near window (for live interview tests)', $$select add_availability('20000000-0000-0000-0000-000000000001', date_trunc('minute', now()) + interval '20 min', date_trunc('minute', now()) + interval '140 min')$$);
select t.expect_ok('interviewer adds a window in 2 days', $$select add_availability('20000000-0000-0000-0000-000000000001', date_trunc('hour', now()) + interval '2 days', date_trunc('hour', now()) + interval '2 days 4 hours')$$);
select t.expect_error('overlapping availability is rejected', $$select add_availability('20000000-0000-0000-0000-000000000001', date_trunc('hour', now()) + interval '2 days 1 hour', date_trunc('hour', now()) + interval '2 days 5 hours')$$, 'OVERLAP');
select t.expect_error('interviewer cannot add availability for a colleague', $$select add_availability('20000000-0000-0000-0000-000000000002', now() + interval '3 days', now() + interval '3 days 2 hours')$$, 'FORBIDDEN');
select t.expect_error('availability in the past is rejected', $$select add_availability('20000000-0000-0000-0000-000000000001', now() - interval '5 hours', now() - interval '4 hours')$$, 'SLOT_IN_PAST');
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000b2', false);   -- Rahul: same time in 2 days (cover for reassignment)
select t.expect_ok('second interviewer adds a matching window', $$select add_availability('20000000-0000-0000-0000-000000000002', date_trunc('hour', now()) + interval '2 days', date_trunc('hour', now()) + interval '2 days 4 hours')$$);
reset role;
select t.set('near1', (select id from interview_slots where interviewer_id = '20000000-0000-0000-0000-000000000001' and lower(period) > now() order by lower(period) limit 1));
select t.set('near2', (select id from interview_slots where interviewer_id = '20000000-0000-0000-0000-000000000001' and lower(period) > now() order by lower(period) offset 1 limit 1));
select t.set('far1',  (select id from interview_slots where interviewer_id = '20000000-0000-0000-0000-000000000001' and lower(period) > now() + interval '1 day' order by lower(period) limit 1));
select t.set('far2',  (select id from interview_slots where interviewer_id = '20000000-0000-0000-0000-000000000001' and lower(period) > now() + interval '1 day' order by lower(period) offset 1 limit 1));
select t.set('far3',  (select id from interview_slots where interviewer_id = '20000000-0000-0000-0000-000000000001' and lower(period) > now() + interval '1 day' order by lower(period) offset 2 limit 1));
select t.set('far4',  (select id from interview_slots where interviewer_id = '20000000-0000-0000-0000-000000000001' and lower(period) > now() + interval '1 day' order by lower(period) offset 3 limit 1));
select t.ok('slot generation: 30-min slots + 10-min buffer (120-min window → 3 slots)', (select count(*) from interview_slots where interviewer_id = '20000000-0000-0000-0000-000000000001' and lower(period) between now() and now() + interval '3 hours') = 3);

-- ════════════════ Students: ownership, eligibility, booking rules ════════════════
set role authenticated;
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000a1', false);   -- Aarav
select t.expect_error('student cannot book for another student', format($$select book_slot('10000000-0000-0000-0000-000000000002','40000000-0000-0000-0000-000000000001','%s')$$, t.v('far1')), 'FORBIDDEN');
select t.expect_error('student cannot insert a booking directly', $$insert into interview_bookings (student_id, badge_definition_id, slot_id) values ('10000000-0000-0000-0000-000000000001','40000000-0000-0000-0000-000000000001','70000000-0000-0000-0000-000000000099')$$, '42501');
select t.expect_error('student cannot clear their own skills', $$select record_skill_cleared('10000000-0000-0000-0000-000000000001','50000000-0000-0000-0000-000000000003')$$, 'FORBIDDEN');
select t.expect_error('student cannot call internal helpers', $$select _notify('00000000-0000-0000-0000-0000000000a1','X','t','b')$$, '42501');
select t.expect_error('past slots are rejected', $$select book_slot('10000000-0000-0000-0000-000000000001','40000000-0000-0000-0000-000000000001','70000000-0000-0000-0000-000000000099')$$, 'SLOT_IN_PAST');
select t.expect_error('master level needs the novice badge', format($$select book_slot('10000000-0000-0000-0000-000000000001','40000000-0000-0000-0000-000000000002','%s')$$, t.v('far1')), 'NOT_ELIGIBLE');
select t.expect_ok('eligible student books the near slot', format($$select t.set('bkA', book_slot('10000000-0000-0000-0000-000000000001','40000000-0000-0000-0000-000000000001','%s','idem-A'))$$, t.v('near1')));
select t.ok('idempotent retry returns the same booking', book_slot('10000000-0000-0000-0000-000000000001','40000000-0000-0000-0000-000000000001', t.v('near1'), 'idem-A') = t.v('bkA'));
select t.expect_error('second active booking for the same badge is rejected', format($$select book_slot('10000000-0000-0000-0000-000000000001','40000000-0000-0000-0000-000000000001','%s')$$, t.v('far2')), 'ALREADY_BOOKED');
select t.ok('booking confirmation uses the exact message title', exists (select 1 from notifications where type = 'BOOKING_CONFIRMED' and title = 'Your interview is confirmed!' and body like '%Mode: Online%'));
select t.expect_error('student cannot cancel inside the 12 h cutoff', format($$select cancel_booking('%s','clash')$$, t.v('bkA')), 'CUTOFF_PASSED');
select t.ok('journey state is BOOKED', (select state from student_journey('10000000-0000-0000-0000-000000000001','40000000-0000-0000-0000-000000000001')) = 'BOOKED');

select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000a3', false);   -- Rohan (1 of 2 skills)
select t.expect_error('not-eligible student cannot book', format($$select book_slot('10000000-0000-0000-0000-000000000003','40000000-0000-0000-0000-000000000001','%s')$$, t.v('far2')), 'NOT_ELIGIBLE');
select t.ok('RLS: a student sees no other student''s bookings', (select count(*) from interview_bookings) = 0);
select t.ok('RLS: a student cannot read audit logs', (select count(*) from audit_logs) = 0);
select t.expect_error('student cannot read another student''s journey', $$select * from student_journey('10000000-0000-0000-0000-000000000001','40000000-0000-0000-0000-000000000001')$$, 'FORBIDDEN');

-- Tara: far slot → reschedule rules
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000a2', false);
select t.expect_ok('student books a far slot', format($$select t.set('bkT', book_slot('10000000-0000-0000-0000-000000000002','40000000-0000-0000-0000-000000000001','%s'))$$, t.v('far1')));
select t.expect_ok('reschedule #1', format($$select t.set('bkT', reschedule_booking('%s','%s'))$$, t.v('bkT'), t.v('far2')));
select t.expect_ok('reschedule #2', format($$select t.set('bkT', reschedule_booking('%s','%s'))$$, t.v('bkT'), t.v('far3')));
select t.expect_error('reschedule #3 exceeds the limit', format($$select reschedule_booking('%s','%s')$$, t.v('bkT'), t.v('far4')), 'LIMIT_REACHED');
reset role;
select t.ok('reschedule keeps ONE attempt and releases old slots', (select count(*) from interview_attempts where student_id = '10000000-0000-0000-0000-000000000002') = 1
  and (select status from interview_slots where id = t.v('far1')) = 'OPEN' and (select status from interview_slots where id = t.v('far3')) = 'BOOKED');

-- ════════════════ Interviewer: availability conflicts, reassignment, conduct ════════════════
set role authenticated;
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000b1', false);   -- Meera
select t.expect_error('window with a booking cannot be removed', format($$select remove_availability((select window_id from interview_slots where id = '%s'))$$, t.v('near1')), 'HAS_BOOKINGS');
select t.expect_error('a booked slot cannot be blocked', format($$select set_slot_blocked('%s', true)$$, t.v('near1')), 'HAS_BOOKINGS');
select t.expect_error('interview cannot start 2 days early', format($$select start_interview((select id from interview_attempts where booking_id = '%s'))$$, t.v('bkT')), 'VALIDATION');
select t.expect_ok('interviewer unavailable → reassigned to a colleague at the same time', format($$select t.ok('reassigned to Rahul', interviewer_unavailable((select id from interview_attempts where booking_id = '%s'), 'Unwell') = '20000000-0000-0000-0000-000000000002')$$, t.v('bkT')));
reset role;
select t.set('attA', (select id from interview_attempts where booking_id = t.v('bkA')));
set role authenticated;
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000b2', false);   -- Rahul
select t.ok('RLS: an interviewer cannot see a colleague''s interview', (select count(*) from interview_attempts where id = t.v('attA')) = 0);
select t.expect_error('another interviewer cannot start Meera''s interview', format($$select start_interview('%s')$$, t.v('attA')), 'FORBIDDEN');
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000a1', false);
select t.expect_error('a student cannot record a result', format($$select submit_outcome((select id from interview_attempts where booking_id = '%s'),'PASS',5,5,5,'great')$$, t.v('bkA')), 'FORBIDDEN');
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000b1', false);   -- Meera
select t.expect_error('outcome before the interview starts is rejected', format($$select submit_outcome((select id from interview_attempts where booking_id = '%s'),'PASS',4,4,4,'good')$$, t.v('bkA')), 'INVALID_TRANSITION');
select t.expect_ok('interviewer starts the interview (within 60 min of start)', format($$select start_interview((select id from interview_attempts where booking_id = '%s'))$$, t.v('bkA')));
select t.expect_error('scores outside 1–5 are rejected', format($$select submit_outcome((select id from interview_attempts where booking_id = '%s'),'PASS',9,4,4,'good')$$, t.v('bkA')), 'VALIDATION');
select t.expect_ok('interviewer records PASS', format($$select submit_outcome((select id from interview_attempts where booking_id = '%s'),'PASS',4,4,5,'Clear and structured')$$, t.v('bkA')));
select t.expect_error('double submission is rejected', format($$select submit_outcome((select id from interview_attempts where booking_id = '%s'),'FAIL',1,1,1,'changing my mind about this one')$$, t.v('bkA')), 'DUPLICATE');
select t.expect_error('a Pass cannot be amended away', format($$select amend_outcome((select id from interview_attempts where booking_id = '%s'),'FAIL',2,2,2,'Second thoughts after review','Panel disagreed')$$, t.v('bkA')), 'FORBIDDEN');
select t.expect_error('direct update of attempts is denied', $$update interview_attempts set outcome = 'FAIL'$$, '42501');
reset role;
select t.ok('PASS awarded the badge in the same transaction', (select status from student_badges where student_id = '10000000-0000-0000-0000-000000000001') = 'EARNED');
select t.ok('pass notification uses the exact message', exists (select 1 from notifications where user_id = '00000000-0000-0000-0000-0000000000a1' and title = 'Congratulations! You''ve passed your interview!'));
select t.expect_error('trigger blocks EARNED → NULLIFIED without review (even for the owner role)', $$update student_badges set status = 'NULLIFIED', nullified_at = now()$$, 'INVALID_TRANSITION');
select t.expect_error('attempts can never be deleted', $$delete from interview_attempts$$, 'APPEND_ONLY');
select t.expect_error('audit log is append-only', $$update audit_logs set action = 'x'$$, 'APPEND_ONLY');

-- Retake + cooldown + amendment + attempt limit (Rohan made eligible by the contest service)
set role service_role;
select set_config('request.jwt.claim.role', 'service_role', false);
select t.expect_ok('contest service records a cleared skill', $$select record_skill_cleared('10000000-0000-0000-0000-000000000003','50000000-0000-0000-0000-000000000002')$$);
select set_config('request.jwt.claim.role', 'authenticated', false);
reset role;
select t.ok('eligibility recomputed + exact eligibility message sent', is_eligible('10000000-0000-0000-0000-000000000003','40000000-0000-0000-0000-000000000001')
  and exists (select 1 from notifications where user_id = '00000000-0000-0000-0000-0000000000a3' and title = 'You''re eligible for your Track Badge interview!'));
set role authenticated;
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000a3', false);
select t.expect_ok('Rohan books the second near slot', format($$select t.set('bkR', book_slot('10000000-0000-0000-0000-000000000003','40000000-0000-0000-0000-000000000001','%s'))$$, t.v('near2')));
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000b1', false);
select t.expect_ok('Meera starts Rohan''s interview', format($$select start_interview((select id from interview_attempts where booking_id = '%s'))$$, t.v('bkR')));
select t.expect_error('retake needs ≥ 20 chars of feedback', format($$select submit_outcome((select id from interview_attempts where booking_id = '%s'),'RETAKE_LATER',3,3,3,'short')$$, t.v('bkR')), 'VALIDATION');
select t.expect_ok('Meera records RETAKE_LATER', format($$select submit_outcome((select id from interview_attempts where booking_id = '%s'),'RETAKE_LATER',3,3,3,'Close — revisit evaluation metrics and retry.')$$, t.v('bkR')));
select t.expect_error('amendment without a reason is rejected', format($$select amend_outcome((select id from interview_attempts where booking_id = '%s'),'FAIL',2,3,2,'Not ready on fundamentals; revisit basics.','')$$, t.v('bkR')), 'VALIDATION');
select t.expect_ok('amendment inside the window, with reason', format($$select amend_outcome((select id from interview_attempts where booking_id = '%s'),'FAIL',2,3,2,'Not ready on fundamentals; revisit basics.','Mis-clicked retake on submission')$$, t.v('bkR')));
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000a3', false);
select t.ok('journey after Fail = FAIL_COOLDOWN', (select state from student_journey('10000000-0000-0000-0000-000000000003','40000000-0000-0000-0000-000000000001')) = 'FAIL_COOLDOWN');
select t.expect_error('fail cooldown blocks rebooking', format($$select book_slot('10000000-0000-0000-0000-000000000003','40000000-0000-0000-0000-000000000001','%s')$$, t.v('far1')), 'COOLDOWN');
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000c1', false);
select t.expect_ok('ops sets cooldowns to 0 and max attempts to 1', $$select update_policies('{"failCooldownDays":0,"retakeCooldownDays":0,"maxAttemptsPerBadge":1}')$$);
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000a3', false);
select t.expect_error('attempt limit is enforced', format($$select book_slot('10000000-0000-0000-0000-000000000003','40000000-0000-0000-0000-000000000001','%s')$$, t.v('far1')), 'LIMIT_REACHED');
reset role;
select t.ok('amendment keeps both revisions', (select count(*) from outcome_revisions r join interview_attempts a on a.id = r.attempt_id where a.booking_id = t.v('bkR')) = 2);

-- ════════════════ Malpractice governance ════════════════
select t.set('sbA', (select id from student_badges where student_id = '10000000-0000-0000-0000-000000000001'));
set role authenticated;
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000b2', false);   -- Rahul never interviewed Aarav
select t.expect_error('interviewer cannot flag a student they never interviewed', format($$select flag_malpractice('%s','Suspicious similarity in answers','ref')$$, t.v('sbA')), 'FORBIDDEN');
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000a2', false);
select t.expect_error('a student cannot raise a flag', format($$select flag_malpractice('%s','Suspicious similarity in answers','ref')$$, t.v('sbA')), 'FORBIDDEN');
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000b1', false);   -- Meera interviewed Aarav
select t.expect_ok('assigned interviewer flags the badge', format($$select t.set('case1', flag_malpractice('%s','Reading answers off-screen during interview','rec 00:14'))$$, t.v('sbA')));
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000c2', false);   -- Karan
select t.expect_ok('ops raises a second flag', format($$select t.set('case2', flag_malpractice('%s','Peer report of a shared answer sheet','email'))$$, t.v('sbA')));
select t.expect_error('admin without reviewer rights cannot decide', format($$select decide_case('%s','DISMISSED','Looks fine to me honestly')$$, t.v('case2')), 'FORBIDDEN');
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000c1', false);   -- Priya, reviewer
select t.expect_error('cannot confirm before an investigation', format($$select decide_case('%s','CONFIRMED','Confirmed straight away')$$, t.v('case1')), 'INVALID_TRANSITION');
select t.expect_error('decision needs a reason', format($$select decide_case('%s','DISMISSED','ok')$$, t.v('case2')), 'VALIDATION');
select t.expect_ok('reviewer opens an investigation', format($$select start_investigation('%s','Reviewing recording')$$, t.v('case1')));
select t.expect_ok('reviewer dismisses the second case', format($$select decide_case('%s','DISMISSED','Answer sheet was the public syllabus')$$, t.v('case2')));
select t.ok('badge stays under review while another case is open', (select status from student_badges where id = t.v('sbA')) = 'UNDER_REVIEW');
select t.expect_ok('reviewer confirms the first case', format($$select decide_case('%s','CONFIRMED','Recording shows external assistance')$$, t.v('case1')));
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000a1', false);   -- Aarav
select t.ok('student sees the nullification notice', exists (select 1 from notifications where title = 'Your badge has been nullified'));
select t.ok('student can never read malpractice cases (evidence hidden)', (select count(*) from malpractice_cases) = 0);
select t.ok('student sees own badge as NULLIFIED with history kept', (select status = 'NULLIFIED' and earned_at is not null from student_badges where id = t.v('sbA'))
  and (select count(*) from badge_events where student_badge_id = t.v('sbA')) = 3);
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000b1', false);
select t.expect_error('a nullified badge cannot be flagged again', format($$select flag_malpractice('%s','Another concern about this badge','x')$$, t.v('sbA')), 'INVALID_TRANSITION');
select t.ok('interviewer sees only cases they reported', (select count(*) from malpractice_cases) = 1);

-- ════════════════ Requirement change: re-evaluate, grandfather bookings ════════════════
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000c1', false);
select t.expect_ok('ops adds a required skill to Novice', $$select set_skill_required('40000000-0000-0000-0000-000000000001','50000000-0000-0000-0000-000000000003', true)$$);
reset role;
select t.ok('unbooked students re-evaluated (no longer eligible)', not is_eligible('10000000-0000-0000-0000-000000000003','40000000-0000-0000-0000-000000000001'));
select t.ok('booked student keeps the booking (grandfathered)', (select status from interview_bookings where id = t.v('bkT')) = 'BOOKED');

-- ════════════════ Audit completeness ════════════════
select t.ok('every write produced an audit record', (select count(distinct action) from audit_logs where action in (
  'settings.updated','availability.added','booking.created','booking.rescheduled','booking.reassigned','interview.in_progress','outcome.submitted',
  'outcome.amended','badge.earned','skill.cleared','eligibility.granted','malpractice.flagged','badge.under_review','malpractice.under_investigation',
  'malpractice.dismissed','malpractice.confirmed','badge.nullified','badge.requirements_changed')) = 18);

-- ════════════════ Privilege sweep (catches anything added later) ════════════════
select t.ok('anon can execute NO public function', not exists (
  select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and has_function_privilege('anon', p.oid, 'execute')));
select t.ok('no client role can INSERT/UPDATE/DELETE any public table', not exists (
  select 1 from pg_class c join pg_namespace n on n.oid = c.relnamespace where n.nspname = 'public' and c.relkind = 'r' and (
    has_table_privilege('anon', c.oid, 'INSERT,UPDATE,DELETE,TRUNCATE') or has_table_privilege('authenticated', c.oid, 'INSERT,UPDATE,DELETE,TRUNCATE'))));
select t.ok('RLS is enabled on every public table', not exists (select 1 from pg_tables where schemaname = 'public' and not rowsecurity));
select t.ok('every SECURITY DEFINER function pins search_path', not exists (
  select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and p.prosecdef
    and not exists (select 1 from unnest(coalesce(p.proconfig, '{}')) c where c like 'search_path=%')));
select t.ok('internal helpers (_*) are not executable by signed-in users', not exists (
  select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and p.proname like '\_%' and has_function_privilege('authenticated', p.oid, 'execute')));

-- ════════════════ Report ════════════════
\set QUIET off
\pset tuples_only off
select case when passed then 'PASS' else 'FAIL' end as result, name, case when passed then '' else detail end as detail from t.results order by seq;
select count(*) filter (where passed) as passed, count(*) filter (where not passed) as failed from t.results;
do $$ begin if exists (select 1 from t.results where not passed) then raise exception 'DATABASE TESTS FAILED'; end if; end $$;
