#!/usr/bin/env bash
# Crée un compte BI (lecture seule, lié à UN tenant) et affiche l'URI de connexion pour Superset / Metabase.
# Usage : ./bi-account.sh <tenant_uuid> <suffixe>      →  rôle bi_<suffixe>      Connexion via les variables PG* (PGHOST, PGUSER, PGDATABASE…)
# Le mot de passe est généré ici, affiché UNE fois, jamais passé en argument de commande (il n'apparaît pas dans `ps`).
set -euo pipefail
tenant=${1:?tenant uuid requis}; suffix=${2:?suffixe requis}
[[ $tenant =~ ^[0-9a-fA-F-]{36}$ ]] || { echo "tenant : UUID attendu" >&2; exit 2; }
[[ $suffix =~ ^[a-z0-9_]{1,40}$ ]] || { echo "suffixe : [a-z0-9_]{1,40}" >&2; exit 2; }
# Pas de « tr < /dev/urandom | head » : avec pipefail, tr reçoit SIGPIPE quand head ferme le tube et le script s'arrête sans message.
pw=$(head -c 64 /dev/urandom | base64 | tr -dc 'A-Za-z0-9' | cut -c1-28)
[ ${#pw} -eq 28 ] || { echo "génération du mot de passe impossible" >&2; exit 1; }
# Valeurs transmises par l'ENTRÉE STANDARD (méta-commandes \set), jamais en argument : un `psql -v pw=…` serait visible dans `ps`.
# Elles sont validées plus haut (UUID, [a-z0-9_], alphanumérique) : aucune injection possible.
psql -X -q -v ON_ERROR_STOP=1 >/dev/null <<SQL
\\set role bi_$suffix
\\set tenant $tenant
\\set pw $pw
SELECT app.create_bi_account(:'role', :'tenant'::uuid, :'pw');
SQL
db=${PGDATABASE:-ned}; host=${BI_PUBLIC_HOST:-${PGHOST:-localhost}}
echo "Compte créé : bi_$suffix  (tenant $tenant ; lecture seule ; 30 s par requête ; 5 connexions)"
echo "URI SQLAlchemy (à saisir une fois dans la source de données, mot de passe non récupérable ensuite) :"
echo "  postgresql+psycopg2://bi_$suffix:$pw@$host:5432/$db"
echo "Schéma à exposer : bi    Interdire : DML/DDL, import de CSV, tout autre schéma"
