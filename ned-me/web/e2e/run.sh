#!/usr/bin/env bash
# Bout en bout de l'interface : base fraîche (migrations + graine) → vraie API → vrai serveur Next (build de production) → Playwright.
# Local (root) : ./e2e/run.sh      CI : PSQL_ADMIN="psql -h localhost -U postgres" PGPASSWORD=… ./e2e/run.sh
set -euo pipefail
cd "$(dirname "$0")/.."
WEB=$PWD; ROOT=$(cd .. && pwd); DB=ned_web_e2e
API_PORT=${API_PORT:-3990}; WEB_PORT=${WEB_PORT:-3100}
SECRET=e2e-secret-e2e-secret-e2e-secret-0123
if [ -n "${PSQL_ADMIN:-}" ]; then psql_admin() { $PSQL_ADMIN -v ON_ERROR_STOP=1 -q "$@"; }; DBHOST=localhost; DBPW=${PGPASSWORD:-postgres}
else psql_admin() { su postgres -c "psql -v ON_ERROR_STOP=1 -q $(printf '%q ' "$@")"; }; DBHOST=localhost; DBPW=; fi

psql_admin -d postgres -c "DROP DATABASE IF EXISTS $DB" >/dev/null
psql_admin -d postgres -c "CREATE DATABASE $DB" >/dev/null
for f in "$ROOT"/db/migrations/*.sql; do case "$f" in *003_gis.sql) continue ;; esac; psql_admin -d "$DB" -f "$f" >/dev/null 2>&1; done
psql_admin -d "$DB" -f "$ROOT/db/seed/e2e.sql" >/dev/null
psql_admin -d "$DB" -c "DROP ROLE IF EXISTS ned_web_e2e; CREATE ROLE ned_web_e2e LOGIN PASSWORD 'e2e' IN ROLE ned_app" >/dev/null

PIDS=()
cleanup() { for p in "${PIDS[@]:-}"; do [ -n "$p" ] && kill "$p" 2>/dev/null || true; done; }
trap cleanup EXIT
# Mode connexion : E2E_OIDC_ISSUER (ex. http://localhost:8180/realms/ned) → vrai Keycloak, API qui vérifie ses jetons (JWKS), web sans jeton de service.
if [ -n "${E2E_OIDC_ISSUER:-}" ]; then API_AUTH=(NED_ALLOW_MEMORY_STORAGE=1 OIDC_JWKS_URL="$E2E_OIDC_ISSUER/protocol/openid-connect/certs" OIDC_ISSUER="$E2E_OIDC_ISSUER"); else API_AUTH=(DEV_JWT_SECRET=$SECRET); fi
( cd "$ROOT/api" && exec env DATABASE_URL="postgres://ned_web_e2e:e2e@$DBHOST:5432/$DB" "${API_AUTH[@]}" PORT=$API_PORT RATE_LIMIT_MAX=10000 \
    node --experimental-strip-types src/server.ts > /tmp/ned-e2e-api.log 2>&1 ) & PIDS+=($!)
for i in $(seq 1 30); do curl -fsS "localhost:$API_PORT/health" >/dev/null 2>&1 && break; [ "$i" = 30 ] && { cat /tmp/ned-e2e-api.log; exit 1; }; sleep 1; done

TOKEN=$(cd "$ROOT/api" && node --input-type=module -e "import { SignJWT } from 'jose'; console.log(await new SignJWT({ tenant_id: 'aaaaaaaa-0000-0000-0000-000000000001', roles: ['viewer'] }).setProtectedHeader({ alg: 'HS256' }).setSubject('e2e').setExpirationTime('1h').sign(new TextEncoder().encode('$SECRET')))")
export NED_API_URL="http://localhost:$API_PORT" NED_DEV_TOKEN="$TOKEN" E2E_BASE_URL="http://localhost:$WEB_PORT"
if [ -n "${E2E_OIDC_ISSUER:-}" ]; then
  unset NED_DEV_TOKEN; export OIDC_ISSUER="$E2E_OIDC_ISSUER" OIDC_CLIENT_ID=ned-web OIDC_CLIENT_SECRET="${E2E_OIDC_SECRET:?E2E_OIDC_SECRET requis}" PUBLIC_URL="http://localhost:$WEB_PORT" SESSION_SECRET=e2e-session-secret-e2e-session-secret
  SPEC=auth.spec.ts
else SPEC=overview.spec.ts; fi
# un serveur résiduel sur le port servirait une version périmée : on refuse de tester dans ce cas
if curl -s -o /dev/null "localhost:$WEB_PORT/fr"; then echo "port $WEB_PORT déjà occupé : arrêtez le serveur résiduel" >&2; exit 1; fi
NEXT_TELEMETRY_DISABLED=1 node node_modules/next/dist/bin/next build >/dev/null   # toujours reconstruire
# node direct (pas npx) : le PID suivi est celui du serveur ; l'arrêt en fin de test le termine vraiment.
( NEXT_TELEMETRY_DISABLED=1 exec node node_modules/next/dist/bin/next start -p "$WEB_PORT" > /tmp/ned-e2e-web.log 2>&1 ) & PIDS+=($!)
for i in $(seq 1 60); do curl -fsS -o /dev/null "localhost:$WEB_PORT/fr" 2>/dev/null && break; [ "$i" = 60 ] && { cat /tmp/ned-e2e-web.log; exit 1; }; sleep 1; done
npx playwright test "$SPEC" "$@"
