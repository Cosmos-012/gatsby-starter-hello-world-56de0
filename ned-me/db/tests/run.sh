#!/usr/bin/env bash
# Test d'intégration DB : toutes les migrations + RLS multi-tenant + règles métier.
# Local (cluster PostgreSQL du système) : ./db/tests/run.sh
# CI / serveur distant : PSQL_ADMIN="psql -h localhost -U postgres" [WITH_POSTGIS=1] ./db/tests/run.sh
set -euo pipefail
cd "$(dirname "$0")/.."
DB=ned_test

if [ -n "${PSQL_ADMIN:-}" ]; then
  psql_admin() { $PSQL_ADMIN -v ON_ERROR_STOP=1 -q "$@"; }                       # $PSQL_ADMIN volontairement non guillemeté (commande + options)
else
  psql_admin() { su postgres -c "psql -v ON_ERROR_STOP=1 -q $(printf '%q ' "$@")"; }
fi

psql_admin -d postgres -c "DROP DATABASE IF EXISTS $DB"
psql_admin -d postgres -c "CREATE DATABASE $DB"
# Toutes les migrations dans l'ordre ; 003 (PostGIS) seulement si l'extension est disponible.
for f in migrations/*.sql; do
  case "$f" in *003_gis.sql) [ -n "${WITH_POSTGIS:-}" ] || continue ;; esac
  psql_admin -d "$DB" -f "$PWD/$f" >/dev/null
done
psql_admin -d "$DB" -f "$PWD/tests/rls_test.sql"
echo "DB TESTS OK"
