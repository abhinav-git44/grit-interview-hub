-- ════════════════════════════════════════════════════════════════════
-- GRIT Interview Hub · 0002 business logic
-- Every client write goes through one of these SECURITY DEFINER functions.
-- Each one: (1) identifies the caller from auth.uid() — never from an argument,
-- (2) checks role + ownership, (3) enforces the same rules as src/domain/services.ts,
-- (4) writes audit + notification in the same transaction.
-- Errors are raised as 'CODE: human message' (SQLSTATE P0001).
-- ════════════════════════════════════════════════════════════════════

-- ── Internal helpers (not executable by clients — see 0003) ─────────
create or replace function _fail(p_code text, p_msg text) returns void language plpgsql as $$
begin raise exception '%: %', p_code, p_msg using errcode = 'P0001'; end $$;

create or replace function _actor() returns users language plpgsql stable security definer set search_path = public, pg_temp as $$
declare u users;
begin
  if auth.uid() is null then perform _fail('UNAUTHENTICATED', 'Sign in to continue.'); end if;
  select * into u from users where id = auth.uid();
  if not found then perform _fail('UNAUTHENTICATED', 'No GRIT account is linked to this login.'); end if;
  if not u.is_active then perform _fail('FORBIDDEN', 'Your account is inactive.'); end if;
  return u;
end $$;

create or replace function _is_service() returns boolean language sql stable as $$
  select coalesce(auth.role() = 'service_role', false) $$;

create or replace function _pol(p_key text) returns jsonb language sql stable security definer set search_path = public, pg_temp as $$
  select setting_value -> p_key from system_settings where setting_key = 'policies' $$;
create or replace function _pol_int(p_key text) returns int language sql stable as $$ select (_pol(p_key))::text::int $$;

create or replace function _audit(p_actor uuid, p_action text, p_type text, p_id text, p_old jsonb default null, p_new jsonb default null, p_meta jsonb default null)
returns void language sql security definer set search_path = public, pg_temp as $$
  insert into audit_logs (actor_id, action, entity_type, entity_id, old_value, new_value, metadata)
  values (p_actor, p_action, p_type, p_id, p_old, p_new, p_meta) $$;

create or replace function _notify(p_user uuid, p_type text, p_title text, p_body text, p_cta_label text default null, p_cta_target text default null)
returns void language sql security definer set search_path = public, pg_temp as $$
  -- QUEUED: an Edge Function / worker delivers email and flips it to DELIVERED or FAILED; the action never depends on it
  insert into notifications (user_id, type, title, body, cta_label, cta_target)
  values (p_user, p_type, p_title, p_body, p_cta_label, p_cta_target) $$;

create or replace function _student_user(p_student uuid) returns uuid language sql stable security definer set search_path = public, pg_temp as $$
  select user_id from students where id = p_student $$;
create or replace function _badge_label(p_badge uuid) returns text language sql stable security definer set search_path = public, pg_temp as $$
  select t.name || ' · ' || d.level from badge_definitions d join tracks t on t.id = d.track_id where d.id = p_badge $$;
create or replace function _fmt(p_ts timestamptz, p_tz text) returns text language sql stable as $$
  select to_char(p_ts at time zone p_tz, 'Dy, DD Mon YYYY, HH12:MI AM') $$;

create or replace function _assert_student_self_or_admin(u users, p_student uuid) returns void language plpgsql stable security definer set search_path = public, pg_temp as $$
begin
  if u.role = 'ADMIN' then return; end if;
  if u.role = 'STUDENT' and exists (select 1 from students where id = p_student and user_id = u.id) then return; end if;
  perform _fail('FORBIDDEN', 'You can only act on your own records.');
end $$;

create or replace function _assert_interviewer_self_or_admin(u users, p_interviewer uuid) returns void language plpgsql stable security definer set search_path = public, pg_temp as $$
begin
  if u.role = 'ADMIN' then return; end if;
  if u.role = 'INTERVIEWER' and exists (select 1 from interviewers where id = p_interviewer and user_id = u.id) then return; end if;
  perform _fail('FORBIDDEN', 'You can only manage your own schedule and assigned interviews.');
end $$;

-- ════════════════════════════════════════════════════════════════════
-- Eligibility (computed, never a flag) and the derived journey state
-- ════════════════════════════════════════════════════════════════════
create or replace function is_eligible(p_student uuid, p_badge uuid) returns boolean language sql stable security definer set search_path = public, pg_temp as $$
  select exists (select 1 from badge_skill_requirements where badge_definition_id = p_badge)
     and not exists (
       select 1 from badge_skill_requirements r
       left join student_skill_progress p on p.skill_id = r.skill_id and p.student_id = p_student
       where r.badge_definition_id = p_badge and coalesce(p.status, 'NOT_STARTED') <> 'CLEARED')
     and not exists (   -- a higher level needs the previous level held (earned or under review)
       select 1 from badge_definitions d
       join badge_definitions prev on prev.track_id = d.track_id and prev.level_order = d.level_order - 1
       where d.id = p_badge and not exists (
         select 1 from student_badges sb where sb.student_id = p_student and sb.badge_definition_id = prev.id and sb.status <> 'NULLIFIED'));
$$;

create or replace function _counts_as_attempt(a interview_attempts) returns boolean language sql stable as $$
  select case
    when a.interview_status = 'CANCELLED' then false
    when a.attendance = 'INTERVIEWER_NO_SHOW' then false
    when a.attendance = 'STUDENT_NO_SHOW' then coalesce((_pol('studentNoShowCountsAsAttempt'))::text::boolean, true)
    else a.interview_status = 'COMPLETED' and a.outcome <> 'PENDING' end $$;

-- Mirrors deriveJourney() in src/domain/eligibility.ts
create or replace function _journey(p_student uuid, p_badge uuid)
returns table (state text, can_book boolean, next_bookable_at timestamptz, attempts_used int, attempts_left int, active_booking uuid)
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare
  sb student_badges; b interview_bookings; s interview_slots; a interview_attempts; last_a interview_attempts;
  used int; max_att int := _pol_int('maxAttemptsPerBadge'); elig boolean := is_eligible(p_student, p_badge);
  cool int; until timestamptz;
begin
  select count(*) filter (where _counts_as_attempt(x)) into used from interview_attempts x where x.student_id = p_student and x.badge_definition_id = p_badge;
  attempts_used := used; attempts_left := greatest(0, max_att - used);
  select * into sb from student_badges where student_id = p_student and badge_definition_id = p_badge;
  if found then
    state := case sb.status when 'EARNED' then 'PASSED' when 'UNDER_REVIEW' then 'BADGE_UNDER_REVIEW' else 'BADGE_NULLIFIED' end;
    can_book := false; return next; return;
  end if;
  select * into b from interview_bookings where student_id = p_student and badge_definition_id = p_badge and status = 'BOOKED';
  if found then
    select * into s from interview_slots where id = b.slot_id;
    select * into a from interview_attempts where booking_id = b.id;
    active_booking := b.id; can_book := false;
    state := case when upper(s.period) < now() then 'AWAITING_RESULT' when a.interview_status = 'IN_PROGRESS' then 'IN_INTERVIEW' else 'BOOKED' end;
    return next; return;
  end if;
  select * into last_a from interview_attempts where student_id = p_student and badge_definition_id = p_badge and interview_status = 'COMPLETED'
    order by attempt_number desc, created_at desc limit 1;
  if found then
    if attempts_left = 0 then state := 'ATTEMPTS_EXHAUSTED'; can_book := false; return next; return; end if;
    if last_a.attendance = 'INTERVIEWER_NO_SHOW' then state := 'PRIORITY_REBOOK'; can_book := elig; return next; return; end if;
    cool := case when last_a.attendance = 'STUDENT_NO_SHOW' then _pol_int('studentNoShowCooldownDays')
                 when last_a.outcome = 'RETAKE_LATER' then _pol_int('retakeCooldownDays')
                 when last_a.outcome = 'FAIL' then _pol_int('failCooldownDays') else 0 end;
    until := coalesce(last_a.submitted_at, last_a.created_at) + make_interval(days => cool);
    next_bookable_at := until;
    if last_a.attendance = 'STUDENT_NO_SHOW' then state := case when until > now() then 'NO_SHOW_COOLDOWN' else 'ELIGIBLE' end;
    elsif last_a.outcome = 'RETAKE_LATER' then state := case when until > now() then 'RETAKE_COOLDOWN' else 'RETAKE_ELIGIBLE' end;
    elsif last_a.outcome = 'FAIL' then state := case when until > now() then 'FAIL_COOLDOWN' else 'FAIL_REBOOKABLE' end;
    end if;
    if state is not null then can_book := until <= now() and elig; return next; return; end if;
  end if;
  if elig and exists (select 1 from interview_bookings where student_id = p_student and badge_definition_id = p_badge and status = 'CANCELLED' and priority_rebook
                      and cancelled_at = (select max(cancelled_at) from interview_bookings where student_id = p_student and badge_definition_id = p_badge and status = 'CANCELLED')) then
    state := 'PRIORITY_REBOOK'; can_book := true; return next; return;
  end if;
  state := case when elig then 'ELIGIBLE' else 'NOT_ELIGIBLE' end; can_book := elig; return next;
end $$;

-- Client-facing: only the student, their assigned interviewers, or ops may read a journey.
create or replace function student_journey(p_student uuid, p_badge uuid)
returns table (state text, can_book boolean, next_bookable_at timestamptz, attempts_used int, attempts_left int, active_booking uuid)
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare u users := _actor();
begin
  if not (u.role = 'ADMIN' or exists (select 1 from students where id = p_student and user_id = u.id)
          or exists (select 1 from interview_attempts a join interviewers i on i.id = a.interviewer_id where a.student_id = p_student and i.user_id = u.id)) then
    perform _fail('FORBIDDEN', 'You cannot view this student.');
  end if;
  return query select * from _journey(p_student, p_badge);
end $$;

-- ════════════════════════════════════════════════════════════════════
-- BOOKING
-- ════════════════════════════════════════════════════════════════════
create or replace function _validate_slot_for_booking(s interview_slots, p_student uuid, p_ignore_booking uuid) returns void
language plpgsql stable security definer set search_path = public, pg_temp as $$
begin
  if lower(s.period) <= now() then perform _fail('SLOT_IN_PAST', 'That slot is in the past. Please pick another time.'); end if;
  if s.status <> 'OPEN' then perform _fail('SLOT_TAKEN', 'Sorry — someone just booked that slot. Please pick another time.'); end if;
  if lower(s.period) < now() + make_interval(hours => _pol_int('minBookingLeadHours')) then
    perform _fail('CUTOFF_PASSED', format('Slots must be booked at least %s hours in advance.', _pol_int('minBookingLeadHours'))); end if;
  if lower(s.period) > now() + make_interval(days => _pol_int('bookingHorizonDays')) then
    perform _fail('VALIDATION', format('Slots can be booked at most %s days ahead.', _pol_int('bookingHorizonDays'))); end if;
  if not (select is_active from interviewers where id = s.interviewer_id) then
    perform _fail('INACTIVE', 'That interviewer is no longer available. Please pick another slot.'); end if;
  if exists (select 1 from interview_bookings b join interview_slots x on x.id = b.slot_id
             where b.student_id = p_student and b.status = 'BOOKED' and b.id is distinct from p_ignore_booking and x.period && s.period) then
    perform _fail('ALREADY_BOOKED', 'You already have an interview at that time.'); end if;
end $$;

create or replace function book_slot(p_student uuid, p_badge uuid, p_slot uuid, p_idempotency_key text default null)
returns uuid language plpgsql security definer set search_path = public, pg_temp as $$
declare u users := _actor(); s interview_slots; j record; b_id uuid; a_id uuid; n int; st students;
begin
  perform _assert_student_self_or_admin(u, p_student);
  select * into st from students where id = p_student;
  if not found then perform _fail('NOT_FOUND', 'Student not found'); end if;
  if not exists (select 1 from badge_definitions where id = p_badge) then perform _fail('NOT_FOUND', 'Badge not found'); end if;
  -- serialise all booking attempts for this student × badge, then for the slot
  perform pg_advisory_xact_lock(hashtextextended(p_student::text || p_badge::text, 0));
  if p_idempotency_key is not null then
    select id into b_id from interview_bookings where student_id = p_student and idempotency_key = p_idempotency_key;
    if found then return b_id; end if;                      -- retried request → original booking
  end if;
  select * into j from _journey(p_student, p_badge);
  if j.active_booking is not null then perform _fail('ALREADY_BOOKED', 'You already have an interview booked for this badge. Reschedule it instead.'); end if;
  if j.state in ('PASSED','BADGE_UNDER_REVIEW','BADGE_NULLIFIED') then perform _fail('VALIDATION', 'This badge interview is already complete.'); end if;
  if j.state = 'ATTEMPTS_EXHAUSTED' then perform _fail('LIMIT_REACHED', 'You have used all interview attempts for this badge.'); end if;
  if not is_eligible(p_student, p_badge) then perform _fail('NOT_ELIGIBLE', 'Clear all required skills before booking this interview.'); end if;
  if not j.can_book then perform _fail('COOLDOWN', format('You can book your next attempt from %s.', _fmt(j.next_bookable_at, st.timezone))); end if;

  select * into s from interview_slots where id = p_slot for update;          -- row lock: concurrent requests queue here
  if not found then perform _fail('NOT_FOUND', 'Slot not found'); end if;
  perform _validate_slot_for_booking(s, p_student, null);

  update interview_slots set status = 'BOOKED' where id = p_slot;
  insert into interview_bookings (student_id, badge_definition_id, slot_id, idempotency_key, meeting_link)
    values (p_student, p_badge, p_slot, p_idempotency_key, 'https://meet.grit.example/' || st.student_code || '-' || left(p_slot::text, 8))
    returning id into b_id;
  select count(*) + 1 into n from interview_attempts where student_id = p_student and badge_definition_id = p_badge and interview_status <> 'CANCELLED';
  insert into interview_attempts (booking_id, student_id, badge_definition_id, interviewer_id, attempt_number)
    values (b_id, p_student, p_badge, s.interviewer_id, n) returning id into a_id;
  perform _audit(u.id, 'booking.created', 'booking', b_id::text, null, '"BOOKED"', jsonb_build_object('slot_id', p_slot, 'attempt_id', a_id, 'attempt_number', n));
  perform _notify(st.user_id, 'BOOKING_CONFIRMED', 'Your interview is confirmed!',
    'Your Track Badge interview has been successfully scheduled.' || E'\n\n' ||
    'Date: ' || to_char(lower(s.period) at time zone st.timezone, 'Dy, DD Mon YYYY') || E'\n' ||
    'Time: ' || to_char(lower(s.period) at time zone st.timezone, 'HH12:MI AM') || ' ' || case st.timezone when 'Asia/Kolkata' then 'IST' else st.timezone end || E'\n' ||
    'Interviewer: ' || (select full_name from users join interviewers i on i.user_id = users.id where i.id = s.interviewer_id) || E'\nMode: Online\n\n' ||
    'Please join using the interview link at your scheduled time. We recommend joining 5 minutes early.',
    'View Interview Details', 'student/interviews');
  return b_id;
end $$;

create or replace function _assert_before_cutoff(u users, s interview_slots, p_verb text) returns void language plpgsql stable security definer set search_path = public, pg_temp as $$
begin
  if u.role = 'ADMIN' then return; end if;   -- ops override (audited by the caller)
  if lower(s.period) - now() < make_interval(hours => _pol_int('cancelRescheduleCutoffHours')) then
    perform _fail('CUTOFF_PASSED', format('Interviews can''t be %s less than %s hours before the start time. Contact the GRIT team if this is an emergency.', p_verb, _pol_int('cancelRescheduleCutoffHours')));
  end if;
end $$;

create or replace function cancel_booking(p_booking uuid, p_reason text default null)
returns void language plpgsql security definer set search_path = public, pg_temp as $$
declare u users := _actor(); b interview_bookings; s interview_slots; a interview_attempts; st students;
begin
  select * into b from interview_bookings where id = p_booking for update;
  if not found then perform _fail('NOT_FOUND', 'Booking not found'); end if;
  perform _assert_student_self_or_admin(u, b.student_id);
  if b.status <> 'BOOKED' then perform _fail('INVALID_TRANSITION', 'Only active bookings can be cancelled.'); end if;
  select * into s from interview_slots where id = b.slot_id for update;
  perform _assert_before_cutoff(u, s, 'cancelled');
  select * into a from interview_attempts where booking_id = b.id for update;
  if a.interview_status <> 'SCHEDULED' then perform _fail('INVALID_TRANSITION', 'This interview has already started.'); end if;
  update interview_bookings set status = 'CANCELLED', cancelled_at = now(), cancelled_by = u.id, cancellation_reason = coalesce(nullif(trim(p_reason), ''), 'No reason given') where id = b.id;
  update interview_attempts set interview_status = 'CANCELLED', updated_at = now() where id = a.id;
  update interview_slots set status = case when lower(s.period) > now() then 'OPEN' else 'BLOCKED' end::slot_status where id = s.id;
  perform _audit(u.id, 'booking.cancelled', 'booking', b.id::text, '"BOOKED"', '"CANCELLED"', jsonb_build_object('reason', p_reason, 'override', u.role = 'ADMIN'));
  select * into st from students where id = b.student_id;
  perform _notify(st.user_id, 'CANCELLED', 'Your interview has been cancelled',
    format('Your interview on %s has been cancelled. You can book a new slot whenever you''re ready.', _fmt(lower(s.period), st.timezone)), 'Book a new slot', 'student/book');
end $$;

create or replace function reschedule_booking(p_booking uuid, p_new_slot uuid)
returns uuid language plpgsql security definer set search_path = public, pg_temp as $$
declare u users := _actor(); old interview_bookings; os interview_slots; ns interview_slots; a interview_attempts; nb uuid; st students;
begin
  select * into old from interview_bookings where id = p_booking for update;
  if not found then perform _fail('NOT_FOUND', 'Booking not found'); end if;
  perform _assert_student_self_or_admin(u, old.student_id);
  if old.status <> 'BOOKED' then perform _fail('INVALID_TRANSITION', 'Only active bookings can be rescheduled.'); end if;
  if p_new_slot = old.slot_id then perform _fail('VALIDATION', 'Pick a different slot.'); end if;
  -- lock both slots in a fixed order (no deadlocks between two reschedules)
  perform 1 from interview_slots where id in (old.slot_id, p_new_slot) order by id for update;
  select * into os from interview_slots where id = old.slot_id;
  select * into ns from interview_slots where id = p_new_slot;
  if not found then perform _fail('NOT_FOUND', 'Slot not found'); end if;
  perform _assert_before_cutoff(u, os, 'rescheduled');
  if u.role <> 'ADMIN' and old.reschedule_count >= _pol_int('maxReschedulesPerBooking') then
    perform _fail('LIMIT_REACHED', format('You can reschedule at most %s times. Cancel and rebook instead.', _pol_int('maxReschedulesPerBooking'))); end if;
  perform _validate_slot_for_booking(ns, old.student_id, old.id);
  select * into a from interview_attempts where booking_id = old.id for update;
  if a.interview_status <> 'SCHEDULED' then perform _fail('INVALID_TRANSITION', 'This interview has already started.'); end if;

  update interview_bookings set status = 'RESCHEDULED' where id = old.id;
  update interview_slots set status = 'OPEN' where id = os.id;
  update interview_slots set status = 'BOOKED' where id = ns.id;
  insert into interview_bookings (student_id, badge_definition_id, slot_id, meeting_link, reschedule_count, rescheduled_from_id, eligibility_snapshot_at)
    values (old.student_id, old.badge_definition_id, ns.id, old.meeting_link, old.reschedule_count + 1, old.id, old.eligibility_snapshot_at) returning id into nb;
  update interview_bookings set rescheduled_to_id = nb where id = old.id;
  update interview_attempts set booking_id = nb, interviewer_id = ns.interviewer_id, updated_at = now() where id = a.id;  -- same attempt, moved
  perform _audit(u.id, 'booking.rescheduled', 'booking', nb::text, jsonb_build_object('slot_id', os.id), jsonb_build_object('slot_id', ns.id), jsonb_build_object('from_booking', old.id));
  select * into st from students where id = old.student_id;
  perform _notify(st.user_id, 'RESCHEDULED', 'Your interview has been rescheduled',
    format('Your interview has moved from %s to %s. Your old slot has been released.', _fmt(lower(os.period), st.timezone), _fmt(lower(ns.period), st.timezone)), 'View Interview Details', 'student/interviews');
  return nb;
end $$;

-- ════════════════════════════════════════════════════════════════════
-- AVAILABILITY
-- ════════════════════════════════════════════════════════════════════
create or replace function add_availability(p_interviewer uuid, p_start timestamptz, p_end timestamptz, p_repeat_weeks int default 1)
returns int language plpgsql security definer set search_path = public, pg_temp as $$
declare u users := _actor(); iv interviewers; w int; ws timestamptz; we timestamptz; win uuid; series uuid; t timestamptz;
        dur interval := make_interval(mins => _pol_int('interviewDurationMin')); step interval := make_interval(mins => _pol_int('interviewDurationMin') + _pol_int('slotBufferMin'));
        weeks int := least(greatest(coalesce(p_repeat_weeks, 1), 1), 8);
begin
  perform _assert_interviewer_self_or_admin(u, p_interviewer);
  select * into iv from interviewers where id = p_interviewer;
  if not found then perform _fail('NOT_FOUND', 'Interviewer not found'); end if;
  if not iv.is_active then perform _fail('INACTIVE', 'Inactive interviewers cannot add availability.'); end if;
  if p_end <= p_start then perform _fail('VALIDATION', 'End time must be after start time.'); end if;
  if p_end - p_start < dur then perform _fail('VALIDATION', format('Window must be at least %s minutes.', _pol_int('interviewDurationMin'))); end if;
  if weeks > 1 then series := gen_random_uuid(); end if;
  for w in 0 .. weeks - 1 loop
    ws := p_start + make_interval(weeks => w); we := p_end + make_interval(weeks => w);
    if we <= now() then perform _fail('SLOT_IN_PAST', 'Availability cannot be added in the past.'); end if;
    begin
      insert into availability_windows (interviewer_id, period, series_id) values (iv.id, tstzrange(ws, we), series) returning id into win;
    exception when exclusion_violation then
      perform _fail('OVERLAP', format('This overlaps your existing availability on %s.', _fmt(ws, iv.timezone)));
    end;
    t := ws;
    while t + dur <= we loop
      insert into interview_slots (interviewer_id, window_id, period) values (iv.id, win, tstzrange(t, t + dur));
      t := t + step;
    end loop;
  end loop;
  perform _audit(u.id, 'availability.added', 'availability', p_interviewer::text, null,
    jsonb_build_object('start', p_start, 'end', p_end, 'weeks', weeks));
  return weeks;
end $$;

create or replace function remove_availability(p_window uuid) returns void language plpgsql security definer set search_path = public, pg_temp as $$
declare u users := _actor(); w availability_windows; n int;
begin
  select * into w from availability_windows where id = p_window for update;
  if not found or w.removed_at is not null then perform _fail('NOT_FOUND', 'Availability not found'); end if;
  perform _assert_interviewer_self_or_admin(u, w.interviewer_id);
  select count(*) into n from interview_slots where window_id = w.id and status = 'BOOKED';
  if n > 0 then perform _fail('HAS_BOOKINGS', format('%s student(s) are booked in this window. Release those interviews first so they can be reassigned.', n)); end if;
  update interview_slots set status = 'REMOVED' where window_id = w.id and status in ('OPEN','BLOCKED');
  update availability_windows set removed_at = now() where id = w.id;
  perform _audit(u.id, 'availability.removed', 'availability', w.id::text);
end $$;

create or replace function set_slot_blocked(p_slot uuid, p_blocked boolean) returns void language plpgsql security definer set search_path = public, pg_temp as $$
declare u users := _actor(); s interview_slots;
begin
  select * into s from interview_slots where id = p_slot for update;
  if not found then perform _fail('NOT_FOUND', 'Slot not found'); end if;
  perform _assert_interviewer_self_or_admin(u, s.interviewer_id);
  if p_blocked and s.status = 'BOOKED' then perform _fail('HAS_BOOKINGS', 'This slot is booked. Release the interview instead.'); end if;
  if not p_blocked and lower(s.period) < now() then perform _fail('SLOT_IN_PAST', 'Past slots cannot be reopened.'); end if;
  update interview_slots set status = case when p_blocked then 'BLOCKED' else 'OPEN' end::slot_status where id = s.id;
  perform _audit(u.id, case when p_blocked then 'slot.blocked' else 'slot.opened' end, 'slot', s.id::text, to_jsonb(s.status), to_jsonb(case when p_blocked then 'BLOCKED' else 'OPEN' end));
end $$;

-- Interviewer can't make a booked interview: reassign to a colleague free at the same time, else cancel with priority rebooking.
create or replace function interviewer_unavailable(p_attempt uuid, p_reason text) returns uuid language plpgsql security definer set search_path = public, pg_temp as $$
declare u users := _actor(); a interview_attempts; b interview_bookings; s interview_slots; alt interview_slots; st students; reason text := coalesce(nullif(trim(p_reason), ''), 'Unavailable');
begin
  select * into a from interview_attempts where id = p_attempt for update;
  if not found then perform _fail('NOT_FOUND', 'Interview not found'); end if;
  perform _assert_interviewer_self_or_admin(u, a.interviewer_id);
  if a.interview_status <> 'SCHEDULED' then perform _fail('INVALID_TRANSITION', 'Only upcoming interviews can be released.'); end if;
  select * into b from interview_bookings where id = a.booking_id for update;
  select * into s from interview_slots where id = b.slot_id for update;
  select x.* into alt from interview_slots x join interviewers i on i.id = x.interviewer_id
    where x.status = 'OPEN' and lower(x.period) = lower(s.period) and x.interviewer_id <> a.interviewer_id and i.is_active
    order by x.id limit 1 for update of x skip locked;
  update interview_slots set status = 'BLOCKED' where id = s.id;
  select * into st from students where id = a.student_id;
  if alt.id is not null then
    update interview_slots set status = 'BOOKED' where id = alt.id;
    update interview_bookings set slot_id = alt.id where id = b.id;
    update interview_attempts set interviewer_id = alt.interviewer_id, updated_at = now() where id = a.id;
    perform _audit(u.id, 'booking.reassigned', 'booking', b.id::text, jsonb_build_object('interviewer_id', a.interviewer_id), jsonb_build_object('interviewer_id', alt.interviewer_id), jsonb_build_object('reason', reason));
    perform _notify(st.user_id, 'INTERVIEWER_UNAVAILABLE', 'Your interviewer has changed',
      format('Your original interviewer is unavailable. Your interview stays at %s, now with %s. Nothing else changes.', _fmt(lower(alt.period), st.timezone),
             (select full_name from users join interviewers i on i.user_id = users.id where i.id = alt.interviewer_id)), 'View Interview Details', 'student/interviews');
    return alt.interviewer_id;
  end if;
  update interview_bookings set status = 'CANCELLED', cancelled_at = now(), cancelled_by = u.id, cancellation_reason = 'Interviewer unavailable: ' || reason, priority_rebook = true where id = b.id;
  update interview_attempts set interview_status = 'CANCELLED', updated_at = now() where id = a.id;
  perform _audit(u.id, 'booking.cancelled', 'booking', b.id::text, '"BOOKED"', '"CANCELLED"', jsonb_build_object('reason', reason, 'system', true, 'priority_rebook', true));
  perform _notify(st.user_id, 'INTERVIEWER_UNAVAILABLE', 'We''re sorry — your interview needs a new time',
    format('Your interviewer became unavailable for %s. This was not your fault and does not count as an attempt. You have priority access to book a new slot.', _fmt(lower(s.period), st.timezone)), 'Pick a new slot', 'student/book');
  return null;
end $$;

-- ════════════════════════════════════════════════════════════════════
-- INTERVIEW CONDUCT & OUTCOMES
-- ════════════════════════════════════════════════════════════════════
create or replace function start_interview(p_attempt uuid) returns void language plpgsql security definer set search_path = public, pg_temp as $$
declare u users := _actor(); a interview_attempts; s interview_slots;
begin
  select * into a from interview_attempts where id = p_attempt for update;
  if not found then perform _fail('NOT_FOUND', 'Interview not found'); end if;
  if u.role <> 'INTERVIEWER' then perform _fail('FORBIDDEN', 'Only the assigned interviewer can start an interview.'); end if;
  perform _assert_interviewer_self_or_admin(u, a.interviewer_id);
  if a.interview_status <> 'SCHEDULED' then perform _fail('INVALID_TRANSITION', 'This interview is not waiting to start.'); end if;
  select s2.* into s from interview_slots s2 join interview_bookings b on b.slot_id = s2.id where b.id = a.booking_id;
  if now() < lower(s.period) - interval '60 minutes' then perform _fail('VALIDATION', 'You can start this interview from 60 minutes before it begins.'); end if;
  if now() > upper(s.period) + interval '3 hours' then perform _fail('VALIDATION', 'This interview slot has passed. Mark attendance instead or ask ops to resolve it.'); end if;
  update interview_attempts set interview_status = 'IN_PROGRESS', attendance = 'PRESENT', started_at = now(), updated_at = now() where id = a.id;
  perform _audit(u.id, 'interview.in_progress', 'interview', a.id::text, '"SCHEDULED"', '"IN_PROGRESS"');
end $$;

create or replace function _finish_without_outcome(u users, a interview_attempts, p_attendance attendance_status) returns void language plpgsql security definer set search_path = public, pg_temp as $$
begin
  update interview_attempts set attendance = p_attendance, interview_status = 'COMPLETED', submitted_at = now(), submitted_by = u.id, updated_at = now() where id = a.id;
  update interview_bookings set status = 'COMPLETED' where id = a.booking_id;
  perform _audit(u.id, 'attendance.' || lower(p_attendance::text), 'interview', a.id::text, '"PENDING"', to_jsonb(p_attendance));
end $$;

create or replace function mark_student_no_show(p_attempt uuid) returns void language plpgsql security definer set search_path = public, pg_temp as $$
declare u users := _actor(); a interview_attempts; s interview_slots; st students;
begin
  select * into a from interview_attempts where id = p_attempt for update;
  if not found then perform _fail('NOT_FOUND', 'Interview not found'); end if;
  perform _assert_interviewer_self_or_admin(u, a.interviewer_id);
  if a.interview_status <> 'SCHEDULED' then perform _fail('INVALID_TRANSITION', 'Attendance was already recorded.'); end if;
  select s2.* into s from interview_slots s2 join interview_bookings b on b.slot_id = s2.id where b.id = a.booking_id;
  if now() < lower(s.period) then perform _fail('VALIDATION', 'You can mark a no-show only after the start time.'); end if;
  perform _finish_without_outcome(u, a, 'STUDENT_NO_SHOW');
  select * into st from students where id = a.student_id;
  perform _notify(st.user_id, 'NO_SHOW', 'You missed your interview',
    format('We didn''t see you at your %s interview, so it has been marked as a no-show. You can book a new slot from %s.', _badge_label(a.badge_definition_id),
           to_char((now() + make_interval(days => _pol_int('studentNoShowCooldownDays'))) at time zone st.timezone, 'Dy, DD Mon YYYY')), 'Book again', 'student/book');
end $$;

create or replace function mark_interviewer_no_show(p_attempt uuid) returns void language plpgsql security definer set search_path = public, pg_temp as $$
declare u users := _actor(); a interview_attempts; st students;
begin
  if u.role <> 'ADMIN' then perform _fail('FORBIDDEN', 'Only the interview ops team can record an interviewer no-show.'); end if;
  select * into a from interview_attempts where id = p_attempt for update;
  if not found then perform _fail('NOT_FOUND', 'Interview not found'); end if;
  if a.interview_status <> 'SCHEDULED' then perform _fail('INVALID_TRANSITION', 'Only interviews that never started can be marked this way.'); end if;
  perform _finish_without_outcome(u, a, 'INTERVIEWER_NO_SHOW');
  select * into st from students where id = a.student_id;
  perform _notify(st.user_id, 'INTERVIEWER_UNAVAILABLE', 'We''re sorry — your interview needs a new time',
    'Your interviewer could not attend. This was not your fault and does not count as an attempt. You have priority access to book a new slot.', 'Pick a new slot', 'student/book');
end $$;

create or replace function _validate_outcome(p_outcome outcome, p_tech int, p_comm int, p_ps int, p_feedback text) returns void language plpgsql as $$
begin
  if p_outcome is null or p_outcome = 'PENDING' then perform _fail('VALIDATION', 'Choose Pass, Fail or Retake later.'); end if;
  if p_tech is null or p_comm is null or p_ps is null or least(p_tech, p_comm, p_ps) < 1 or greatest(p_tech, p_comm, p_ps) > 5 then
    perform _fail('VALIDATION', 'Scores must be between 1 and 5.'); end if;
  if p_outcome <> 'PASS' and length(trim(coalesce(p_feedback, ''))) < 20 then
    perform _fail('VALIDATION', 'Write at least 20 characters of feedback so the student knows what to work on.'); end if;
end $$;

create or replace function _award_badge(u users, a interview_attempts) returns uuid language plpgsql security definer set search_path = public, pg_temp as $$
declare sb uuid;
begin
  if exists (select 1 from student_badges where student_id = a.student_id and badge_definition_id = a.badge_definition_id) then
    perform _fail('DUPLICATE', 'This student already holds this badge.'); end if;
  insert into student_badges (student_id, badge_definition_id, attempt_id) values (a.student_id, a.badge_definition_id, a.id) returning id into sb;
  insert into badge_events (student_badge_id, to_status, note, by_user) values (sb, 'EARNED', format('Interview attempt %s passed', a.attempt_number), u.id);
  perform _audit(u.id, 'badge.earned', 'badge', sb::text, null, '"EARNED"', jsonb_build_object('attempt_id', a.id));
  return sb;
end $$;

create or replace function _notify_outcome(a interview_attempts) returns void language plpgsql security definer set search_path = public, pg_temp as $$
declare st students := (select s from students s where s.id = a.student_id); j record; on_date text;
begin
  select * into j from _journey(a.student_id, a.badge_definition_id);
  on_date := coalesce(to_char(j.next_bookable_at at time zone st.timezone, 'Dy, DD Mon YYYY'), 'today');
  if a.outcome = 'PASS' then
    perform _notify(st.user_id, 'RESULT_PASS', 'Congratulations! You''ve passed your interview!',
      'You''ve successfully cleared your Track Badge interview. Your badge has been earned!' || E'\n\n' ||
      'Your hard work and dedication have paid off. Keep progressing through GRIT and continue building your skills.', 'View Your Badge', 'student/badges');
  elsif a.outcome = 'RETAKE_LATER' then
    perform _notify(st.user_id, 'RESULT_RETAKE', 'Not this time — but you are close',
      format('Your interviewer has recommended a retake for %s. This is not a fail: your skills are cleared and your progress is safe.', _badge_label(a.badge_definition_id)) || E'\n\n' ||
      format('You can book your next attempt from %s. Use the time to work on the feedback below.', on_date) || E'\n\n' || format('Interviewer feedback: “%s”', a.feedback), 'See feedback', 'student/interviews');
  elsif a.outcome = 'FAIL' then
    perform _notify(st.user_id, 'RESULT_FAIL', 'Your interview result is in',
      format('You didn''t clear the %s interview this time. Your cleared skills stay on your profile.', _badge_label(a.badge_definition_id)) || E'\n\n' ||
      case when j.attempts_left > 0 then format('You can book another attempt from %s (%s attempt(s) left). Review your feedback before booking.', on_date, j.attempts_left)
           else 'You have used all attempts for this badge this season. Contact the GRIT team if you believe this is a mistake.' end, 'See feedback', 'student/interviews');
  end if;
end $$;

create or replace function submit_outcome(p_attempt uuid, p_outcome outcome, p_technical int, p_communication int, p_problem_solving int, p_feedback text)
returns void language plpgsql security definer set search_path = public, pg_temp as $$
declare u users := _actor(); a interview_attempts;
begin
  select * into a from interview_attempts where id = p_attempt for update;
  if not found then perform _fail('NOT_FOUND', 'Interview not found'); end if;
  if u.role <> 'INTERVIEWER' then perform _fail('FORBIDDEN', 'Only the assigned interviewer can record a result.'); end if;
  perform _assert_interviewer_self_or_admin(u, a.interviewer_id);
  if a.interview_status = 'COMPLETED' then perform _fail('DUPLICATE', 'An outcome has already been submitted for this interview.'); end if;
  if a.interview_status <> 'IN_PROGRESS' then perform _fail('INVALID_TRANSITION', 'Start the interview before recording an outcome.'); end if;
  perform _validate_outcome(p_outcome, p_technical, p_communication, p_problem_solving, p_feedback);
  update interview_attempts set outcome = p_outcome, interview_status = 'COMPLETED', score_technical = p_technical, score_communication = p_communication,
    score_problem_solving = p_problem_solving, feedback = trim(p_feedback), submitted_at = now(), submitted_by = u.id, updated_at = now()
    where id = a.id returning * into a;
  insert into outcome_revisions (attempt_id, outcome, feedback, changed_by) values (a.id, p_outcome, a.feedback, u.id);
  update interview_bookings set status = 'COMPLETED' where id = a.booking_id;
  perform _audit(u.id, 'outcome.submitted', 'interview', a.id::text, '"PENDING"', to_jsonb(p_outcome));
  if p_outcome = 'PASS' then perform _award_badge(u, a); end if;
  perform _notify_outcome(a);
end $$;

-- Correct a submitted result: interviewer within the edit window, or ops; reason required; history kept.
-- A Pass that awarded a badge can never be reversed here — only through malpractice review.
create or replace function amend_outcome(p_attempt uuid, p_outcome outcome, p_technical int, p_communication int, p_problem_solving int, p_feedback text, p_reason text)
returns void language plpgsql security definer set search_path = public, pg_temp as $$
declare u users := _actor(); a interview_attempts; old_outcome outcome;
begin
  select * into a from interview_attempts where id = p_attempt for update;
  if not found then perform _fail('NOT_FOUND', 'Interview not found'); end if;
  perform _assert_interviewer_self_or_admin(u, a.interviewer_id);
  if a.interview_status <> 'COMPLETED' or a.outcome = 'PENDING' then perform _fail('INVALID_TRANSITION', 'There is no submitted outcome to change.'); end if;
  if u.role = 'INTERVIEWER' and now() - a.submitted_at > make_interval(hours => _pol_int('outcomeEditWindowHours')) then
    perform _fail('FORBIDDEN', format('Results can only be changed within %s hours. Ask the ops team to amend it.', _pol_int('outcomeEditWindowHours'))); end if;
  if length(trim(coalesce(p_reason, ''))) < 10 then perform _fail('VALIDATION', 'Give a reason (at least 10 characters) for changing a submitted result.'); end if;
  if a.outcome = p_outcome then perform _fail('VALIDATION', 'The outcome is unchanged.'); end if;
  if a.outcome = 'PASS' then perform _fail('FORBIDDEN', 'A Pass that awarded a badge can only be reversed through a malpractice review.'); end if;
  if exists (select 1 from interview_bookings where student_id = a.student_id and badge_definition_id = a.badge_definition_id and status = 'BOOKED') then
    perform _fail('CONFLICT', 'The student has already booked another attempt. Cancel that booking before amending.'); end if;
  perform _validate_outcome(p_outcome, p_technical, p_communication, p_problem_solving, p_feedback);
  old_outcome := a.outcome;
  perform set_config('grit.amending', 'on', true);
  update interview_attempts set outcome = p_outcome, score_technical = p_technical, score_communication = p_communication,
    score_problem_solving = p_problem_solving, feedback = trim(p_feedback), updated_at = now() where id = a.id returning * into a;
  perform set_config('grit.amending', 'off', true);
  insert into outcome_revisions (attempt_id, outcome, feedback, reason, changed_by) values (a.id, p_outcome, a.feedback, trim(p_reason), u.id);
  perform _audit(u.id, 'outcome.amended', 'interview', a.id::text, to_jsonb(old_outcome), to_jsonb(p_outcome), jsonb_build_object('reason', trim(p_reason)));
  if p_outcome = 'PASS' then perform _award_badge(u, a); end if;
  perform _notify_outcome(a);
end $$;

-- ════════════════════════════════════════════════════════════════════
-- MALPRACTICE & BADGE GOVERNANCE (flag ≠ decision)
-- ════════════════════════════════════════════════════════════════════
create or replace function flag_malpractice(p_student_badge uuid, p_description text, p_evidence text default null)
returns uuid language plpgsql security definer set search_path = public, pg_temp as $$
declare u users := _actor(); sb student_badges; c uuid;
begin
  if u.role not in ('ADMIN','INTERVIEWER') then perform _fail('FORBIDDEN', 'Only interviewers and the ops team can raise a flag.'); end if;
  select * into sb from student_badges where id = p_student_badge for update;
  if not found then perform _fail('NOT_FOUND', 'Badge not found'); end if;
  if u.role = 'INTERVIEWER' and not exists (select 1 from interview_attempts a join interviewers i on i.id = a.interviewer_id where a.student_id = sb.student_id and i.user_id = u.id) then
    perform _fail('FORBIDDEN', 'Interviewers can flag only students they have interviewed. Ask the ops team to raise it.'); end if;
  if sb.status = 'NULLIFIED' then perform _fail('INVALID_TRANSITION', 'This badge is already nullified.'); end if;
  if length(trim(coalesce(p_description, ''))) < 15 then perform _fail('VALIDATION', 'Describe the concern in at least 15 characters.'); end if;
  insert into malpractice_cases (student_id, student_badge_id, reported_by, description, evidence_reference)
    values (sb.student_id, sb.id, u.id, trim(p_description), nullif(trim(coalesce(p_evidence, '')), '')) returning id into c;
  insert into case_events (case_id, action, note, by_user) values (c, 'Flag raised', trim(p_description), u.id);
  perform _audit(u.id, 'malpractice.flagged', 'malpractice_case', c::text, null, '"FLAGGED"', jsonb_build_object('student_badge_id', sb.id));
  if sb.status = 'EARNED' then          -- a second flag on a badge already under review just adds a case
    update student_badges set status = 'UNDER_REVIEW' where id = sb.id;
    insert into badge_events (student_badge_id, from_status, to_status, note, by_user) values (sb.id, 'EARNED', 'UNDER_REVIEW', 'Case opened', u.id);
    perform _audit(u.id, 'badge.under_review', 'badge', sb.id::text, '"EARNED"', '"UNDER_REVIEW"', jsonb_build_object('case_id', c));
    perform _notify(_student_user(sb.student_id), 'BADGE_UNDER_REVIEW', 'Your badge is under review',
      format('Your %s badge is being reviewed by the GRIT integrity team. This is a review, not a decision: your badge stays on your profile while it is under review. We''ll tell you the outcome as soon as the review is complete.', _badge_label(sb.badge_definition_id)));
  end if;
  return c;
end $$;

create or replace function _assert_reviewer(u users) returns void language plpgsql stable as $$
begin
  if u.role <> 'ADMIN' or not u.can_review_malpractice then perform _fail('FORBIDDEN', 'Only authorised integrity reviewers can do this.'); end if;
end $$;

create or replace function start_investigation(p_case uuid, p_note text default null) returns void language plpgsql security definer set search_path = public, pg_temp as $$
declare u users := _actor(); c malpractice_cases;
begin
  perform _assert_reviewer(u);
  select * into c from malpractice_cases where id = p_case for update;
  if not found then perform _fail('NOT_FOUND', 'Case not found'); end if;
  if c.status <> 'FLAGGED' then perform _fail('INVALID_TRANSITION', 'Only newly flagged cases can be opened for investigation.'); end if;
  update malpractice_cases set status = 'UNDER_INVESTIGATION' where id = c.id;
  insert into case_events (case_id, action, note, by_user) values (c.id, 'Investigation started', nullif(trim(coalesce(p_note, '')), ''), u.id);
  perform _audit(u.id, 'malpractice.under_investigation', 'malpractice_case', c.id::text, '"FLAGGED"', '"UNDER_INVESTIGATION"');
end $$;

create or replace function decide_case(p_case uuid, p_decision case_status, p_reason text) returns void language plpgsql security definer set search_path = public, pg_temp as $$
declare u users := _actor(); c malpractice_cases; sb student_badges; still_open int;
begin
  perform _assert_reviewer(u);
  if p_decision not in ('CONFIRMED','DISMISSED') then perform _fail('VALIDATION', 'Decide CONFIRMED or DISMISSED.'); end if;
  if length(trim(coalesce(p_reason, ''))) < 15 then perform _fail('VALIDATION', 'Record the reason for this decision (at least 15 characters).'); end if;
  select * into c from malpractice_cases where id = p_case for update;
  if not found then perform _fail('NOT_FOUND', 'Case not found'); end if;
  if p_decision = 'CONFIRMED' and c.status <> 'UNDER_INVESTIGATION' then perform _fail('INVALID_TRANSITION', 'Malpractice can only be confirmed after an investigation is opened.'); end if;
  if c.status not in ('FLAGGED','UNDER_INVESTIGATION') then perform _fail('INVALID_TRANSITION', 'This case is already decided.'); end if;
  update malpractice_cases set status = p_decision, decision_reason = trim(p_reason), reviewed_by = u.id, reviewed_at = now() where id = c.id;
  insert into case_events (case_id, action, note, by_user) values (c.id, case when p_decision = 'CONFIRMED' then 'Malpractice confirmed' else 'Case dismissed' end, trim(p_reason), u.id);
  perform _audit(u.id, 'malpractice.' || lower(p_decision::text), 'malpractice_case', c.id::text, to_jsonb(c.status), to_jsonb(p_decision), jsonb_build_object('reason', trim(p_reason)));
  select * into sb from student_badges where id = c.student_badge_id for update;
  if p_decision = 'CONFIRMED' and sb.status = 'UNDER_REVIEW' then
    update student_badges set status = 'NULLIFIED', nullified_at = now() where id = sb.id;
    insert into badge_events (student_badge_id, from_status, to_status, note, by_user) values (sb.id, 'UNDER_REVIEW', 'NULLIFIED', 'Case confirmed', u.id);
    perform _audit(u.id, 'badge.nullified', 'badge', sb.id::text, '"UNDER_REVIEW"', '"NULLIFIED"', jsonb_build_object('case_id', c.id));
    perform _notify(_student_user(sb.student_id), 'BADGE_NULLIFIED', 'Your badge has been nullified',
      format('After review, the GRIT integrity team confirmed a code-of-conduct violation linked to your %s badge. The badge has been nullified and no longer counts towards your GRIT standing. If you''d like to appeal, reply to the email sent to your registered address within 7 days.', _badge_label(sb.badge_definition_id)));
  elsif p_decision = 'DISMISSED' and sb.status = 'UNDER_REVIEW' then
    select count(*) into still_open from malpractice_cases where student_badge_id = sb.id and id <> c.id and status in ('FLAGGED','UNDER_INVESTIGATION');
    if still_open = 0 then
      update student_badges set status = 'EARNED' where id = sb.id;
      insert into badge_events (student_badge_id, from_status, to_status, note, by_user) values (sb.id, 'UNDER_REVIEW', 'EARNED', 'Case dismissed', u.id);
      perform _audit(u.id, 'badge.reinstated', 'badge', sb.id::text, '"UNDER_REVIEW"', '"EARNED"', jsonb_build_object('case_id', c.id));
      perform _notify(_student_user(sb.student_id), 'BADGE_REINSTATED', 'Review closed — your badge stands',
        format('The review of your %s badge is complete and no action was taken. Your badge is fully active.', _badge_label(sb.badge_definition_id)), 'View Your Badge', 'student/badges');
    end if;
  end if;
end $$;

-- ════════════════════════════════════════════════════════════════════
-- OPS / ADMIN / INTEGRATION
-- ════════════════════════════════════════════════════════════════════
-- Contest results arrive from the skill-contest system (service role) or ops. Students can never clear their own skills.
create or replace function record_skill_cleared(p_student uuid, p_skill uuid) returns void language plpgsql security definer set search_path = public, pg_temp as $$
declare actor_id uuid; before_ids uuid[]; d record;
begin
  if not _is_service() then
    declare u users := _actor(); begin
      if u.role <> 'ADMIN' then perform _fail('FORBIDDEN', 'Skill results come from the contest system or the ops team.'); end if;
      actor_id := u.id;
    end;
  end if;
  select array_agg(id) into before_ids from badge_definitions where is_eligible(p_student, id);
  insert into student_skill_progress (student_id, skill_id, status, cleared_at) values (p_student, p_skill, 'CLEARED', now())
    on conflict (student_id, skill_id) do update set status = 'CLEARED', cleared_at = now() where student_skill_progress.status <> 'CLEARED';
  if not found then perform _fail('VALIDATION', 'Skill already cleared.'); end if;
  perform _audit(actor_id, 'skill.cleared', 'skill_progress', p_student::text || ':' || p_skill::text, null, '"CLEARED"');
  for d in select id from badge_definitions where is_eligible(p_student, id) and not (id = any(coalesce(before_ids, '{}'))) loop
    if (select state from _journey(p_student, d.id)) = 'ELIGIBLE' then
      perform _notify(_student_user(p_student), 'ELIGIBLE', 'You''re eligible for your Track Badge interview!',
        'Congratulations! You''ve completed all the required skills for this track. You''re now eligible to book your live interview.' || E'\n\n' ||
        'Choose an available date and time that works for you to take the next step towards earning your badge.', 'Book Your Interview', 'student/book');
      perform _audit(actor_id, 'eligibility.granted', 'student', p_student::text, '"NOT_ELIGIBLE"', '"ELIGIBLE"', jsonb_build_object('badge_definition_id', d.id));
    end if;
  end loop;
end $$;

create or replace function nudge_student(p_student uuid) returns void language plpgsql security definer set search_path = public, pg_temp as $$
declare u users := _actor(); d uuid;
begin
  if u.role <> 'ADMIN' then perform _fail('FORBIDDEN', 'Only the ops team can send reminders.'); end if;
  if exists (select 1 from notifications where user_id = _student_user(p_student) and type = 'NUDGE' and created_at > now() - interval '24 hours') then
    perform _fail('DUPLICATE', 'This student was already nudged in the last 24 hours.'); end if;
  select bd.id into d from badge_definitions bd where (select state from _journey(p_student, bd.id)) = 'ELIGIBLE' order by bd.level_order limit 1;
  if d is null then perform _fail('VALIDATION', 'This student has nothing to book right now.'); end if;
  perform _notify(_student_user(p_student), 'NUDGE', 'Slots are filling up',
    format('You''re eligible for the %s interview but haven''t booked yet. Interview slots are limited — book yours now.', _badge_label(d)), 'Book Your Interview', 'student/book');
  perform _audit(u.id, 'student.nudged', 'student', p_student::text);
end $$;

create or replace function remind_interviewer(p_attempt uuid) returns void language plpgsql security definer set search_path = public, pg_temp as $$
declare u users := _actor(); a interview_attempts;
begin
  if u.role <> 'ADMIN' then perform _fail('FORBIDDEN', 'Only the ops team can send reminders.'); end if;
  select * into a from interview_attempts where id = p_attempt;
  if not found then perform _fail('NOT_FOUND', 'Interview not found'); end if;
  perform _notify((select user_id from interviewers where id = a.interviewer_id), 'REMINDER', 'Outcome pending',
    'Please record the outcome for your interview with ' || (select full_name from users where id = _student_user(a.student_id)) || '.', 'Open interview', 'interviewer/interview/' || a.id);
  perform _audit(u.id, 'interviewer.reminded', 'interview', a.id::text);
end $$;

create or replace function update_policies(p_policies jsonb) returns void language plpgsql security definer set search_path = public, pg_temp as $$
declare u users := _actor(); cur jsonb; nxt jsonb; k text; v jsonb;
begin
  if u.role <> 'ADMIN' or not u.can_edit_settings then perform _fail('FORBIDDEN', 'You do not have permission to change policies.'); end if;
  select setting_value into cur from system_settings where setting_key = 'policies' for update;
  for k, v in select * from jsonb_each(coalesce(p_policies, '{}')) loop
    if not cur ? k then perform _fail('VALIDATION', format('Unknown policy %s.', k)); end if;
    if jsonb_typeof(v) <> jsonb_typeof(cur -> k) then perform _fail('VALIDATION', format('Invalid value for %s.', k)); end if;
    if jsonb_typeof(v) = 'number' and ((v)::text::numeric < 0 or (v)::text::numeric > 1000) then perform _fail('VALIDATION', format('Invalid value for %s.', k)); end if;
  end loop;
  nxt := cur || coalesce(p_policies, '{}');
  if (nxt ->> 'interviewDurationMin')::int < 10 then perform _fail('VALIDATION', 'Interviews must be at least 10 minutes.'); end if;
  if (nxt ->> 'maxAttemptsPerBadge')::int < 1 then perform _fail('VALIDATION', 'Allow at least one attempt.'); end if;
  update system_settings set setting_value = nxt, updated_by = u.id, updated_at = now() where setting_key = 'policies';
  perform _audit(u.id, 'settings.updated', 'settings', 'policies', cur, nxt);
end $$;

-- Requirement changes re-evaluate unbooked students automatically (eligibility is computed);
-- students with an active booking keep it (eligibility_snapshot_at records when it was locked).
create or replace function set_skill_required(p_badge uuid, p_skill uuid, p_required boolean) returns void language plpgsql security definer set search_path = public, pg_temp as $$
declare u users := _actor();
begin
  if u.role <> 'ADMIN' or not u.can_edit_settings then perform _fail('FORBIDDEN', 'You do not have permission to change badge requirements.'); end if;
  if p_required then
    insert into badge_skill_requirements values (p_badge, p_skill) on conflict do nothing;
  else
    if (select count(*) from badge_skill_requirements where badge_definition_id = p_badge) <= 1 then perform _fail('VALIDATION', 'A badge needs at least one required skill.'); end if;
    delete from badge_skill_requirements where badge_definition_id = p_badge and skill_id = p_skill;
  end if;
  perform _audit(u.id, 'badge.requirements_changed', 'badge_definition', p_badge::text, null, jsonb_build_object('skill_id', p_skill, 'required', p_required));
end $$;

create or replace function set_interviewer_active(p_interviewer uuid, p_active boolean) returns void language plpgsql security definer set search_path = public, pg_temp as $$
declare u users := _actor(); n int;
begin
  if u.role <> 'ADMIN' then perform _fail('FORBIDDEN', 'Only the ops team can change interviewer status.'); end if;
  if not p_active then
    select count(*) into n from interview_attempts where interviewer_id = p_interviewer and interview_status = 'SCHEDULED';
    if n > 0 then perform _fail('HAS_BOOKINGS', format('This interviewer has %s upcoming interview(s). Reassign them first.', n)); end if;
    update interview_slots set status = 'BLOCKED' where interviewer_id = p_interviewer and status = 'OPEN';
  end if;
  update interviewers set is_active = p_active where id = p_interviewer;
  perform _audit(u.id, case when p_active then 'interviewer.activated' else 'interviewer.deactivated' end, 'interviewer', p_interviewer::text);
end $$;

create or replace function mark_notifications_read(p_ids uuid[] default null) returns int language plpgsql security definer set search_path = public, pg_temp as $$
declare u users := _actor(); n int;
begin
  update notifications set is_read = true where user_id = u.id and not is_read and (p_ids is null or id = any(p_ids));
  get diagnostics n = row_count; return n;
end $$;

-- ── RLS helper functions (executed inside policies; see 0003) ──────
create or replace function app_role() returns user_role language sql stable security definer set search_path = public, pg_temp as $$
  select role from users where id = auth.uid() and is_active $$;
create or replace function my_student_id() returns uuid language sql stable security definer set search_path = public, pg_temp as $$
  select id from students where user_id = auth.uid() $$;
create or replace function my_interviewer_id() returns uuid language sql stable security definer set search_path = public, pg_temp as $$
  select id from interviewers where user_id = auth.uid() $$;
create or replace function my_assigned_students() returns setof uuid language sql stable security definer set search_path = public, pg_temp as $$
  select distinct student_id from interview_attempts where interviewer_id = (select id from interviewers where user_id = auth.uid()) $$;
