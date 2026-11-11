#!/usr/bin/env bash
# Creates a throw-away database, applies the local auth stub + all migrations, runs the SQL suite and the race test.
# Uses standard libpq env vars (PGHOST, PGPORT, PGUSER, PGPASSWORD). Example:
#   PGHOST=localhost PGUSER=postgres ./scripts/test-db.sh
set -euo pipefail
cd "$(dirname "$0")/.."
DB="${TEST_DB:-grit_test}"
PSQL="psql -X -q -v ON_ERROR_STOP=1"
$PSQL -d postgres -c "drop database if exists $DB" -c "create database $DB" >/dev/null
$PSQL -d "$DB" -f supabase/tests/00_local_auth_stub.sql >/dev/null
for f in supabase/migrations/*.sql; do $PSQL -d "$DB" -f "$f" >/dev/null; echo "applied $f"; done
echo "── SQL suite ──"
$PSQL -d "$DB" -f supabase/tests/10_db_tests.sql
echo "── Concurrency ──"
TEST_DB="$DB" bash supabase/tests/20_booking_race.sh
echo "── Seed (fresh database) ──"
SEED_DB="${DB}_seed"
$PSQL -d postgres -c "drop database if exists $SEED_DB" -c "create database $SEED_DB" >/dev/null
$PSQL -d "$SEED_DB" -f supabase/tests/00_local_auth_stub.sql >/dev/null
for f in supabase/migrations/*.sql; do $PSQL -d "$SEED_DB" -f "$f" >/dev/null; done
$PSQL -d "$SEED_DB" -f supabase/seed.sql >/dev/null 2>&1 || { echo "FAIL seed"; exit 1; }
$PSQL -d "$SEED_DB" -t -A -F ' → ' -c "select u.full_name, (select state from _journey(s.id,'40000001-0000-0000-0000-000000000001')) from students s join users u on u.id = s.user_id order by 1"
echo "PASS seed — applied through the RPCs"
