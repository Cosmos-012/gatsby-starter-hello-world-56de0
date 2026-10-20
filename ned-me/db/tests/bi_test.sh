#!/usr/bin/env bash
# Test hostile de l'accès BI : un analyste avec un accès SQL complet à son compte tente de lire un autre tenant.
# Prérequis : base ned_test construite par run.sh (tenants A et B). Local (root) : ./db/tests/bi_test.sh   CI : PSQL_ADMIN="psql -h localhost -U postgres"
set -uo pipefail
cd "$(dirname "$0")/../.."
DB=ned_test; HOST=${PGHOST:-localhost}
# Local (root) : se relancer une fois sous l'utilisateur postgres (même logique que backup_restore.sh)
if [ -z "${PSQL_ADMIN:-}" ] && [ "$(id -u)" = 0 ]; then exec su postgres -c "bash $PWD/db/tests/bi_test.sh"; fi
if [ -n "${PSQL_ADMIN:-}" ]; then adm() { $PSQL_ADMIN -v ON_ERROR_STOP=1 -X -q -At -d "$DB" "$@"; }
else adm() { psql -v ON_ERROR_STOP=1 -X -q -At -d "$DB" "$@"; }; fi
A=aaaaaaaa-0000-0000-0000-000000000001; B=bbbbbbbb-0000-0000-0000-000000000002
PWA='bi-password-AAAA-123456'; PWB='bi-password-BBBB-123456'
n=0; ok() { n=$((n+1)); echo "  ok  $*"; }; die() { echo "ÉCHEC: $*" >&2; exit 1; }
# Exécute du SQL en tant que compte BI ; sortie = résultats + erreurs (stderr fusionné)
as() { local role=$1 pw=$2; shift 2; PGPASSWORD=$pw psql -h "$HOST" -U "$role" -d "$DB" -X -q -At -v ON_ERROR_STOP=0 "$@" 2>&1; }
# Pire cas : l'analyste désactive lui-même la lecture seule (réglage utilisateur, donc pas une protection) avant d'attaquer.
as_rw() { local role=$1 pw=$2; shift 2; as "$role" "$pw" -c "SET default_transaction_read_only = off" "$@"; }
expect() { local what=$1 got=$2 want=$3; [ "$got" = "$want" ] || die "$what : obtenu « $got », attendu « $want »"; }
expect_err() { echo "$2" | grep -qi "$3" || die "$1 : erreur attendue « $3 », obtenu : $2"; }

# Base reconstruite : le test est rejouable et indépendant de l'état précédent
PSQL_ADMIN="${PSQL_ADMIN:-psql}" db/tests/run.sh >/dev/null 2>&1 || die "reconstruction de la base de test"
for r in bi_a bi_b; do adm -c "SELECT app.drop_bi_account('$r')" >/dev/null 2>&1; done; adm -c "DROP ROLE IF EXISTS bi_orphan" >/dev/null 2>&1
adm -c "SELECT app.create_bi_account('bi_a', '$A', '$PWA'); SELECT app.create_bi_account('bi_b', '$B', '$PWB');" >/dev/null || die "création des comptes"
adm -c "CREATE ROLE bi_orphan LOGIN PASSWORD 'bi-password-orphan-1234' IN ROLE ned_bi_reader" >/dev/null

# Données qui permettent de distinguer les tenants et d'attraper les fuites
adm >/dev/null <<SQL
INSERT INTO indicator (tenant_id, project_id, code, name) SELECT tenant_id, id, 'IND-BI', '{"fr":"x"}' FROM project;
INSERT INTO indicator_value (tenant_id, indicator_id, period, period_end, kind, value, workflow_state)
  SELECT tenant_id, id, 'Q1', '2026-03-31', 'actual', 7, 'validated' FROM indicator WHERE code = 'IND-BI';
INSERT INTO indicator_value (tenant_id, indicator_id, period, period_end, kind, value, workflow_state)
  SELECT tenant_id, id, 'Q2', '2026-06-30', 'actual', 99, 'draft' FROM indicator WHERE code = 'IND-BI';
INSERT INTO indicator_value (tenant_id, indicator_id, period, period_end, kind, value, workflow_state)
  SELECT tenant_id, id, 'Q9', '2026-12-31', 'actual', 555, 'validated' FROM indicator WHERE code = 'IND-BI' AND tenant_id = '$B';
INSERT INTO feedback (tenant_id, project_id, kind, channel, subject, description, submitter_contact, is_sensitive)
  SELECT tenant_id, id, 'complaint', 'hotline', 'visible', 'texte libre', 'contact-secret@example.org', false FROM project;
INSERT INTO feedback (tenant_id, project_id, kind, channel, subject, description, severity, is_sensitive)
  SELECT tenant_id, id, 'grievance', 'hotline', 'sensible', 'protection', 'high', true FROM project;
SQL

# Auto-vérification : BI_TEST_MUTATION=no_barrier retire volontairement la barrière ; le test DOIT alors échouer (voir la CI).
if [ "${BI_TEST_MUTATION:-}" = no_barrier ]; then adm -c "ALTER VIEW bi.indicator_values SET (security_barrier = false)" >/dev/null; echo "  (mutation : security_barrier retiré de bi.indicator_values)"; fi
if [ "${BI_TEST_MUTATION:-}" = no_app_usage ]; then adm -c "REVOKE USAGE ON SCHEMA app FROM ned_bi_reader" >/dev/null; echo "  (mutation : USAGE sur le schéma app retiré)"; fi
echo "== Isolation =="
expect "A voit son programme"  "$(as bi_a $PWA -c "SELECT program_name->>'fr' FROM bi.projects")" "Prog A"; ok "bi_a lit uniquement le tenant A"
expect "B voit son programme"  "$(as bi_b $PWB -c "SELECT program_name->>'fr' FROM bi.projects")" "Prog B"; ok "bi_b lit uniquement le tenant B"
expect "compte sans correspondance" "$(as bi_orphan bi-password-orphan-1234 -c "SELECT count(*) FROM bi.projects")" "0"; ok "compte non rattaché à un tenant : 0 ligne (échec fermé)"

echo "== Tentatives de contournement par un analyste de A =="
# 1. Le contournement qui fonctionne contre l'API (paramètre de session) est sans effet ici
expect "SET app.tenant_id" "$(as_rw bi_a $PWA -c "SET app.tenant_id = '$B'" -c "SELECT program_name->>'fr' FROM bi.projects")" "Prog A"; ok "SET app.tenant_id = <tenant B> : sans effet (toujours A)"
# 2. Accès direct aux tables
for t in project program indicator indicator_value feedback audit_log tenant bi_account risk report; do
  expect_err "SELECT sur $t" "$(as_rw bi_a $PWA -c "SELECT count(*) FROM public.$t")" "permission denied"; done
ok "aucune table lisible directement (10 tables essayées, dont bi_account, tenant, audit_log)"
# 3. Changement d'identité
expect_err "SET ROLE ned_app"            "$(as_rw bi_a $PWA -c "SET ROLE ned_app")"            "permission denied"
expect_err "SET ROLE postgres"           "$(as_rw bi_a $PWA -c "SET ROLE postgres")"           "permission denied"
expect_err "SET SESSION AUTHORIZATION"   "$(as_rw bi_a $PWA -c "SET SESSION AUTHORIZATION bi_b")" "permission denied"
ok "impossible de prendre l'identité d'un autre rôle (ned_app, postgres, bi_b)"
# 4. Fonction piégée (COST minimal => le planificateur l'évalue AVANT le filtre de tenant si la vue n'a pas de barrière).
#    Sur une vue à table unique : le planificateur ne peut pas déduire le filtre de tenant par jointure, donc le piège est discriminant.
#    Vérifié par mutation : sans security_barrier, elle voit aussi des brouillons et d'autres lignes (5 lignes au lieu de 3).
VISIBLE=$(as bi_a $PWA -c "SELECT string_agg(value::text, ',' ORDER BY value::text) FROM bi.indicator_values")
SEEN=$(as bi_a $PWA <<'SQL' | grep -o 'LEAKV [0-9.]*' | cut -d' ' -f2 | sort | paste -sd,
SET default_transaction_read_only = off;
CREATE FUNCTION pg_temp.leakv(v numeric) RETURNS boolean LANGUAGE plpgsql COST 0.0001 AS $f$ BEGIN RAISE NOTICE 'LEAKV %', v; RETURN true; END $f$;
SELECT count(*) FROM bi.indicator_values WHERE pg_temp.leakv(value);
SQL
)
[ -n "$SEEN" ] || die "la fonction piégée n'a rien vu : le test ne prouve rien"
echo ",$SEEN," | grep -q ",99," && die "fuite : la fonction piégée a vu un brouillon (99), valeur que la vue n'expose pas"
expect "lignes vues par la fonction piégée = lignes visibles de la vue" "$SEEN" "$(echo "$VISIBLE" | tr ',' '\n' | sort | paste -sd,)"
ok "fonction piégée (COST minimal) : n'évalue que les lignes visibles de la vue ($SEEN) — security_barrier"
# 5. Création de comptes, écriture
expect_err "create_bi_account par un analyste" "$(as_rw bi_a $PWA -c "SELECT app.create_bi_account('bi_evil','$A','mot-de-passe-long-123')")" "permission denied"
expect_err "écriture dans une vue" "$(as_rw bi_a $PWA -c "INSERT INTO bi.projects (code) VALUES ('x')")" "permission denied\|cannot insert\|read-only"
expect_err "écriture hors vue" "$(as_rw bi_a $PWA -c "UPDATE public.project SET code = 'x'")" "permission denied"
expect_err "création d'objet" "$(as_rw bi_a $PWA -c "CREATE TABLE public.evil (x int)")" "permission denied"
ok "même en lecture seule désactivée : aucun droit d'écriture, de création d'objet ni de création de compte"

echo "== Toutes les vues sont lisibles par un compte BI (une vue cassée passerait inaperçue) =="
VIEWS=$(adm -c "SELECT string_agg(table_name, ' ' ORDER BY table_name) FROM information_schema.views WHERE table_schema = 'bi'")
[ "$(echo $VIEWS | wc -w)" -ge 11 ] || die "vues attendues : au moins 11, trouvées : $VIEWS"
for v in $VIEWS; do
  for acct in "bi_a $PWA" "bi_b $PWB"; do set -- $acct
    r=$(as $1 $2 -c "SELECT count(*) FROM bi.$v"); echo "$r" | grep -qE '^[0-9]+$' || die "bi.$v illisible pour $1 : $r"; done; done
ok "$(echo $VIEWS | wc -w) vues lues sans erreur par chacun des deux comptes ($VIEWS)"
# Pas de dérive : la vue BI donne exactement les mêmes statuts que la vue de l'API (v_indicator_progress sous RLS)
API_VIEW=$(adm <<SQL
SET ROLE ned_app; SET app.tenant_id = '$A';
SELECT string_agg(code || ':' || status || ':' || COALESCE(actual::text,'-') || ':' || COALESCE(target::text,'-') || ':' || COALESCE(round(achievement,4)::text,'-'), ',' ORDER BY code) FROM v_indicator_progress;
SQL
)
BI_VIEW=$(as bi_a $PWA -c "SELECT string_agg(code || ':' || status || ':' || COALESCE(actual::text,'-') || ':' || COALESCE(target::text,'-') || ':' || COALESCE(round(achievement,4)::text,'-'), ',' ORDER BY code) FROM bi.indicator_progress")
[ -n "$API_VIEW" ] && echo "$API_VIEW" | grep -q "RED" || die "jeu de données insuffisant pour comparer les statuts : $API_VIEW"
expect "bi.indicator_progress = v_indicator_progress" "$BI_VIEW" "$(echo "$API_VIEW" | tail -1)"
ok "bi.indicator_progress identique à la vue de l'API (mêmes statuts, valeurs et taux) : $BI_VIEW"
echo "== Contenu exposé =="
expect "feedback sensible exclu" "$(as bi_a $PWA -c "SELECT count(*) FROM bi.feedback")" "1"; ok "bi.feedback : 1 retour sur 2 (le signalement sensible est exclu)"
expect_err "colonne de contact" "$(as bi_a $PWA -c "SELECT submitter_contact FROM bi.feedback")" "does not exist"
expect_err "colonne de description" "$(as bi_a $PWA -c "SELECT description FROM bi.feedback")" "does not exist"
ok "ni contact, ni texte libre dans bi.feedback"
expect "valeur validée visible" "$(as bi_a $PWA -c "SELECT count(*) FROM bi.indicator_values WHERE value = 7")" "1"
expect "brouillon exclu" "$(as bi_a $PWA -c "SELECT count(*) FROM bi.indicator_values WHERE value = 99")" "0"
expect "aucun état non validé" "$(as bi_a $PWA -c "SELECT count(*) FROM bi.indicator_values WHERE workflow_state NOT IN ('validated','approved','published')")" "0"
ok "bi.indicator_values : la valeur validée (7) est visible, le brouillon (99) et tout état non validé sont exclus"

echo "== Provisionnement et garde-fous =="
expect_err "nom de rôle invalide" "$(adm -c "SELECT app.create_bi_account('admin', '$A', 'mot-de-passe-long-123')" 2>&1)" "invalid role name"
expect_err "mot de passe court"   "$(adm -c "SELECT app.create_bi_account('bi_court', '$A', 'court')" 2>&1)" "password too short"
expect_err "tenant inexistant"    "$(adm -c "SELECT app.create_bi_account('bi_fantome', '00000000-0000-0000-0000-000000000000', 'mot-de-passe-long-123')" 2>&1)" "violates foreign key"
adm -c "DROP ROLE IF EXISTS bi_court, bi_fantome" >/dev/null 2>&1
ok "nom de rôle, longueur du mot de passe et tenant validés"
expect "lecture seule + délai" "$(adm -c "SELECT string_agg(s, ';' ORDER BY s) FROM pg_db_role_setting d JOIN pg_roles r ON r.oid = d.setrole, unnest(d.setconfig) s WHERE r.rolname = 'bi_a'")" "default_transaction_read_only=on;statement_timeout=30s"
expect "limite de connexions" "$(adm -c "SELECT rolconnlimit FROM pg_roles WHERE rolname = 'bi_a'")" "5"
expect "droits du rôle" "$(adm -c "SELECT rolsuper::text || rolbypassrls::text || rolcreaterole::text || rolcreatedb::text FROM pg_roles WHERE rolname = 'bi_a'")" "falsefalsefalsefalse"
ok "compte BI : lecture seule, requêtes limitées à 30 s, 5 connexions, aucun privilège"

# Suppression : le rôle ET sa correspondance disparaissent ; un nouveau rôle de même nom n'hérite d'aucun tenant
adm -c "SELECT app.drop_bi_account('bi_a')" >/dev/null || die "drop_bi_account"
expect "rôle supprimé" "$(adm -c "SELECT count(*) FROM pg_roles WHERE rolname = 'bi_a'")" "0"
expect "correspondance supprimée" "$(adm -c "SELECT count(*) FROM bi_account WHERE role_name = 'bi_a'")" "0"
adm -c "CREATE ROLE bi_a LOGIN PASSWORD 'bi-password-AAAA-123456' IN ROLE ned_bi_reader" >/dev/null
expect "homonyme sans héritage" "$(as bi_a $PWA -c "SELECT count(*) FROM bi.projects")" "0"
adm -c "DROP ROLE bi_a" >/dev/null
expect_err "nom invalide à la suppression" "$(adm -c "SELECT app.drop_bi_account('postgres')" 2>&1)" "invalid role name"
ok "suppression : rôle et correspondance retirés ; un homonyme recréé n'hérite d'aucun tenant ; noms hors préfixe bi_ refusés"
for r in bi_b bi_probe; do adm -c "SELECT app.drop_bi_account('$r')" >/dev/null 2>&1 || adm -c "DROP ROLE IF EXISTS $r" >/dev/null 2>&1; done; adm -c "DROP ROLE IF EXISTS bi_orphan" >/dev/null 2>&1
echo "BI TESTS OK ($n groupes de vérifications)"
