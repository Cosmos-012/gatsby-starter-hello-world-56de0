#!/usr/bin/env bash
# Aperçu local de bout en bout : base fraîche (migrations + jeu de démonstration SYNTHÉTIQUE) → API → interface Next (build de production).
# Usage : ./preview.sh start | stop | status       Prérequis : PostgreSQL local, Node 22.   Variables : WEB_PORT (3100), API_PORT (3990)
# Local (root, cluster système) : fonctionne tel quel.   Ailleurs : PSQL_ADMIN="psql -h localhost -U postgres" ./preview.sh start
# Jeton de service de DÉMONSTRATION (rôle me_manager) : jamais à utiliser en production (voir docs/AUTH.md pour la connexion réelle).
set -euo pipefail
ROOT=$(cd "$(dirname "$0")" && pwd); STATE=${PREVIEW_STATE:-/tmp/ned-preview}; DB=ned_preview
WEB_PORT=${WEB_PORT:-3100}; API_PORT=${API_PORT:-3990}; SECRET=preview-secret-preview-secret-preview-0123
mkdir -p "$STATE"
if [ -n "${PSQL_ADMIN:-}" ]; then psql_admin() { $PSQL_ADMIN -v ON_ERROR_STOP=1 -q "$@"; }; DBHOST=localhost; DBPW=${PGPASSWORD:-postgres}
else psql_admin() { su postgres -c "psql -v ON_ERROR_STOP=1 -q $(printf '%q ' "$@")"; }; DBHOST=localhost; DBPW=; fi

stop() { for f in web api; do [ -f "$STATE/$f.pid" ] && kill "$(cat "$STATE/$f.pid")" 2>/dev/null || true; rm -f "$STATE/$f.pid"; done; }
case "${1:-}" in
  stop) stop; echo "arrêté"; exit 0 ;;
  status) for f in api web; do if [ -f "$STATE/$f.pid" ] && kill -0 "$(cat "$STATE/$f.pid")" 2>/dev/null; then echo "$f : en marche"; else echo "$f : arrêté"; fi; done; exit 0 ;;
  start) ;;
  *) echo "usage : $0 start|stop|status" >&2; exit 2 ;;
esac
stop
psql_admin -d postgres -c "DROP DATABASE IF EXISTS $DB" >/dev/null; psql_admin -d postgres -c "CREATE DATABASE $DB" >/dev/null
for f in "$ROOT"/db/migrations/*.sql; do case "$f" in *003_gis.sql) continue ;; esac; psql_admin -d "$DB" -f "$f" >/dev/null 2>&1; done
psql_admin -d "$DB" -f "$ROOT/db/seed/e2e.sql" >/dev/null
[ "${PREVIEW_DEMO:-1}" = 1 ] && psql_admin -d "$DB" -f "$ROOT/db/seed/demo.sql" >/dev/null   # projets synthétiques (PREVIEW_DEMO=0 pour les omettre)
psql_admin -d "$DB" -c "DROP ROLE IF EXISTS ned_preview_app; CREATE ROLE ned_preview_app LOGIN PASSWORD 'preview' IN ROLE ned_app" >/dev/null
( cd "$ROOT/api" && DATABASE_URL="postgres://ned_preview_app:preview@$DBHOST:5432/$DB" DEV_JWT_SECRET=$SECRET NED_ALLOW_MEMORY_STORAGE=1 PORT=$API_PORT RATE_LIMIT_MAX=10000 \
    setsid node --experimental-strip-types src/server.ts < /dev/null > "$STATE/api.log" 2>&1 & echo $! > "$STATE/api.pid" )
for i in $(seq 1 30); do curl -fsS "localhost:$API_PORT/health" >/dev/null 2>&1 && break; [ "$i" = 30 ] && { cat "$STATE/api.log"; exit 1; }; sleep 1; done
TOKEN=$(cd "$ROOT/api" && node --input-type=module -e "import { SignJWT } from 'jose'; console.log(await new SignJWT({ tenant_id: 'aaaaaaaa-0000-0000-0000-000000000001', roles: ['me_manager'] }).setProtectedHeader({ alg: 'HS256' }).setSubject('apercu').setExpirationTime('12h').sign(new TextEncoder().encode('$SECRET')))")
cd "$ROOT/web"
[ -d node_modules ] || npm ci >/dev/null
NEXT_TELEMETRY_DISABLED=1 NED_API_URL="http://localhost:$API_PORT" NED_DEV_TOKEN="$TOKEN" node node_modules/next/dist/bin/next build >/dev/null
( NEXT_TELEMETRY_DISABLED=1 NED_API_URL="http://localhost:$API_PORT" NED_DEV_TOKEN="$TOKEN" setsid node node_modules/next/dist/bin/next start -p "$WEB_PORT" < /dev/null > "$STATE/web.log" 2>&1 & echo $! > "$STATE/web.pid" )
for i in $(seq 1 60); do curl -fsS -o /dev/null "localhost:$WEB_PORT/fr" 2>/dev/null && break; [ "$i" = 60 ] && { cat "$STATE/web.log"; exit 1; }; sleep 1; done
echo "Interface : http://localhost:$WEB_PORT/fr   (en, ar disponibles)    API : http://localhost:$API_PORT/health"
echo "Projet de démonstration : 20000000-0000-0000-0000-000000000001    Arrêt : $0 stop"
