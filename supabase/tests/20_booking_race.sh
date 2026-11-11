#!/usr/bin/env bash
# Two REAL concurrent Postgres sessions, signed in as two different students, book the same slot.
# Exactly one must succeed; the other must get SLOT_TAKEN. Then one student double-submits concurrently.
# Requires the DB prepared by scripts/test-db.sh (uses libpq env vars + TEST_DB).
set -euo pipefail
DB="${TEST_DB:-grit_test}"
P="psql -X -q -t -A -d $DB"
$P <<'SQL' >/dev/null
insert into users (id, full_name, email, role) values
 ('00000000-0000-0000-0000-0000000000d1','Race Student One','race1@demo.grit.example','STUDENT'),
 ('00000000-0000-0000-0000-0000000000d2','Race Student Two','race2@demo.grit.example','STUDENT') on conflict do nothing;
insert into students (id, user_id, student_code) values
 ('10000000-0000-0000-0000-0000000000d1','00000000-0000-0000-0000-0000000000d1','RACE1'),
 ('10000000-0000-0000-0000-0000000000d2','00000000-0000-0000-0000-0000000000d2','RACE2') on conflict do nothing;
insert into student_skill_progress select s, k, 'CLEARED', now()
  from unnest(array['10000000-0000-0000-0000-0000000000d1','10000000-0000-0000-0000-0000000000d2']::uuid[]) s,
       (select skill_id k from badge_skill_requirements where badge_definition_id = '40000000-0000-0000-0000-000000000001') x
  on conflict do nothing;
SQL
SLOT=$($P -c "select id from interview_slots where status='OPEN' and lower(period) > now() + interval '1 day' order by lower(period) limit 1")
SLOT2=$($P -c "select id from interview_slots where status='OPEN' and lower(period) > now() + interval '1 day' and id <> '$SLOT' order by lower(period) limit 1")
BADGE=40000000-0000-0000-0000-000000000001
as_student() { echo "set role authenticated; select set_config('request.jwt.claim.sub','$1',false);"; }

echo "Race 1: two students, one slot ($SLOT)"
( $P -c "$(as_student 00000000-0000-0000-0000-0000000000d1) begin; select 'session A booked '||book_slot('10000000-0000-0000-0000-0000000000d1','$BADGE','$SLOT'); select pg_sleep(1.5); commit;" 2>&1 | grep -v '^$' | sed 's/^/  [A] /' ) &
sleep 0.3
( $P -c "$(as_student 00000000-0000-0000-0000-0000000000d2) begin; select 'session B booked '||book_slot('10000000-0000-0000-0000-0000000000d2','$BADGE','$SLOT'); commit;" 2>&1 | grep -v '^$' | grep -v CONTEXT | sed 's/^/  [B] /' ) &
wait
N=$($P -c "select count(*) from interview_bookings where slot_id='$SLOT' and status='BOOKED'")
echo "  active bookings on the slot: $N"
[ "$N" = "1" ] || { echo "FAIL race 1"; exit 1; }
echo "PASS race 1 — exactly one booking"

echo "Race 2: one student double-submits (different requests) for the same badge"
( $P -c "$(as_student 00000000-0000-0000-0000-0000000000d2) begin; select 'request 1 booked '||book_slot('10000000-0000-0000-0000-0000000000d2','$BADGE','$SLOT2','r1'); select pg_sleep(1.5); commit;" 2>&1 | grep -v '^$' | sed 's/^/  [1] /' ) &
sleep 0.3
( $P -c "$(as_student 00000000-0000-0000-0000-0000000000d2) begin; select 'request 2 booked '||book_slot('10000000-0000-0000-0000-0000000000d2','$BADGE','$SLOT2','r2'); commit;" 2>&1 | grep -v '^$' | grep -v CONTEXT | sed 's/^/  [2] /' ) &
wait
N=$($P -c "select count(*) from interview_bookings where student_id='10000000-0000-0000-0000-0000000000d2' and status='BOOKED'")
echo "  active bookings for the student: $N"
[ "$N" = "1" ] || { echo "FAIL race 2"; exit 1; }
echo "PASS race 2 — one active booking per student × badge"
