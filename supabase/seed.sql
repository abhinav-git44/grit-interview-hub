-- ════════════════════════════════════════════════════════════════════
-- GRIT Interview Hub · demo seed for a Supabase project (also runs on plain Postgres for testing).
-- All people and records are FICTIONAL SAMPLE DATA.
-- Live state is created by calling the real RPCs as each demo user, so every row passes
-- the same authorisation, validation, audit and notification path as production.
-- Demo password for every account (Supabase only): GritDemo!2026
-- ════════════════════════════════════════════════════════════════════

-- 1. Supabase Auth users (skipped automatically on plain Postgres, where auth.users does not exist)
do $$
declare r record;
begin
  if to_regclass('auth.users') is null then raise notice 'auth.users not found — skipping auth accounts (plain Postgres)'; return; end if;
  for r in select * from (values
    ('00000000-0000-0000-0000-0000000000a1'::uuid,'aarav@demo.grit.example'), ('00000000-0000-0000-0000-0000000000a2','tara@demo.grit.example'),
    ('00000000-0000-0000-0000-0000000000a3','rohan@demo.grit.example'),       ('00000000-0000-0000-0000-0000000000a4','riya@demo.grit.example'),
    ('00000000-0000-0000-0000-0000000000a5','ishita@demo.grit.example'),      ('00000000-0000-0000-0000-0000000000b1','meera@demo.grit.example'),
    ('00000000-0000-0000-0000-0000000000b2','rahul@demo.grit.example'),       ('00000000-0000-0000-0000-0000000000c1','priya@demo.grit.example'),
    ('00000000-0000-0000-0000-0000000000c2','karan@demo.grit.example')) as v(id, email)
  loop
    insert into auth.users (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at, created_at, updated_at, raw_app_meta_data, raw_user_meta_data)
    values ('00000000-0000-0000-0000-000000000000', r.id, 'authenticated', 'authenticated', r.email, crypt('GritDemo!2026', gen_salt('bf')), now(), now(), now(),
            '{"provider":"email","providers":["email"]}', '{}')
    on conflict (id) do nothing;
    insert into auth.identities (id, user_id, provider_id, identity_data, provider, last_sign_in_at, created_at, updated_at)
    values (gen_random_uuid(), r.id, r.id::text, jsonb_build_object('sub', r.id::text, 'email', r.email), 'email', now(), now(), now())
    on conflict do nothing;
  end loop;
end $$;

-- 2. People
insert into users (id, full_name, email, role, can_review_malpractice, can_edit_settings) values
 ('00000000-0000-0000-0000-0000000000a1','Aarav Sharma','aarav@demo.grit.example','STUDENT', false, false),
 ('00000000-0000-0000-0000-0000000000a2','Tara Menon','tara@demo.grit.example','STUDENT', false, false),
 ('00000000-0000-0000-0000-0000000000a3','Rohan Das','rohan@demo.grit.example','STUDENT', false, false),
 ('00000000-0000-0000-0000-0000000000a4','Riya Patel','riya@demo.grit.example','STUDENT', false, false),
 ('00000000-0000-0000-0000-0000000000a5','Ishita Rao','ishita@demo.grit.example','STUDENT', false, false),
 ('00000000-0000-0000-0000-0000000000b1','Meera Iyer','meera@demo.grit.example','INTERVIEWER', false, false),
 ('00000000-0000-0000-0000-0000000000b2','Rahul Verma','rahul@demo.grit.example','INTERVIEWER', false, false),
 ('00000000-0000-0000-0000-0000000000c1','Priya Menon','priya@demo.grit.example','ADMIN', true, true),
 ('00000000-0000-0000-0000-0000000000c2','Karan Shah','karan@demo.grit.example','ADMIN', false, false)
on conflict (id) do nothing;
insert into students (id, user_id, student_code, campus, batch) values
 ('10000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-0000000000a1','NIAT241001','NIAT Hyderabad',2024),
 ('10000000-0000-0000-0000-000000000002','00000000-0000-0000-0000-0000000000a2','NIAT241014','NIAT Bengaluru',2025),
 ('10000000-0000-0000-0000-000000000003','00000000-0000-0000-0000-0000000000a3','NIAT241009','NIAT Pune',2024),
 ('10000000-0000-0000-0000-000000000004','00000000-0000-0000-0000-0000000000a4','NIAT241002','NIAT Bengaluru',2025),
 ('10000000-0000-0000-0000-000000000005','00000000-0000-0000-0000-0000000000a5','NIAT241006','NIAT Chennai',2024)
on conflict (id) do nothing;
insert into interviewers (id, user_id, employee_code, specialization) values
 ('20000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-0000000000b1','INT-101','AI Product'),
 ('20000000-0000-0000-0000-000000000002','00000000-0000-0000-0000-0000000000b2','INT-102','AI Systems')
on conflict (id) do nothing;

-- 3. Catalogue: 3 tracks × 2 badge levels, 4 skills per track (Novice = skills 1–2, Master = skills 3–4)
insert into tracks (id, name, description) values
 ('30000000-0000-0000-0000-000000000001','AI Product Mastery','Ship AI-powered products end to end.'),
 ('30000000-0000-0000-0000-000000000002','AI Systems Mastery','Build reliable AI systems and infrastructure.'),
 ('30000000-0000-0000-0000-000000000003','AI Models Mastery','Train, evaluate and fine-tune models.')
on conflict (id) do nothing;
insert into badge_definitions (id, track_id, level, level_order, name)
select ('4000000' || t || '-0000-0000-0000-00000000000' || l)::uuid, ('30000000-0000-0000-0000-00000000000' || t)::uuid,
       case l when 1 then 'Novice' else 'Master' end, l, tr.name || ' — ' || case l when 1 then 'Novice' else 'Master' end
from generate_series(1,3) t, generate_series(1,2) l, tracks tr where tr.id = ('30000000-0000-0000-0000-00000000000' || t)::uuid
on conflict do nothing;
insert into skills (id, track_id, name)
select ('5000000' || t || '-0000-0000-0000-00000000000' || k)::uuid, ('30000000-0000-0000-0000-00000000000' || t)::uuid,
       (array[array['Product Discovery','Prompt Design','AI UX Patterns','Evaluation & Metrics'],
              array['APIs & Backends','Vector Databases','LLM Ops','Scaling & Cost'],
              array['Python for ML','Classical ML','Deep Learning','Fine-tuning']])[t][k]
from generate_series(1,3) t, generate_series(1,4) k on conflict do nothing;
insert into badge_skill_requirements
select ('4000000' || t || '-0000-0000-0000-00000000000' || case when k <= 2 then 1 else 2 end)::uuid, ('5000000' || t || '-0000-0000-0000-00000000000' || k)::uuid
from generate_series(1,3) t, generate_series(1,4) k on conflict do nothing;

-- 4. Skill progress arrives from the contest system (service role)
select set_config('request.jwt.claim.role', 'service_role', false);
select record_skill_cleared(s, k) from (values
  ('10000000-0000-0000-0000-000000000001'::uuid,'50000001-0000-0000-0000-000000000001'::uuid), ('10000000-0000-0000-0000-000000000001','50000001-0000-0000-0000-000000000002'),
  ('10000000-0000-0000-0000-000000000002','50000001-0000-0000-0000-000000000001'), ('10000000-0000-0000-0000-000000000002','50000001-0000-0000-0000-000000000002'),
  ('10000000-0000-0000-0000-000000000003','50000001-0000-0000-0000-000000000001'),
  ('10000000-0000-0000-0000-000000000004','50000001-0000-0000-0000-000000000001'), ('10000000-0000-0000-0000-000000000004','50000001-0000-0000-0000-000000000002'),
  ('10000000-0000-0000-0000-000000000005','50000001-0000-0000-0000-000000000001'), ('10000000-0000-0000-0000-000000000005','50000001-0000-0000-0000-000000000002')) v(s, k);
select set_config('request.jwt.claim.role', 'authenticated', false);

-- 5. Availability for the next 14 days, created by each interviewer through the RPC (IST)
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000b1', false);
select add_availability('20000000-0000-0000-0000-000000000001', (d + time '10:00') at time zone 'Asia/Kolkata', (d + time '12:00') at time zone 'Asia/Kolkata')
from generate_series((now() at time zone 'Asia/Kolkata')::date + 1, (now() at time zone 'Asia/Kolkata')::date + 14, interval '1 day') d;
select add_availability('20000000-0000-0000-0000-000000000001', date_trunc('minute', now()) + interval '20 min', date_trunc('minute', now()) + interval '100 min');  -- "today" demo
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000b2', false);
select add_availability('20000000-0000-0000-0000-000000000002', (d + time '10:00') at time zone 'Asia/Kolkata', (d + time '12:00') at time zone 'Asia/Kolkata')
from generate_series((now() at time zone 'Asia/Kolkata')::date + 1, (now() at time zone 'Asia/Kolkata')::date + 14, interval '2 days') d;

-- 6. Live bookings and one result, each by the right user
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000c1', false);
select update_policies('{"minBookingLeadHours":0}');                       -- allow today's demo slot to be booked
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000a4', false);   -- Riya: today, with Meera
select book_slot('10000000-0000-0000-0000-000000000004','40000001-0000-0000-0000-000000000001',
  (select id from interview_slots where interviewer_id = '20000000-0000-0000-0000-000000000001' and lower(period) > now() order by lower(period) limit 1));
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000a5', false);   -- Ishita: today, with Meera → retake below
select book_slot('10000000-0000-0000-0000-000000000005','40000001-0000-0000-0000-000000000001',
  (select id from interview_slots where interviewer_id = '20000000-0000-0000-0000-000000000001' and lower(period) > now() order by lower(period) offset 1 limit 1));
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000b1', false);
select start_interview((select id from interview_attempts where student_id = '10000000-0000-0000-0000-000000000005'));
select submit_outcome((select id from interview_attempts where student_id = '10000000-0000-0000-0000-000000000005'), 'RETAKE_LATER', 3, 4, 3,
  'Nearly there — revise vector database indexing and come back with one end-to-end demo.');
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000a2', false);   -- Tara: in 3 days
select book_slot('10000000-0000-0000-0000-000000000002','40000001-0000-0000-0000-000000000001',
  (select id from interview_slots where status = 'OPEN' and lower(period) > now() + interval '3 days' order by lower(period) limit 1));
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000c1', false);
select update_policies('{"minBookingLeadHours":2}');                       -- restore the illustrative default
select set_config('request.jwt.claim.sub', '', false);
-- Result: Aarav eligible & unbooked · Rohan not eligible · Riya booked today · Ishita retake recommended · Tara booked
