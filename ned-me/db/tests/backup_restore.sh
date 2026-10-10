#!/usr/bin/env bash
# Test de sauvegarde/restauration : source = base de test (jeu de données de rls_test.sql), cible = nouvelle base.
# Vérifie : intégrité (somme), refus d'écrasement, données identiques, RLS/politiques/déclencheurs/droits conservés, cloisonnement tenant.
# Local (root) : ./db/tests/backup_restore.sh        CI : PGHOST/PGUSER/PGPASSWORD définis + PSQL_ADMIN="psql -h localhost -U postgres"
set -euo pipefail
cd "$(dirname "$0")/../.."
if [ -z "${PSQL_ADMIN:-}" ] && [ "$(id -u)" = 0 ]; then exec su postgres -c "bash $PWD/db/tests/backup_restore.sh"; fi
SRC=ned_test; DST=ned_restored; OUT=$(mktemp -d); cleanup() { rm -rf "$OUT"; for d in "$DST" ned_should_not_exist ned_copy_ok; do dropdb --if-exists "$d" >/dev/null 2>&1 || true; done; }
trap cleanup EXIT
q() { psql -v ON_ERROR_STOP=1 -X -q -At "$@"; }
ok() { echo "  ok  $*"; }
die() { echo "ÉCHEC: $*" >&2; exit 1; }

PSQL_ADMIN="${PSQL_ADMIN:-psql}" db/tests/run.sh >/dev/null 2>&1   # déjà sous postgres : psql direct, pas de su imbriqué ; (re)construit ned_test avec toutes les migrations + jeu de données
for d in "$DST" ned_should_not_exist ned_copy_ok; do dropdb --if-exists "$d" >/dev/null 2>&1; done   # résidus d'une exécution interrompue

f=$(deploy/backup.sh "$SRC" "$OUT"); [ -s "$f" ] && [ -s "$f.sha256" ] || die "sauvegarde absente"; ok "sauvegarde créée ($(du -h "$f" | cut -f1))"
deploy/restore.sh "$f" "$DST" >/dev/null; ok "restauration dans $DST"
deploy/restore.sh "$f" "$DST" >/dev/null 2>&1 && die "la restauration a écrasé une base existante"; ok "refus d'écraser une base existante"

# Fichier altéré (1 octet ajouté) accompagné de la somme d'origine : doit être refusé.
cp "$f" "$OUT/bad.dump"; printf 'x' >> "$OUT/bad.dump"; cp "$f.sha256" "$OUT/bad.dump.sha256"
deploy/restore.sh "$OUT/bad.dump" ned_should_not_exist >/dev/null 2>&1 && die "une sauvegarde altérée a été acceptée"
q -d postgres -c "SELECT 1 FROM pg_database WHERE datname='ned_should_not_exist'" | grep -q 1 && die "base créée malgré la somme invalide"; ok "sauvegarde altérée refusée, aucune base créée"
cp "$f" "$OUT/copy.dump"; cp "$f.sha256" "$OUT/copy.dump.sha256"
deploy/restore.sh "$OUT/copy.dump" ned_copy_ok >/dev/null 2>&1 || die "une copie intacte renommée doit être acceptée"; dropdb ned_copy_ok; ok "copie intacte (renommée) acceptée"

counts() { q -d "$1" -c "SELECT string_agg(format('SELECT %L AS t, count(*)::text AS n FROM %I', table_name, table_name), ' UNION ALL ' ORDER BY table_name)
  FROM information_schema.tables WHERE table_schema='public' AND table_type='BASE TABLE'" | q -d "$1" -f - ; }
[ "$(counts $SRC)" = "$(counts $DST)" ] || die "nombres de lignes différents"; ok "nombre de lignes identique pour $(counts $SRC | wc -l) tables"
[ "$(counts $SRC | awk -F'|' '$1=="audit_log"{print $2}')" -gt 0 ] || die "jeu de données vide : le test ne prouverait rien"
fp() { q -d "$1" -c "SELECT md5(string_agg(a::text, '|' ORDER BY id)) FROM audit_log a"; }
[ "$(fp $SRC)" = "$(fp $DST)" ] || die "contenu du journal d'audit différent"; ok "contenu du journal d'audit identique (empreinte md5)"

meta() { q -d "$1" -c "SELECT 'rls', relname, relrowsecurity, relforcerowsecurity FROM pg_class WHERE relnamespace='public'::regnamespace AND relkind='r' ORDER BY relname"
         q -d "$1" -c "SELECT 'pol', tablename, policyname, cmd, qual, with_check FROM pg_policies WHERE schemaname='public' ORDER BY tablename, policyname"
         q -d "$1" -c "SELECT 'trg', c.relname, t.tgname FROM pg_trigger t JOIN pg_class c ON c.oid=t.tgrelid WHERE NOT t.tgisinternal AND c.relnamespace='public'::regnamespace ORDER BY 2,3"
         q -d "$1" -c "SELECT 'acl', table_name, privilege_type FROM information_schema.role_table_grants WHERE grantee='ned_app' AND table_schema='public' ORDER BY 2,3"; }
[ "$(meta $SRC)" = "$(meta $DST)" ] || { diff <(meta $SRC) <(meta $DST) | head; die "RLS/politiques/déclencheurs/droits différents"; }
ok "RLS forcée, politiques, déclencheurs et droits identiques ($(meta $DST | grep -c '^pol') politiques, $(meta $DST | grep -c '^trg') déclencheurs)"
[ "$(meta $DST | grep -c '^rls.*|t|t$')" -ge 20 ] || die "RLS forcée absente après restauration"

# Sonde de cloisonnement dans la base RESTAURÉE, avec le rôle applicatif (non superuser)
probe() { q -d "$DST" <<SQL
SET ROLE ned_api; BEGIN; SET LOCAL app.tenant_id = '$1'; SELECT count(*) FROM project; COMMIT;
SQL
}
A=aaaaaaaa-0000-0000-0000-000000000001; B=bbbbbbbb-0000-0000-0000-000000000002
[ "$(probe $A | tail -1)" = 1 ] && [ "$(probe $B | tail -1)" = 1 ] || die "chaque tenant doit voir exactement son projet"
[ "$(probe 00000000-0000-0000-0000-000000000000 | tail -1)" = 0 ] || die "un tenant inconnu voit des données"
[ "$(q -d $DST <<SQL | tail -1
SET ROLE ned_api; SELECT count(*) FROM project;
SQL
)" = 0 ] || die "sans tenant, des données sont visibles"
ok "cloisonnement tenant effectif dans la base restaurée (A→1, B→1, inconnu→0, sans tenant→0)"
# Les déclencheurs de règles métier fonctionnent toujours après restauration
if out=$(q -d "$DST" 2>&1 <<SQL
SET ROLE ned_api; BEGIN; SET LOCAL app.tenant_id = '$A';
INSERT INTO result (tenant_id, project_id, level, code, name) SELECT tenant_id, id, 'impact', 'RESTORE-1', '{}' FROM project;
INSERT INTO result (tenant_id, project_id, parent_id, level, code, name) SELECT r.tenant_id, r.project_id, r.id, 'impact', 'RESTORE-2', '{}' FROM result r WHERE r.code = 'RESTORE-1';
COMMIT;
SQL
); then die "le déclencheur de hiérarchie des résultats n'est plus actif"; fi
echo "$out" | grep -q "cannot be child of" || die "échec pour une autre raison que la règle métier : $out"
ok "règles métier (déclencheurs) actives après restauration (impact sous impact refusé)"

# Rotation
for i in 1 2 3; do sleep 1; KEEP=2 deploy/backup.sh "$SRC" "$OUT" >/dev/null; done
[ "$(ls "$OUT"/$SRC-*.dump | wc -l)" = 2 ] && [ "$(ls "$OUT"/$SRC-*.sha256 | wc -l)" = 2 ] || die "rotation KEEP=2 incorrecte"; ok "rotation : 2 sauvegardes conservées, sommes associées incluses"
echo "BACKUP/RESTORE TESTS OK"
