#!/usr/bin/env bash
# Exécuté une seule fois à la création du volume : applique toutes les migrations puis crée le rôle de connexion de l'API
# (non superuser, sans BYPASSRLS, membre de ned_app => soumis à la RLS).
set -euo pipefail
psql_() { psql -v ON_ERROR_STOP=1 -U "$POSTGRES_USER" -d "$POSTGRES_DB" "$@"; }
for f in /migrations/*.sql; do echo "migration: $f"; psql_ -q -f "$f" >/dev/null; done
psql_ -q -v pw="${API_DB_PASSWORD:?API_DB_PASSWORD requis}" <<'SQL'
CREATE ROLE ned_api LOGIN PASSWORD :'pw' NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE IN ROLE ned_app;
GRANT CONNECT ON DATABASE ned TO ned_api;
SQL
echo "rôle ned_api créé"
