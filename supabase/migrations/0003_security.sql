-- ════════════════════════════════════════════════════════════════════
-- GRIT Interview Hub · 0003 security
-- Deny by default: anon gets nothing; authenticated gets SELECT through RLS
-- and EXECUTE on the client RPCs only. No client can INSERT/UPDATE/DELETE a table.
-- ════════════════════════════════════════════════════════════════════

-- ── 1. Table privileges ──────────────────────────────────────────────
revoke all on all tables    in schema public from public, anon, authenticated;
revoke all on all sequences in schema public from public, anon, authenticated;
grant select on all tables in schema public to authenticated;            -- rows still filtered by RLS below
alter default privileges in schema public revoke all on tables from public, anon, authenticated;
alter default privileges in schema public revoke execute on functions from public, anon, authenticated;

-- ── 2. Function privileges: Postgres grants EXECUTE to PUBLIC by default — remove it everywhere ──
revoke execute on all functions in schema public from public, anon, authenticated;
-- client RPCs (each authorises the caller itself)
grant execute on function
  student_journey(uuid, uuid), book_slot(uuid, uuid, uuid, text), cancel_booking(uuid, text), reschedule_booking(uuid, uuid),
  add_availability(uuid, timestamptz, timestamptz, int), remove_availability(uuid), set_slot_blocked(uuid, boolean),
  interviewer_unavailable(uuid, text), start_interview(uuid), mark_student_no_show(uuid), mark_interviewer_no_show(uuid),
  submit_outcome(uuid, outcome, int, int, int, text), amend_outcome(uuid, outcome, int, int, int, text, text),
  flag_malpractice(uuid, text, text), start_investigation(uuid, text), decide_case(uuid, case_status, text),
  record_skill_cleared(uuid, uuid), nudge_student(uuid), remind_interviewer(uuid), update_policies(jsonb),
  set_skill_required(uuid, uuid, boolean), set_interviewer_active(uuid, boolean), mark_notifications_read(uuid[]),
  is_eligible(uuid, uuid)
to authenticated;
-- helpers evaluated inside RLS policies must be executable by the querying role
grant execute on function app_role(), my_student_id(), my_interviewer_id(), my_assigned_students() to authenticated;
-- service role (contest-results integration) may record skills without a user session
do $$ begin
  if exists (select from pg_roles where rolname = 'service_role') then
    execute 'grant execute on function record_skill_cleared(uuid, uuid) to service_role';
  end if;
end $$;

-- ── 3. Row Level Security on EVERY table ─────────────────────────────
do $$ declare t text; begin
  for t in select tablename from pg_tables where schemaname = 'public' loop
    execute format('alter table %I enable row level security', t);
  end loop;
end $$;

-- Identity: you see yourself; ops see everyone; interviewer names are visible to signed-in users
-- (students need them on bookings); interviewers see the students they are assigned to.
create policy users_read on users for select to authenticated using (
  id = auth.uid() or app_role() = 'ADMIN' or role = 'INTERVIEWER'
  or id in (select user_id from students where id in (select my_assigned_students())));
create policy students_read on students for select to authenticated using (
  id = my_student_id() or app_role() = 'ADMIN' or id in (select my_assigned_students()));
create policy interviewers_read on interviewers for select to authenticated using (true);

-- Catalogue + policies: readable by any signed-in user
create policy tracks_read   on tracks                   for select to authenticated using (true);
create policy badgedef_read on badge_definitions        for select to authenticated using (true);
create policy skills_read   on skills                   for select to authenticated using (true);
create policy reqs_read     on badge_skill_requirements for select to authenticated using (true);
create policy settings_read on system_settings          for select to authenticated using (true);

create policy progress_read on student_skill_progress for select to authenticated using (
  student_id = my_student_id() or app_role() = 'ADMIN' or student_id in (select my_assigned_students()));

-- Scheduling: open slots are visible to signed-in users (to book); windows only to their owner and ops
create policy slots_read   on interview_slots      for select to authenticated using (true);
create policy windows_read on availability_windows for select to authenticated using (interviewer_id = my_interviewer_id() or app_role() = 'ADMIN');

create policy bookings_read on interview_bookings for select to authenticated using (
  student_id = my_student_id() or app_role() = 'ADMIN'
  or exists (select 1 from interview_attempts a where a.booking_id = interview_bookings.id and a.interviewer_id = my_interviewer_id()));
create policy attempts_read on interview_attempts for select to authenticated using (
  student_id = my_student_id() or app_role() = 'ADMIN' or interviewer_id = my_interviewer_id()
  or student_id in (select my_assigned_students()));            -- interviewer sees prior attempts of assigned students
create policy revisions_read on outcome_revisions for select to authenticated using (
  exists (select 1 from interview_attempts a where a.id = attempt_id));   -- inherits attempts_read via RLS on the subquery

create policy badges_read on student_badges for select to authenticated using (
  student_id = my_student_id() or app_role() = 'ADMIN' or student_id in (select my_assigned_students()));
create policy badge_events_read on badge_events for select to authenticated using (
  exists (select 1 from student_badges b where b.id = student_badge_id));

-- Malpractice: never visible to the student; ops see all; an interviewer sees only cases they reported
create policy cases_read on malpractice_cases for select to authenticated using (app_role() = 'ADMIN' or reported_by = auth.uid());
create policy case_events_read on case_events for select to authenticated using (
  exists (select 1 from malpractice_cases c where c.id = case_id));

create policy notifications_read on notifications for select to authenticated using (user_id = auth.uid());
create policy audit_read on audit_logs for select to authenticated using (app_role() = 'ADMIN');

-- No INSERT/UPDATE/DELETE policies exist on any table: every write goes through the RPCs in 0002.

-- ── 4. Realtime (Supabase): dashboards refresh on change; RLS still applies to what each user receives ──
do $$ begin
  if exists (select from pg_publication where pubname = 'supabase_realtime') then
    execute 'alter publication supabase_realtime add table interview_slots, interview_bookings, interview_attempts, student_badges, notifications';
  end if;
end $$;
