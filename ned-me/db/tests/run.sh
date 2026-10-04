#!/usr/bin/env bash
# Test d'intégration DB : migrations + RLS multi-tenant + règles métier.
# Usage : PSQL_ADMIN="psql -U postgres -h localhost" ./db/tests/run.sh
set -euo pipefail
cd "$(dirname "$0")/.."
ADMIN=${PSQL_ADMIN:-"su postgres -c"}
DB=ned_test
run_admin() { if [ "$ADMIN" = "su postgres -c" ]; then su postgres -c "psql -v ON_ERROR_STOP=1 -q $*"; else $ADMIN -v ON_ERROR_STOP=1 -q "$@"; fi; }
sql_admin() { if [ "$ADMIN" = "su postgres -c" ]; then su postgres -c "psql -v ON_ERROR_STOP=1 -q -d $DB -f $1"; else $ADMIN -v ON_ERROR_STOP=1 -q -d $DB -f "$1"; fi; }

run_admin "-c 'DROP DATABASE IF EXISTS $DB'" ; run_admin "-c 'CREATE DATABASE $DB'"
for f in migrations/001_foundation.sql migrations/002_results_indicators.sql migrations/004_arabic_search.sql migrations/005_workflow.sql migrations/006_dqa.sql migrations/007_evidence.sql migrations/008_evaluations.sql migrations/009_meal.sql migrations/010_reports.sql migrations/011_risks.sql; do sql_admin "$PWD/$f"; done
if [ -n "${WITH_POSTGIS:-}" ]; then sql_admin "$PWD/migrations/003_gis.sql"; fi
sql_admin "$PWD/tests/rls_test.sql"
echo "DB TESTS OK"
