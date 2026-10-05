#!/usr/bin/env bash
# Test de fumée de bout en bout sur la pile Docker Compose réelle (db + api + stockage S3). Utilisé en CI.
set -euo pipefail
cd "$(dirname "$0")"
DC="docker compose --env-file .env -f docker-compose.yml -f docker-compose.ci.yml"
ok() { echo "  ok  $*"; }
die() { echo "ÉCHEC: $*" >&2; exit 1; }
sqlo() { $DC exec -T db psql -v ON_ERROR_STOP=1 -U ned_owner -d ned -qAt -c "$1"; }

for i in $(seq 1 90); do curl -fsS localhost:3000/health >/dev/null 2>&1 && break; [ "$i" = 90 ] && die "API indisponible"; sleep 2; done
ok "API en ligne (image construite, migrations appliquées au démarrage)"
[ "$(sqlo "SELECT rolsuper::text || '/' || rolbypassrls::text FROM pg_roles WHERE rolname = 'ned_api'")" = "false/false" ] || die "rôle ned_api privilégié"
ok "l'API se connecte avec un rôle sans superuser ni BYPASSRLS"
[ "$(sqlo "SELECT count(*) FROM pg_extension WHERE extname = 'postgis'")" = 1 ] || die "PostGIS absent"; ok "PostGIS actif (migration 003)"
[ "$(curl -s -o /dev/null -w '%{http_code}' localhost:3000/projects)" = 401 ] || die "accès sans jeton"
[ -n "$(curl -sI localhost:3000/health | grep -i '^x-request-id:')" ] || die "x-request-id absent"; ok "401 sans jeton ; en-têtes présents"

T=aaaaaaaa-0000-0000-0000-000000000001
PROJECT=$(sqlo "WITH t AS (INSERT INTO tenant (id, name) VALUES ('$T', 'CI') RETURNING id),
  p AS (INSERT INTO program (tenant_id, code, name) SELECT id, 'P', '{\"fr\":\"Programme\"}' FROM t RETURNING tenant_id, id)
  INSERT INTO project (tenant_id, program_id, code, name) SELECT tenant_id, id, 'J', '{\"fr\":\"Projet\"}' FROM p RETURNING id")
TOKEN=$($DC exec -T api node --input-type=module -e "import { SignJWT } from 'jose'; console.log(await new SignJWT({ tenant_id: '$T', roles: ['me_manager'] }).setProtectedHeader({ alg: 'HS256' }).setSubject('ci').setExpirationTime('10m').sign(new TextEncoder().encode(process.env.DEV_JWT_SECRET)))")
api() { curl -fsS -H "authorization: Bearer $TOKEN" -H 'content-type: application/json' "$@"; }
api localhost:3000/projects | grep -q '"code":"J"' || die "projet non visible"; ok "lecture sous RLS avec un jeton (tenant $T)"

# Preuve : téléversement réel vers le stockage S3 par URL présignée, confirmation, téléchargement, comparaison des octets
printf 'preuve terrain NED %s\n' "$(date -u +%s)" > /tmp/evidence.txt
SIZE=$(stat -c%s /tmp/evidence.txt)
EV=$(api -X POST localhost:3000/evidence -d "{\"project_id\":\"$PROJECT\",\"kind\":\"document\",\"title\":\"CI\",\"filename\":\"evidence.txt\",\"content_type\":\"text/plain\",\"size_bytes\":$SIZE}")
ID=$(echo "$EV" | jq -r .id); URL=$(echo "$EV" | jq -r .upload.url)
[ "$(curl -s -o /dev/null -w '%{http_code}' -X POST -H "authorization: Bearer $TOKEN" -H 'content-type: application/json' -d '{}' "localhost:3000/evidence/$ID/complete")" = 409 ] || die "confirmation acceptée avant téléversement"
curl -fsS -X PUT -H 'content-type: text/plain' --data-binary @/tmp/evidence.txt "$URL" >/dev/null || die "téléversement S3 refusé"
cat /tmp/evidence.txt /tmp/evidence.txt > /tmp/evidence-big.txt
[ "$(curl -s -o /dev/null -w '%{http_code}' -X PUT -H 'content-type: text/plain' --data-binary @/tmp/evidence-big.txt "$URL")" = 403 ] || die "un fichier d'une autre taille a été accepté"
ok "URL présignée : téléversement accepté, taille différente refusée par le stockage S3 (403)"
[ "$(api -X POST -d '{}' "localhost:3000/evidence/$ID/complete" | jq -r .status)" = available ] || die "confirmation"
DL=$(api "localhost:3000/evidence/$ID/download" | jq -r .url)
cmp -s <(curl -fsS "$DL") /tmp/evidence.txt || die "contenu téléchargé différent"; ok "preuve confirmée puis téléchargée à l'identique"

# Rapport et export Excel
REP=$(api -X POST localhost:3000/reports -d '{"type":"me","period_start":"2026-01-01","period_end":"2026-03-31"}' | jq -r .id)
[ "$(curl -s -o /tmp/r.xlsx -w '%{http_code}' -H "authorization: Bearer $TOKEN" "localhost:3000/reports/$REP/export?format=xlsx&lang=ar,fr")" = 200 ] || die "export Excel"
[ "$(head -c 2 /tmp/r.xlsx)" = "PK" ] || die "fichier Excel invalide"; ok "rapport généré et exporté en Excel"
# Interface : image construite, page servie en arabe (RTL) ; sans jeton de session, message d'authentification et non une erreur 500
for i in $(seq 1 60); do curl -fsS -o /dev/null localhost:3100/ar 2>/dev/null && break; [ "$i" = 60 ] && die "interface indisponible"; sleep 2; done
PAGE=$(curl -fsS localhost:3100/ar)
echo "$PAGE" | grep -q 'dir="rtl"' || die "page arabe sans dir=rtl"
echo "$PAGE" | grep -q 'ما هو الأداء الحالي لمشروعي' || die "titre arabe absent"
[ "$(curl -s -o /dev/null -w '%{http_code}' localhost:3100/)" = 307 ] || die "redirection de la racine"
ok "interface servie (arabe RTL, redirection racine)"
echo "SMOKE TESTS OK"
