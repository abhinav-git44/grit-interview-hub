-- ════════════════════════════════════════════════════════════════════
-- GRIT Interview Hub · 0001 schema
-- One column/table per lifecycle dimension, DB-level booking protection,
-- append-only history, transition guards. Functions: 0002. Security: 0003.
-- ════════════════════════════════════════════════════════════════════
create extension if not exists btree_gist;
create extension if not exists pgcrypto;

create type user_role         as enum ('STUDENT','INTERVIEWER','ADMIN');
create type skill_status      as enum ('NOT_STARTED','IN_PROGRESS','CLEARED');
create type slot_status       as enum ('OPEN','BOOKED','BLOCKED','REMOVED');
create type booking_status    as enum ('BOOKED','RESCHEDULED','CANCELLED','COMPLETED');
create type interview_status  as enum ('SCHEDULED','IN_PROGRESS','COMPLETED','CANCELLED');
create type attendance_status as enum ('PENDING','PRESENT','STUDENT_NO_SHOW','INTERVIEWER_NO_SHOW');
create type outcome           as enum ('PENDING','PASS','FAIL','RETAKE_LATER');
create type badge_status      as enum ('EARNED','UNDER_REVIEW','NULLIFIED');
create type case_status       as enum ('FLAGGED','UNDER_INVESTIGATION','CONFIRMED','DISMISSED');

-- ── Identity (users.id = auth.users.id) ──────────────────────────────
create table users (
  id uuid primary key, full_name text not null, email text not null unique,
  role user_role not null, is_active boolean not null default true,
  can_review_malpractice boolean not null default false,
  can_edit_settings boolean not null default false,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  constraint permissions_admin_only check (role = 'ADMIN' or (not can_review_malpractice and not can_edit_settings))
);
create table students (
  id uuid primary key default gen_random_uuid(), user_id uuid not null unique references users(id),
  student_code text not null unique, campus text, batch int,
  timezone text not null default 'Asia/Kolkata', created_at timestamptz not null default now()
);
create table interviewers (
  id uuid primary key default gen_random_uuid(), user_id uuid not null unique references users(id),
  employee_code text not null unique, specialization text, is_active boolean not null default true,
  timezone text not null default 'Asia/Kolkata', created_at timestamptz not null default now()
);

-- ── Catalogue: tracks have several badge LEVELS, each with its own skills ──
create table tracks (id uuid primary key default gen_random_uuid(), name text not null unique, description text, is_active boolean not null default true);
create table badge_definitions (
  id uuid primary key default gen_random_uuid(), track_id uuid not null references tracks(id),
  level text not null, level_order int not null check (level_order > 0), name text not null,
  unique (track_id, level_order), unique (track_id, level)
);
create table skills (id uuid primary key default gen_random_uuid(), track_id uuid not null references tracks(id), name text not null, unique (track_id, name));
create table badge_skill_requirements (
  badge_definition_id uuid not null references badge_definitions(id),
  skill_id uuid not null references skills(id),
  primary key (badge_definition_id, skill_id)
);
create table student_skill_progress (
  student_id uuid not null references students(id), skill_id uuid not null references skills(id),
  status skill_status not null default 'NOT_STARTED', cleared_at timestamptz,
  primary key (student_id, skill_id),
  check ((status = 'CLEARED') = (cleared_at is not null))
);

-- ── Scheduling ───────────────────────────────────────────────────────
create table availability_windows (
  id uuid primary key default gen_random_uuid(), interviewer_id uuid not null references interviewers(id),
  period tstzrange not null check (not isempty(period)), series_id uuid,
  created_at timestamptz not null default now(), removed_at timestamptz,
  constraint no_overlapping_windows exclude using gist (interviewer_id with =, period with &&) where (removed_at is null)
);
create table interview_slots (
  id uuid primary key default gen_random_uuid(), interviewer_id uuid not null references interviewers(id),
  window_id uuid not null references availability_windows(id), period tstzrange not null,
  status slot_status not null default 'OPEN', created_at timestamptz not null default now(),
  constraint no_overlapping_slots exclude using gist (interviewer_id with =, period with &&) where (status in ('OPEN','BOOKED'))
);
create index interview_slots_open_idx on interview_slots (status, (lower(period)));

create table interview_bookings (
  id uuid primary key default gen_random_uuid(), student_id uuid not null references students(id),
  badge_definition_id uuid not null references badge_definitions(id), slot_id uuid not null references interview_slots(id),
  status booking_status not null default 'BOOKED', meeting_link text,
  idempotency_key text, reschedule_count int not null default 0 check (reschedule_count >= 0),
  rescheduled_from_id uuid references interview_bookings(id), rescheduled_to_id uuid references interview_bookings(id),
  priority_rebook boolean not null default false,
  booked_at timestamptz not null default now(), eligibility_snapshot_at timestamptz not null default now(),
  cancelled_at timestamptz, cancelled_by uuid references users(id), cancellation_reason text,
  check ((status = 'CANCELLED') = (cancelled_at is not null)),
  unique (student_id, idempotency_key)
);
-- DB-level double-booking protection (final backstop behind the row lock in book_slot)
create unique index one_active_booking_per_slot  on interview_bookings (slot_id) where status = 'BOOKED';
create unique index one_active_booking_per_badge on interview_bookings (student_id, badge_definition_id) where status = 'BOOKED';

-- ── Attempts: never overwritten, never deleted; a retake is a new row ──
create table interview_attempts (
  id uuid primary key default gen_random_uuid(), booking_id uuid not null references interview_bookings(id),
  student_id uuid not null references students(id), badge_definition_id uuid not null references badge_definitions(id),
  interviewer_id uuid not null references interviewers(id), attempt_number int not null check (attempt_number > 0),
  interview_status interview_status not null default 'SCHEDULED',
  attendance attendance_status not null default 'PENDING',
  outcome outcome not null default 'PENDING',
  score_technical smallint check (score_technical between 1 and 5),
  score_communication smallint check (score_communication between 1 and 5),
  score_problem_solving smallint check (score_problem_solving between 1 and 5),
  feedback text, started_at timestamptz, submitted_at timestamptz, submitted_by uuid references users(id),
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  check (outcome = 'PENDING' or interview_status = 'COMPLETED'),
  check (outcome in ('PENDING','PASS') or length(coalesce(feedback,'')) >= 20)
);
create index interview_attempts_iv_idx on interview_attempts (interviewer_id, interview_status);
create index interview_attempts_student_idx on interview_attempts (student_id, badge_definition_id);
create table outcome_revisions (
  id bigserial primary key, attempt_id uuid not null references interview_attempts(id),
  outcome outcome not null, feedback text, reason text,
  changed_by uuid not null references users(id), changed_at timestamptz not null default now()
);

-- ── Badges & malpractice (history is never deleted) ──────────────────
create table student_badges (
  id uuid primary key default gen_random_uuid(), student_id uuid not null references students(id),
  badge_definition_id uuid not null references badge_definitions(id), attempt_id uuid not null references interview_attempts(id),
  status badge_status not null default 'EARNED', earned_at timestamptz not null default now(), nullified_at timestamptz,
  unique (student_id, badge_definition_id),
  check ((status = 'NULLIFIED') = (nullified_at is not null))
);
create table badge_events (
  id bigserial primary key, student_badge_id uuid not null references student_badges(id),
  from_status badge_status, to_status badge_status not null, note text,
  by_user uuid references users(id), at timestamptz not null default now()
);
create table malpractice_cases (
  id uuid primary key default gen_random_uuid(), student_id uuid not null references students(id),
  student_badge_id uuid not null references student_badges(id), reported_by uuid not null references users(id),
  description text not null check (length(description) >= 15), evidence_reference text,
  status case_status not null default 'FLAGGED', decision_reason text,
  reviewed_by uuid references users(id), reviewed_at timestamptz, created_at timestamptz not null default now(),
  check (status not in ('CONFIRMED','DISMISSED') or (reviewed_by is not null and length(coalesce(decision_reason,'')) >= 15))
);
create table case_events (
  id bigserial primary key, case_id uuid not null references malpractice_cases(id),
  action text not null, note text, by_user uuid references users(id), at timestamptz not null default now()
);

-- ── Comms, audit, settings ───────────────────────────────────────────
create table notifications (
  id uuid primary key default gen_random_uuid(), user_id uuid not null references users(id), type text not null,
  title text not null, body text not null, cta_label text, cta_target text,
  is_read boolean not null default false,
  delivery_status text not null default 'QUEUED' check (delivery_status in ('QUEUED','DELIVERED','FAILED')),
  created_at timestamptz not null default now()
);
create index notifications_user_idx on notifications (user_id, is_read);
create table audit_logs (
  id bigserial primary key, actor_id uuid, action text not null, entity_type text not null, entity_id text not null,
  old_value jsonb, new_value jsonb, metadata jsonb, created_at timestamptz not null default now()
);
create index audit_logs_entity_idx on audit_logs (entity_type, entity_id);
create table system_settings (
  setting_key text primary key, setting_value jsonb not null,
  updated_by uuid references users(id), updated_at timestamptz not null default now()
);
-- Illustrative defaults (assumptions, not confirmed GRIT policy) — editable via update_policies()
insert into system_settings (setting_key, setting_value) values ('policies', jsonb_build_object(
  'interviewDurationMin',30,'slotBufferMin',10,'minBookingLeadHours',2,'cancelRescheduleCutoffHours',12,
  'maxReschedulesPerBooking',2,'retakeCooldownDays',5,'failCooldownDays',14,'maxAttemptsPerBadge',3,
  'studentNoShowCountsAsAttempt',true,'studentNoShowCooldownDays',3,'outcomeEditWindowHours',24,'bookingHorizonDays',21));

-- ════════════════════════════════════════════════════════════════════
-- Transition guards: the DB enforces the same transition tables as src/domain/stateMachine.ts
-- ════════════════════════════════════════════════════════════════════
create or replace function guard_transition() returns trigger language plpgsql as $$
declare ok boolean := true;
begin
  if TG_TABLE_NAME = 'student_badges' then
    if new.status is distinct from old.status then
      ok := (old.status, new.status) in (('EARNED','UNDER_REVIEW'),('UNDER_REVIEW','EARNED'),('UNDER_REVIEW','NULLIFIED'));
    end if;
  elsif TG_TABLE_NAME = 'malpractice_cases' then
    if new.status is distinct from old.status then
      ok := (old.status, new.status) in (('FLAGGED','UNDER_INVESTIGATION'),('FLAGGED','DISMISSED'),('UNDER_INVESTIGATION','CONFIRMED'),('UNDER_INVESTIGATION','DISMISSED'));
    end if;
  elsif TG_TABLE_NAME = 'interview_bookings' then
    if new.status is distinct from old.status then ok := old.status = 'BOOKED'; end if;
  elsif TG_TABLE_NAME = 'interview_slots' then
    if new.status is distinct from old.status then
      ok := (old.status, new.status) in (('OPEN','BOOKED'),('OPEN','BLOCKED'),('OPEN','REMOVED'),('BOOKED','OPEN'),('BOOKED','BLOCKED'),('BLOCKED','OPEN'),('BLOCKED','REMOVED'));
    end if;
  elsif TG_TABLE_NAME = 'interview_attempts' then
    if new.interview_status is distinct from old.interview_status then
      ok := (old.interview_status, new.interview_status) in (('SCHEDULED','IN_PROGRESS'),('SCHEDULED','CANCELLED'),('SCHEDULED','COMPLETED'),('IN_PROGRESS','COMPLETED'),('IN_PROGRESS','CANCELLED'));
    end if;
    if ok and new.attendance is distinct from old.attendance then ok := old.attendance = 'PENDING'; end if;
    -- a submitted outcome changes only through amend_outcome(), which sets this transaction-local flag
    if ok and new.outcome is distinct from old.outcome then
      ok := old.outcome = 'PENDING' or current_setting('grit.amending', true) = 'on';
    end if;
  end if;
  if not ok then raise exception 'INVALID_TRANSITION: % cannot change that way', TG_TABLE_NAME using errcode = 'P0001'; end if;
  return new;
end $$;
create trigger t_badge_guard   before update on student_badges     for each row execute function guard_transition();
create trigger t_case_guard    before update on malpractice_cases  for each row execute function guard_transition();
create trigger t_booking_guard before update on interview_bookings for each row execute function guard_transition();
create trigger t_slot_guard    before update on interview_slots    for each row execute function guard_transition();
create trigger t_attempt_guard before update on interview_attempts for each row execute function guard_transition();

create or replace function deny_change() returns trigger language plpgsql as $$
begin raise exception 'APPEND_ONLY: % rows cannot be changed or deleted', TG_TABLE_NAME using errcode = 'P0001'; end $$;
create trigger t_audit_ro     before update or delete on audit_logs        for each row execute function deny_change();
create trigger t_badge_ev_ro  before update or delete on badge_events      for each row execute function deny_change();
create trigger t_case_ev_ro   before update or delete on case_events       for each row execute function deny_change();
create trigger t_revision_ro  before update or delete on outcome_revisions for each row execute function deny_change();
create trigger t_attempt_keep before delete on interview_attempts for each row execute function deny_change();
create trigger t_badge_keep   before delete on student_badges     for each row execute function deny_change();
create trigger t_case_keep    before delete on malpractice_cases  for each row execute function deny_change();
create trigger t_booking_keep before delete on interview_bookings for each row execute function deny_change();
